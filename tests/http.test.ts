import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout } from "../src/lib/http";

test("fetch deadline includes a stalled response body, not just headers", async () => {
  const server = createServer((_req, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write("{");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await assert.rejects(fetchWithTimeout(url, { timeoutMs: 100 }), /timed out/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("fetch limits response bytes and preserves normal JSON responses", async () => {
  const server = createServer((_req, response) =>
    response.end(JSON.stringify({ payload: "a".repeat(100) }))
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await assert.rejects(fetchWithTimeout(url, { maxBytes: 10 }), /maximum allowed size/);
    assert.deepEqual(await (await fetchWithTimeout(url)).json(), { payload: "a".repeat(100) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
