/**
 * One-shot, idempotent migration of app metadata from local SQLite (`<dataDir>/accounts.sqlite`)
 * into Supabase Postgres (PostgREST). Run before enabling `MUTINYBIM_WEB_SUPABASE_SECRET_KEY`
 * on a deployment that already has accounts or models in SQLite:
 *
 *   node --import tsx apps/mutinybim-web/src/migrate-sqlite.ts [--dry-run]
 *
 * Reads `MUTINYBIM_WEB_DATA` (default `./mutinybim-web-data`), `MUTINYBIM_WEB_SUPABASE_URL`,
 * and `MUTINYBIM_WEB_SUPABASE_SECRET_KEY`. Existing Postgres rows are never overwritten;
 * if a user email already exists in Postgres under a different UUID (e.g. from an earlier
 * OAuth sign-in), foreign keys on copied models, identities, shares, keys, scripts and
 * grants are remapped to the existing Postgres user id.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Fetch } from "./oauth";

export interface MigrateOptions {
  readonly sqlitePath: string;
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly dryRun?: boolean;
  readonly fetchImpl?: Fetch;
}

export interface MigrateSummary {
  readonly tables: Readonly<Record<string, number>>;
  readonly remappedUsers: number;
  readonly dryRun: boolean;
}

type Row = Record<string, unknown>;

const TIMEOUT_MS = 15_000;

function readTable(db: DatabaseSync, table: string): Row[] {
  const exists = db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return [];
  return db.prepare(`SELECT * FROM ${table}`).all() as Row[];
}

function asIsoOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function remap(map: ReadonlyMap<string, string>, id: unknown): string | null {
  if (typeof id !== "string") return null;
  return map.get(id) ?? id;
}

export async function migrateSqliteToSupabase(options: MigrateOptions): Promise<MigrateSummary> {
  if (!existsSync(options.sqlitePath)) {
    throw new Error(`SQLite database not found at ${options.sqlitePath}`);
  }
  const baseUrl = options.supabaseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const dryRun = Boolean(options.dryRun);

  async function request(endpoint: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: options.secretKey,
      authorization: `Bearer ${options.secretKey}`,
      accept: "application/json",
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.prefer) headers.prefer = init.prefer;
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase PostgREST ${init.method ?? "GET"} ${endpoint} failed (${response.status}): ${text.slice(0, 300)}`);
    }
    if (!text) return null;
    return JSON.parse(text) as unknown;
  }

  async function upsertBatch(table: string, onConflict: string, rows: readonly Row[]): Promise<number> {
    if (rows.length === 0) return 0;
    if (dryRun) return rows.length;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: "POST",
        body: rows.slice(i, i + CHUNK),
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
    }
    return rows.length;
  }

  const sqlite = new DatabaseSync(options.sqlitePath, { readOnly: true });
  try {
    const counts: Record<string, number> = {};
    const userIdMap = new Map<string, string>();

    // 1. Users — check existing Postgres users by email so pre-existing OAuth users merge cleanly.
    const existingUsersRaw = await request("/rest/v1/users?select=id,email,password_hash");
    const existingByEmail = new Map<string, { id: string; passwordHash: string | null }>();
    if (Array.isArray(existingUsersRaw)) {
      for (const row of existingUsersRaw) {
        if (row && typeof row === "object" && typeof (row as Row).email === "string" && typeof (row as Row).id === "string") {
          const r = row as Row;
          existingByEmail.set(String(r.email).toLowerCase(), {
            id: String(r.id),
            passwordHash: typeof r.password_hash === "string" ? r.password_hash : null,
          });
        }
      }
    }

    const sqliteUsers = readTable(sqlite, "users");
    const usersToInsert: Row[] = [];
    for (const u of sqliteUsers) {
      const id = String(u.id);
      const email = String(u.email).trim().toLowerCase();
      const existing = existingByEmail.get(email);
      if (existing) {
        if (existing.id !== id) userIdMap.set(id, existing.id);
        if (!existing.passwordHash && typeof u.password_hash === "string" && u.password_hash && !dryRun) {
          await request(`/rest/v1/users?id=eq.${encodeURIComponent(existing.id)}`, {
            method: "PATCH",
            body: { password_hash: u.password_hash },
            prefer: "return=minimal",
          });
        }
      } else {
        usersToInsert.push({
          id,
          email,
          display_name: String(u.display_name ?? email.split("@")[0] ?? "User"),
          password_hash: typeof u.password_hash === "string" ? u.password_hash : null,
          color_scheme: u.color_scheme === "light" || u.color_scheme === "dark" ? u.color_scheme : "system",
          created_at: asIsoOrNull(u.created_at) ?? new Date().toISOString(),
        });
      }
    }
    counts.users = await upsertBatch("users", "id", usersToInsert);

    // 2. Identities
    counts.identities = await upsertBatch(
      "identities",
      "provider,subject",
      readTable(sqlite, "identities").map((r) => ({
        provider: String(r.provider),
        subject: String(r.subject),
        user_id: remap(userIdMap, r.user_id),
        created_at: asIsoOrNull(r.created_at) ?? new Date().toISOString(),
      })),
    );

    // 3. Active sessions (unexpired only, so existing signed-in users aren't kicked out)
    const nowIso = new Date().toISOString();
    counts.sessions = await upsertBatch(
      "sessions",
      "token_hash",
      readTable(sqlite, "sessions")
        .filter((r) => typeof r.expires_at === "string" && r.expires_at > nowIso)
        .map((r) => ({
          token_hash: String(r.token_hash),
          user_id: remap(userIdMap, r.user_id),
          signed_in_via: String(r.signed_in_via ?? "password"),
          created_at: asIsoOrNull(r.created_at) ?? nowIso,
          expires_at: String(r.expires_at),
        })),
    );

    // 4. Models
    counts.models = await upsertBatch(
      "models",
      "id",
      readTable(sqlite, "models").map((r) => ({
        id: String(r.id),
        owner_id: remap(userIdMap, r.owner_id),
        name: String(r.name),
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
        updated_at: asIsoOrNull(r.updated_at) ?? nowIso,
      })),
    );

    // 5. Model shares
    counts.model_shares = await upsertBatch(
      "model_shares",
      "model_id,user_id",
      readTable(sqlite, "model_shares").map((r) => ({
        model_id: String(r.model_id),
        user_id: remap(userIdMap, r.user_id),
        role: r.role === "view" ? "view" : "edit",
        invited_by: remap(userIdMap, r.invited_by),
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
      })),
    );

    // 6. Dynamically registered OAuth clients
    counts.oauth_clients = await upsertBatch(
      "oauth_clients",
      "issuer",
      readTable(sqlite, "oauth_clients").map((r) => ({
        issuer: String(r.issuer),
        client_id: String(r.client_id),
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
      })),
    );

    // 7. Agent keys
    counts.agent_keys = await upsertBatch(
      "agent_keys",
      "id",
      readTable(sqlite, "agent_keys").map((r) => ({
        id: String(r.id),
        user_id: remap(userIdMap, r.user_id),
        name: String(r.name),
        token_hash: String(r.token_hash),
        token_prefix: String(r.token_prefix),
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
        last_used_at: asIsoOrNull(r.last_used_at),
        revoked_at: asIsoOrNull(r.revoked_at),
      })),
    );

    // 8. Assistant OAuth clients
    counts.assistant_clients = await upsertBatch(
      "assistant_clients",
      "client_id",
      readTable(sqlite, "assistant_clients").map((r) => ({
        client_id: String(r.client_id),
        client_name: String(r.client_name),
        redirect_uris: String(r.redirect_uris),
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
      })),
    );

    // 9. Assistant grants
    counts.assistant_grants = await upsertBatch(
      "assistant_grants",
      "id",
      readTable(sqlite, "assistant_grants").map((r) => ({
        id: String(r.id),
        client_id: String(r.client_id),
        user_id: remap(userIdMap, r.user_id),
        label: String(r.label),
        scope: String(r.scope),
        access_hash: String(r.access_hash),
        access_expires_at: String(r.access_expires_at),
        refresh_hash: typeof r.refresh_hash === "string" ? r.refresh_hash : null,
        refresh_expires_at: asIsoOrNull(r.refresh_expires_at),
        previous_refresh_hash: typeof r.previous_refresh_hash === "string" ? r.previous_refresh_hash : null,
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
        last_used_at: asIsoOrNull(r.last_used_at),
        revoked_at: asIsoOrNull(r.revoked_at),
      })),
    );

    // 10. Kept scripts
    counts.kept_scripts = await upsertBatch(
      "kept_scripts",
      "id",
      readTable(sqlite, "kept_scripts").map((r) => ({
        id: String(r.id),
        user_id: remap(userIdMap, r.user_id),
        name: String(r.name),
        source: String(r.source),
        summary: String(r.summary ?? ""),
        created_at: asIsoOrNull(r.created_at) ?? nowIso,
        updated_at: asIsoOrNull(r.updated_at) ?? nowIso,
      })),
    );

    // 11. Linked host grants, cached models, and offers
    counts.linked_grants = await upsertBatch(
      "linked_grants",
      "user_id,provider",
      readTable(sqlite, "linked_grants").map((r) => ({
        user_id: remap(userIdMap, r.user_id),
        provider: String(r.provider),
        scope: String(r.scope),
        access_enc: String(r.access_enc),
        access_expires_at: asIsoOrNull(r.access_expires_at),
        refresh_enc: typeof r.refresh_enc === "string" ? r.refresh_enc : null,
        state: r.state === "reconnect" ? "reconnect" : "active",
        updated_at: asIsoOrNull(r.updated_at) ?? nowIso,
      })),
    );

    counts.linked_models = await upsertBatch(
      "linked_models",
      "user_id,provider,remote_id",
      readTable(sqlite, "linked_models").map((r) => ({
        alias_id: String(r.alias_id),
        user_id: remap(userIdMap, r.user_id),
        provider: String(r.provider),
        remote_id: String(r.remote_id),
        label: String(r.label),
        open_url: typeof r.open_url === "string" ? r.open_url : null,
        can_edit: asBool(r.can_edit),
        updated_at: asIsoOrNull(r.updated_at) ?? nowIso,
      })),
    );

    counts.linked_offers = await upsertBatch(
      "linked_offers",
      "user_id,provider",
      readTable(sqlite, "linked_offers").map((r) => ({
        user_id: remap(userIdMap, r.user_id),
        provider: String(r.provider),
        answered_at: asIsoOrNull(r.answered_at) ?? nowIso,
      })),
    );

    return { tables: counts, remappedUsers: userIdMap.size, dryRun };
  } finally {
    sqlite.close();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const dataDir = path.resolve(process.env.MUTINYBIM_WEB_DATA ?? "mutinybim-web-data");
  const sqliteArg = process.argv.find((a) => a.startsWith("--sqlite="))?.slice("--sqlite=".length);
  const sqlitePath = sqliteArg ? path.resolve(sqliteArg) : path.join(dataDir, "accounts.sqlite");
  const supabaseUrl = process.env.MUTINYBIM_WEB_SUPABASE_URL?.trim();
  const secretKey = process.env.MUTINYBIM_WEB_SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !secretKey) {
    console.error("Set MUTINYBIM_WEB_SUPABASE_URL and MUTINYBIM_WEB_SUPABASE_SECRET_KEY before running migrate-sqlite.");
    process.exit(1);
  }
  const summary = await migrateSqliteToSupabase({ sqlitePath, supabaseUrl, secretKey, dryRun });
  console.log("[mutinybim-web] sqlite -> supabase migration complete", summary);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((err) => {
    console.error("[mutinybim-web] sqlite -> supabase migration failed:", err);
    process.exit(1);
  });
}
