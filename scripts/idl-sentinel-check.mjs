#!/usr/bin/env node
// IDL Sentinel CI check: fails a build when a Solana program you depend on
// changed in a breaking way since you last pinned it. No dependencies; Node 18+.
//
//   node scripts/idl-sentinel-check.mjs pin <program-address>... [--config .idl-sentinel.json]
//   node scripts/idl-sentinel-check.mjs check [--config .idl-sentinel.json] [--fail-on high]
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const SEVERITIES = ["critical", "high", "medium", "low"];
const DEFAULT_CONFIG = ".idl-sentinel.json";

export function atLeast(severity, minimum) {
  return SEVERITIES.indexOf(severity) <= SEVERITIES.indexOf(minimum);
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "check", positional: [], config: DEFAULT_CONFIG };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--fail-on") args.failOn = argv[++i];
    else if (arg === "--api") args.api = argv[++i];
    else if (arg === "--fail-on-pending") args.failOnPending = true;
    else args.positional.push(arg);
  }
  return args;
}

async function readConfig(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { programs: {} };
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `${response.status} from ${url}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function allChangesSince(fetchImpl, api, address, since) {
  const changes = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    else params.set("since", since);
    const body = await getJson(fetchImpl, `${api}/api/v1/programs/${address}/changes?${params}`);
    changes.push(...body.changes);
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return changes;
}

/**
 * @typedef {{ name?: string, idl_hash?: string | null, deploy_slot?: number | null,
 *   code_hash?: string | null, pinned_at?: string }} Pin
 * @typedef {{ api?: string, fail_on?: string, programs?: Record<string, Pin> }} Config
 * @typedef {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} Fetch
 */

/**
 * Pins each address to its current IDL hash, deploy slot, and code hash.
 * @param {Config} config
 * @param {string[]} addresses
 * @param {{ fetchImpl?: Fetch, now?: Date }} [options]
 */
export async function pin(config, addresses, { fetchImpl = fetch, now = new Date() } = {}) {
  const api = (config.api || "").replace(/\/+$/, "");
  if (!api) throw new Error('Set "api" in the config (your IDL Sentinel URL) or pass --api');
  const programs = { ...(config.programs || {}) };
  const targets = addresses.length ? addresses : Object.keys(programs);
  for (const address of targets) {
    const status = await getJson(fetchImpl, `${api}/api/v1/programs/${address}`);
    programs[address] = {
      name: status.program.name,
      idl_hash: status.idl?.hash ?? null,
      deploy_slot: status.chain?.deploy_slot ?? null,
      code_hash: status.chain?.code_hash ?? null,
      pinned_at: now.toISOString(),
    };
  }
  return { ...config, api, programs };
}

/**
 * Compares each pinned program with its current state. A change at or above
 * `failOn` since the pin fails; approved-but-pending upgrades warn.
 * @param {Config} config
 * @param {{ fetchImpl?: Fetch, failOn?: string, failOnPending?: boolean, now?: Date }} [options]
 */
export async function check(
  config,
  { fetchImpl = fetch, failOn, failOnPending = false, now = new Date() } = {}
) {
  const api = (config.api || "").replace(/\/+$/, "");
  if (!api) throw new Error('Set "api" in the config (your IDL Sentinel URL) or pass --api');
  const threshold = failOn || config.fail_on || "high";
  if (!SEVERITIES.includes(threshold))
    throw new Error(`fail_on must be one of ${SEVERITIES.join(", ")}`);
  const results = [];
  for (const [address, pinned] of Object.entries(config.programs || {})) {
    const result = { address, name: pinned.name || address, failures: [], warnings: [], notes: [] };
    results.push(result);
    try {
      const status = await getJson(fetchImpl, `${api}/api/v1/programs/${address}`);
      result.name = status.program.name;
      const changes = pinned.pinned_at
        ? await allChangesSince(fetchImpl, api, address, pinned.pinned_at)
        : [];
      for (const change of changes) {
        const line = `[${change.severity}] ${change.summary} (${change.detected_at})`;
        if (atLeast(change.severity, threshold)) result.failures.push(line);
        else result.notes.push(line);
      }
      if (
        pinned.idl_hash &&
        status.idl?.hash &&
        status.idl.hash !== pinned.idl_hash &&
        !changes.length
      ) {
        result.warnings.push(
          `IDL hash changed (${pinned.idl_hash.slice(0, 8)} → ${status.idl.hash.slice(0, 8)})`
        );
      }
      if (
        pinned.deploy_slot &&
        status.chain?.deploy_slot &&
        status.chain.deploy_slot !== pinned.deploy_slot
      ) {
        const line = `Program redeployed at slot ${status.chain.deploy_slot} (pinned ${pinned.deploy_slot})`;
        if (!changes.some((c) => c.type === "program_upgraded")) result.warnings.push(line);
      }
      for (const proposal of status.chain?.multisig?.pending_proposals ?? []) {
        if (proposal.status !== "approved") continue;
        const at = proposal.executable_at ? Date.parse(proposal.executable_at) : NaN;
        const when = Number.isNaN(at)
          ? ""
          : at <= now.getTime()
            ? " and can execute now"
            : ` and can execute after ${proposal.executable_at}`;
        const line = `Approved Squads proposal #${proposal.index} will ${proposal.actions.join("/")} this program${when}`;
        (failOnPending ? result.failures : result.warnings).push(line);
      }
      if (status.chain?.verification?.status && status.chain.verification.status !== "verified") {
        result.notes.push(
          {
            mismatch: "Deployed code does not match its last OtterSec-verified build",
            unverified: "No OtterSec-verified build is published for the deployed code",
            unknown: "OtterSec has the source registered but no build to compare",
            pending: "Verified-build check for the deployed code is pending",
          }[status.chain.verification.status] ?? `Verification: ${status.chain.verification.status}`
        );
      }
    } catch (error) {
      result.failures.push(
        error.status === 404 ? `Not registered at ${api}` : `Check failed: ${error.message}`
      );
    }
  }
  return { threshold, results, failed: results.some((r) => r.failures.length) };
}

function escapeAnnotation(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Workflow-command properties also reserve ":" and ",". */
function escapeProperty(text) {
  return escapeAnnotation(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function renderSummary({ threshold, results, failed }) {
  const lines = [
    `## IDL Sentinel: ${failed ? "dependency changes need review" : "dependencies unchanged"}`,
    "",
    `Fails on **${threshold}** or higher since each program's pin.`,
    "",
    "| Program | Result | Details |",
    "| --- | --- | --- |",
  ];
  for (const result of results) {
    const state = result.failures.length ? "❌ fail" : result.warnings.length ? "⚠️ warn" : "✅ ok";
    const details =
      [...result.failures, ...result.warnings, ...result.notes].join("<br>") || "No changes";
    lines.push(
      `| ${result.name} \`${result.address.slice(0, 8)}…\` | ${state} | ${details.replace(/\|/g, "\\|")} |`
    );
  }
  lines.push("", "Re-pin after reviewing: `node scripts/idl-sentinel-check.mjs pin`");
  return lines.join("\n");
}

async function main(argv) {
  const args = parseArgs(argv);
  let config = await readConfig(args.config);
  if (args.api) config = { ...config, api: args.api };
  if (args.command === "pin") {
    const next = await pin(config, args.positional);
    await writeFile(args.config, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Pinned ${Object.keys(next.programs).length} program(s) in ${args.config}`);
    return 0;
  }
  if (args.command !== "check") {
    console.error(
      "Usage: idl-sentinel-check.mjs <check|pin> [addresses...] [--config path] [--fail-on severity]"
    );
    return 2;
  }
  if (!Object.keys(config.programs || {}).length) {
    console.error(
      `No programs pinned in ${args.config}. Run: idl-sentinel-check.mjs pin <address>`
    );
    return 2;
  }
  const outcome = await check(config, { failOn: args.failOn, failOnPending: args.failOnPending });
  const inActions = !!process.env.GITHUB_ACTIONS;
  for (const result of outcome.results) {
    for (const line of result.failures) {
      console.log(
        inActions
          ? `::error title=${escapeProperty(result.name)}::${escapeAnnotation(line)}`
          : `✖ ${result.name}: ${line}`
      );
    }
    for (const line of result.warnings) {
      console.log(
        inActions
          ? `::warning title=${escapeProperty(result.name)}::${escapeAnnotation(line)}`
          : `⚠ ${result.name}: ${line}`
      );
    }
    for (const line of result.notes) console.log(`  ${result.name}: ${line}`);
    if (!result.failures.length && !result.warnings.length)
      console.log(`✔ ${result.name}: unchanged since pin`);
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${renderSummary(outcome)}\n`);
  return outcome.failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(2);
    }
  );
}
