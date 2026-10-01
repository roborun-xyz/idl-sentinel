import { test } from "node:test";
import assert from "node:assert/strict";
import { detectChanges } from "../src/lib/monitoring/change-detector";
import type { SolanaIdl } from "../src/lib/solana/idl-fetcher";
import { calculateIdlHash } from "../src/lib/monitoring/hash";
import {
  runNotificationBatch,
  type NotificationStore,
  type NotificationChange,
} from "../src/lib/notifications/worker";
import { runPool } from "../src/lib/concurrency";
import { SimpleCache } from "../src/lib/cache";
import { getJwtSecret } from "../src/lib/auth/secret";
import { isValidProgramId } from "../src/lib/utils";

const old: SolanaIdl = {
  name: "test",
  instructions: [
    {
      name: "execute",
      accounts: [
        { name: "a", signer: false, writable: false },
        { name: "b", signer: false, writable: false },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
};

test("argument type changes are high severity", () => {
  const next = structuredClone(old);
  next.instructions[0].args[0].type = "u128";
  assert.equal(detectChanges(old, next)[0].severity, "high");
});
test("signer changes remain critical even after later writable or argument changes", () => {
  const next = structuredClone(old);
  next.instructions[0].accounts[0].signer = true;
  next.instructions[0].accounts[1].writable = true;
  next.instructions[0].args.push({ name: "extra", type: "u8" });
  assert.equal(detectChanges(old, next)[0].severity, "critical");
});
test("nested signer requirements and instruction discriminators are checked", () => {
  const before = structuredClone(old);
  before.instructions[0].accounts = [
    { name: "group", accounts: [{ name: "nested", signer: false }] },
  ];
  const next = structuredClone(before);
  next.instructions[0].accounts[0].accounts![0].signer = true;
  assert.equal(detectChanges(before, next)[0].severity, "critical");
  next.instructions[0].discriminator = [1, 2];
  assert.equal(detectChanges(before, next)[0].severity, "critical");
});
test("hashing ignores object key order and still preserves array order", () => {
  assert.equal(
    calculateIdlHash(old),
    calculateIdlHash({ instructions: old.instructions, name: old.name })
  );
  const next = structuredClone(old);
  next.instructions[0].accounts.reverse();
  assert.notEqual(calculateIdlHash(old), calculateIdlHash(next));
});

const event: NotificationChange = {
  id: "change",
  severity: "high",
  change_summary: "Changed",
  detected_at: "",
  monitored_programs: { id: "program", program_id: "address", name: "Test" },
};
function storeFixture() {
  const marked: string[] = [],
    recorded: string[] = [],
    deferred: string[] = [];
  const store: NotificationStore = {
    loadChanges: async () => [event],
    loadWatchers: async () =>
      new Map([["program", [{ userId: "user", walletAddress: "wallet", destination: "dest" }]]]),
    loadDeliveries: async () => ({ delivered: new Map(), maxAttempts: 0 }),
    record: async (_user, ids, success) => {
      if (success) recorded.push(...ids);
    },
    markDelivered: async (ids) => {
      marked.push(...ids);
    },
    defer: async (ids) => {
      deferred.push(...ids);
    },
  };
  return { store, marked, recorded, deferred };
}
const options = () => ({ deadline: Date.now() + 1000, concurrency: 2 });
test("watcher query failures never mark alerts as notified", async () => {
  const f = storeFixture();
  f.store.loadWatchers = async () => {
    throw new Error("database unavailable");
  };
  const result = await runNotificationBatch(
    f.store,
    async () => {
      throw new Error("must not send");
    },
    options()
  );
  assert.deepEqual(f.marked, []);
  assert.match(result.errors[0], /database unavailable/);
});
test("partial delivery failures preserve receipts and retry only undelivered recipients", async () => {
  const f = storeFixture();
  f.store.loadWatchers = async () =>
    new Map([
      [
        "program",
        [
          { userId: "already", walletAddress: "wallet", destination: "a" },
          { userId: "pending", walletAddress: "wallet", destination: "b" },
        ],
      ],
    ]);
  f.store.loadDeliveries = async () => ({
    delivered: new Map([["already", new Set(["change"])]]),
    maxAttempts: 1,
  });
  const sent: string[] = [];
  const result = await runNotificationBatch(
    f.store,
    async (watcher) => {
      sent.push(watcher.userId);
      return false;
    },
    options()
  );
  assert.deepEqual(sent, ["pending"]);
  assert.deepEqual(f.marked, []);
  assert.deepEqual(f.deferred, ["change"]);
  assert.equal(result.failed, 1);
});
test("expired budget leaves pending alerts untouched; no watchers is a successful lookup", async () => {
  const f = storeFixture();
  await runNotificationBatch(
    f.store,
    async () => {
      throw new Error("must not send");
    },
    { ...options(), deadline: 0 }
  );
  assert.deepEqual(f.marked, []);
  f.store.loadWatchers = async () => new Map();
  await runNotificationBatch(
    f.store,
    async () => {
      throw new Error("must not send");
    },
    options()
  );
  assert.deepEqual(f.marked, ["change"]);
});
test("receipt write failures do not mark sent messages as fully delivered", async () => {
  const f = storeFixture();
  f.store.record = async () => {
    throw new Error("write failed");
  };
  const result = await runNotificationBatch(f.store, async () => true, options());
  assert.equal(result.failed, 1);
  assert.deepEqual(f.marked, []);
});

test("worker pool refills slots while a slow item is still running", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: number[] = [];
  await runPool([1, 2, 3], 2, async (item) => {
    if (item === 1) await gate;
    order.push(item);
    if (item === 3) release();
  });
  assert.deepEqual(order, [2, 3, 1]);
});
test("cache coalesces requests and never restores invalidated in-flight data", async () => {
  const cache = new SimpleCache();
  let release!: (value: number) => void;
  const work = new Promise<number>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const compute = () => {
    calls++;
    return work;
  };
  const first = cache.getOrCompute("key", compute, 60);
  const second = cache.getOrCompute("key", compute, 60);
  assert.equal(calls, 1);
  cache.delete("key");
  release(42);
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
  assert.equal(cache.get("key"), null);
});
test("JWT configuration fails closed without a strong secret", () => {
  const original = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(getJwtSecret, /JWT_SECRET/);
    process.env.JWT_SECRET = "short";
    assert.throws(getJwtSecret, /JWT_SECRET/);
    process.env.JWT_SECRET = "x".repeat(32);
    assert.equal(getJwtSecret().byteLength, 32);
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});
test("program ID validation uses the bs58 default export", () => {
  assert.equal(isValidProgramId("11111111111111111111111111111111"), true);
  assert.equal(isValidProgramId("not-an-address"), false);
});

test("IDL discovery errors propagate instead of becoming false removal alerts", async () => {
  const { fetchIdlFromChain } = await import("../src/lib/solana/idl-fetcher");
  const connection = {
    getAccountInfo: async () => null,
    getProgramAccounts: async () => {
      throw new Error("RPC unavailable");
    },
  } as unknown as import("@solana/web3.js").Connection;
  await assert.rejects(
    fetchIdlFromChain(connection, "11111111111111111111111111111111", 1),
    /RPC unavailable/
  );
});

test("private query caches are partitioned by user", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { queryKeys } = await import("../src/hooks/query-keys");
  const client = new QueryClient();
  client.setQueryData(queryKeys.userSettings("alice"), { webhook: "alice-private-url" });
  client.setQueryData(queryKeys.watchlistFor("alice"), ["alice-program"]);
  assert.equal(client.getQueryData(queryKeys.userSettings("bob")), undefined);
  assert.equal(client.getQueryData(queryKeys.watchlistFor("bob")), undefined);
  client.clear();
});
