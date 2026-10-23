// Guardrail for tenant isolation (PS 9.2, 10.1). MySQL has no row-level security, so every query
// on restaurant data must filter by tenant_id in code. This test reads every server file and fails
// the build if a query on a tenant-owned table does not mention tenantId.
//
// A query that legitimately cannot filter by tenant (for example, resolving the tenant from a
// public QR code or globally unique custom domain) is marked with an "isolation-exempt: <reason>"
// comment immediately before the query.
import { getTableColumns, getTableName } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

const SERVER_DIR = path.resolve(import.meta.dirname, "../src/server");

const tenantTables = new Map<string, string>(); // export name -> SQL table name
for (const [name, value] of Object.entries(schema)) {
  if (value instanceof MySqlTable && "tenantId" in getTableColumns(value)) {
    tenantTables.set(name, getTableName(value));
  }
}

function serverFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return serverFiles(full);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [full] : [];
  });
}

type Violation = { file: string; line: number; statement: string };

/** Text of one query chain: from the match to the end of its statement */
function statementAt(src: string, index: number) {
  const end = src.indexOf(";", index);
  return src.slice(index, end === -1 ? undefined : end);
}

function findViolations(file: string): Violation[] {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(path.resolve(import.meta.dirname, ".."), file);
  const out: Violation[] = [];
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  const exempt = (i: number) => {
    const before = src.slice(0, i).split("\n").slice(-4).join("\n");
    return /isolation-exempt:/.test(before);
  };

  // Query builder chains on a schema table: select ... from, update, delete, insert
  const builder = /\.(from|update|delete|insert)\(\s*s\.(\w+)\s*\)/g;
  for (const m of src.matchAll(builder)) {
    if (!tenantTables.has(m[2])) continue;
    const stmt = statementAt(src, m.index!);
    if (/tenantId/.test(stmt) || exempt(m.index!)) continue;
    out.push({ file: rel, line: lineOf(m.index!), statement: stmt.split("\n")[0].trim() });
  }

  // Raw SQL naming a tenant table must mention tenant_id. ${...} parts are Drizzle column
  // references inside a builder query (already checked above), not raw table names.
  const raw = /sql`([^`]*)`/g;
  for (const m of src.matchAll(raw)) {
    const text = m[1].replace(/\$\{[^}]*\}/g, "");
    const touches = [...tenantTables.values()].some((t) => new RegExp(`\\b${t}\\b`).test(text));
    if (touches && !/tenant_id/.test(text) && !exempt(m.index!)) {
      out.push({ file: rel, line: lineOf(m.index!), statement: text.trim().split("\n")[0] });
    }
  }
  return out;
}

describe("tenant isolation guard", () => {
  it("knows which tables are tenant-owned", () => {
    expect(tenantTables.size).toBeGreaterThan(25);
    expect(tenantTables.has("orders")).toBe(true);
    expect(tenantTables.has("plans")).toBe(false);
  });

  it("finds no server query on restaurant data without a tenant filter", () => {
    const violations = serverFiles(SERVER_DIR).flatMap(findViolations);
    const report = violations.map((v) => `${v.file}:${v.line}  ${v.statement}`).join("\n");
    expect(report, `Queries missing a tenantId filter:\n${report}`).toBe("");
  });

  it("catches a query that forgets the tenant filter", () => {
    const tmp = path.join(import.meta.dirname, "fixtures", "leaky.ts");
    const found = findViolations(tmp);
    // Two builder queries without tenantId, and one raw SQL delete on a tenant table
    expect(found.map((v) => v.line)).toEqual([5, 8, 10]);
  });
});
