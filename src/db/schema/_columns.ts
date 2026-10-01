import { char, datetime, foreignKey, uniqueIndex, type MySqlColumn } from "drizzle-orm/mysql-core";
import { uuidv7 } from "../id";

// Shared column builders. Money is always integer paise; timestamps are UTC.

export const id = () => char("id", { length: 36 }).primaryKey().$defaultFn(uuidv7);

export const ref = (name: string) => char(name, { length: 36 });

/** Every tenant-owned row carries this; queries must always filter on it. */
export const tenantId = () => ref("tenant_id").notNull();

export const at = (name: string) => datetime(name, { mode: "date", fsp: 3 });

/** Not-null timestamp set on insert; pass a name for columns like placed_at */
export const createdAt = (name = "created_at") =>
  at(name)
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  at("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

// Tenant isolation enforced by the database. Every parent row exposes (tenant_id, id) and every
// child points at it with its own tenant_id, so a row can only reference a parent owned by the
// same restaurant, whatever the application code does.

type Keyed = { tenantId: MySqlColumn; id: MySqlColumn };

/** Unique (tenant_id, id) on a parent table, the target of same-tenant foreign keys */
export const tenantKey = (table: string, t: Keyed) => uniqueIndex(`${table}_tenant_key`).on(t.tenantId, t.id);

/** Foreign key (tenant_id, column) -> parent (tenant_id, id). A null column is not checked. */
export const sameTenant = (name: string, t: { tenantId: MySqlColumn }, column: MySqlColumn, parent: Keyed) =>
  foreignKey({
    name,
    columns: [t.tenantId, column],
    foreignColumns: [parent.tenantId, parent.id],
  } as unknown as Parameters<typeof foreignKey>[0]);
