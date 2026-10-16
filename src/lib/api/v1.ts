import { NextResponse } from "next/server";
import { supabaseAdmin } from "../supabase";
import { getProgramByAddress } from "../db/programs";
import { getProgramChainState } from "../db/chain";
import { currentVerification } from "../chain/state";
import { isOpenProposal } from "../chain/squads";
import { changeCategory, changeTypesInCategory, type ChangeCategory } from "../changes/categories";
import { SEVERITY_ORDER, getProgramUrl } from "../notifications/format";
import type { ChangeSeverity } from "../db/changes";
import type { MonitoredProgram } from "../supabase";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Public, read-only JSON. Short shared caching keeps polling integrations cheap. */
export function apiJson(body: unknown, init: { status?: number; maxAge?: number } = {}) {
  const status = init.status ?? 200;
  return NextResponse.json(body, {
    status,
    headers: {
      ...CORS,
      "Cache-Control":
        status === 200
          ? `public, s-maxage=${init.maxAge ?? 60}, stale-while-revalidate=60`
          : "no-store",
    },
  });
}

export function apiError(status: number, error: string) {
  return apiJson({ error }, { status });
}

export function apiOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

const CATEGORIES: ChangeCategory[] = ["idl", "code", "authority", "governance", "verification"];

export interface ChangeQuery {
  programDbId?: string;
  since?: string;
  cursor?: { time: string; id: string };
  minSeverity?: ChangeSeverity;
  category?: ChangeCategory;
  limit: number;
}

/**
 * Opaque, URL-safe cursor over (detected_at, id). It keeps the database's own
 * timestamp text, whose microseconds a JS Date would drop.
 */
export function encodeCursor(time: string, id: string): string {
  return Buffer.from(`${time}_${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { time: string; id: string } | null {
  if (!/^[\w-]{1,200}$/.test(cursor)) return null;
  const [time, id, extra] = Buffer.from(cursor, "base64url").toString("utf8").split("_");
  if (extra !== undefined || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (!/^[\d\-T:.+Z ]+$/.test(time) || Number.isNaN(Date.parse(time))) return null;
  return { time, id };
}

export function parseChangeQuery(params: URLSearchParams): ChangeQuery | string {
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const query: ChangeQuery = { limit };
  const since = params.get("since");
  if (since) {
    // A literal "+" in an unencoded query arrives as a space ("…+00:00" → "… 00:00").
    const time = [since, since.replace(/ (\d{2}:?\d{2})$/, "+$1")].find(
      (candidate) => !Number.isNaN(Date.parse(candidate))
    );
    if (!time) return "since must be an ISO 8601 timestamp";
    query.since = new Date(time).toISOString();
  }
  const cursor = params.get("cursor");
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) return "cursor is malformed";
    query.cursor = decoded;
  }
  const minSeverity = params.get("min_severity");
  if (minSeverity) {
    if (!SEVERITY_ORDER.includes(minSeverity as ChangeSeverity)) {
      return "min_severity must be low, medium, high, or critical";
    }
    query.minSeverity = minSeverity as ChangeSeverity;
  }
  const category = params.get("category");
  if (category) {
    if (!CATEGORIES.includes(category as ChangeCategory)) {
      return `category must be one of ${CATEGORIES.join(", ")}`;
    }
    query.category = category as ChangeCategory;
  }
  return query;
}

interface ChangeRow {
  id: string;
  change_type: string;
  change_summary: string;
  severity: ChangeSeverity;
  detected_at: string;
  change_details?: unknown;
  monitored_programs: { id: string; name: string; program_id: string };
}

export function serializeChange(row: ChangeRow, includeDetails = false) {
  return {
    id: row.id,
    type: row.change_type,
    category: changeCategory(row.change_type),
    severity: row.severity,
    summary: row.change_summary,
    detected_at: row.detected_at,
    program: {
      address: row.monitored_programs.program_id,
      name: row.monitored_programs.name,
      url: getProgramUrl(row.monitored_programs.id),
    },
    ...(includeDetails ? { details: row.change_details ?? null } : {}),
  };
}

const PROGRAM_CHANGE_TYPES = CATEGORIES.flatMap((c) => changeTypesInCategory(c) ?? []);

/**
 * Ascending by (detected_at, id) after `since` or `cursor`, so a poller can
 * resume from `next_cursor` without gaps; otherwise the newest changes first.
 */
export async function queryChanges(query: ChangeQuery) {
  const ascending = !!(query.since || query.cursor);
  let request = supabaseAdmin
    .from("idl_changes")
    .select(
      "id, change_type, change_summary, severity, detected_at, monitored_programs!inner(id, name, program_id)"
    )
    .order("detected_at", { ascending })
    .order("id", { ascending })
    .limit(query.limit + 1);
  if (query.programDbId) request = request.eq("program_id", query.programDbId);
  if (query.since && !query.cursor) request = request.gt("detected_at", query.since);
  if (query.cursor) {
    request = request.or(
      `detected_at.gt."${query.cursor.time}",and(detected_at.eq."${query.cursor.time}",id.gt.${query.cursor.id})`
    );
  }
  if (query.minSeverity) {
    request = request.in(
      "severity",
      SEVERITY_ORDER.slice(0, SEVERITY_ORDER.indexOf(query.minSeverity) + 1)
    );
  }
  if (query.category === "idl") {
    request = request.not("change_type", "in", `(${PROGRAM_CHANGE_TYPES.join(",")})`);
  } else if (query.category) {
    request = request.in("change_type", changeTypesInCategory(query.category)!);
  }
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  const rows = (data || []) as unknown as ChangeRow[];
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    changes: page.map((row) => serializeChange(row)),
    next_cursor: ascending && last ? encodeCursor(last.detected_at, last.id) : null,
    has_more: rows.length > query.limit,
  };
}

export async function getChangeById(id: string) {
  const { data, error } = await supabaseAdmin
    .from("idl_changes")
    .select(
      "id, change_type, change_summary, severity, detected_at, change_details, monitored_programs!inner(id, name, program_id)"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? serializeChange(data as unknown as ChangeRow, true) : null;
}

export async function getLatestIdlSnapshot(programDbId: string, includeContent: boolean) {
  const { data, error } = await supabaseAdmin
    .from("idl_snapshots")
    .select(
      includeContent
        ? "idl_hash, version_number, fetched_at, idl_content"
        : "idl_hash, version_number, fetched_at"
    )
    .eq("program_id", programDbId)
    .order("version_number", { ascending: false })
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as {
    idl_hash: string;
    version_number: number;
    fetched_at: string;
    idl_content?: unknown;
  } | null;
}

/** Loads a registered program by its Solana address, or null. */
export async function findProgram(address: string): Promise<MonitoredProgram | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  return getProgramByAddress(address);
}

export async function serializeProgramStatus(program: MonitoredProgram) {
  const [idl, chain] = await Promise.all([
    getLatestIdlSnapshot(program.id, false),
    getProgramChainState(program.id),
  ]);
  const state = chain?.state ?? null;
  const verified = state ? currentVerification(state) : null;
  return {
    program: {
      address: program.program_id,
      name: program.name,
      description: program.description ?? null,
      active: program.is_active,
      url: getProgramUrl(program.id),
    },
    idl: idl
      ? { hash: idl.idl_hash, version: idl.version_number, fetched_at: idl.fetched_at }
      : null,
    chain: state
      ? {
          checked_at: chain!.checked_at,
          loader: state.loader,
          status: state.status,
          deploy_slot: state.deploySlot,
          deployed_at: state.deployedAt ? new Date(state.deployedAt * 1000).toISOString() : null,
          code_hash: state.codeHash,
          upgradeable: state.upgradeAuthority !== null,
          upgrade_authority: state.upgradeAuthority,
          authority_kind: state.authorityKind,
          multisig: state.squads
            ? {
                kind: "squads_v4",
                address: state.squads.multisig,
                threshold: state.squads.threshold,
                members: state.squads.members.length,
                time_lock_seconds: state.squads.timeLock,
                pending_proposals: state.squads.proposals
                  .filter((p) => isOpenProposal(p.status))
                  .map((p) => ({
                    index: p.index,
                    status: p.status,
                    approvals: p.approvals,
                    actions: p.actions,
                    executable_at: p.executableAt
                      ? new Date(p.executableAt * 1000).toISOString()
                      : null,
                  })),
              }
            : null,
          verification: verified
            ? {
                status: verified.status,
                repo_url: verified.repoUrl,
                commit: verified.commit,
                checked_at: verified.checkedAt,
              }
            : state.codeHash
              ? { status: "pending", repo_url: null, commit: null, checked_at: null }
              : null,
        }
      : null,
  };
}
