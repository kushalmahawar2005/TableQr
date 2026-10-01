// Deliberately broken queries that the isolation guard must flag. Never imported.
/* eslint-disable */
// @ts-nocheck
export const a = () =>
  db.select().from(s.orders).where(eq(s.orders.id, id));
export const b = () => db.select().from(s.plans).where(eq(s.plans.code, "pro"));
export const c = () =>
  db.update(s.menuItems).set({ pricePaise: 1 }).where(eq(s.menuItems.id, id));
export const d = () => db.select().from(s.orders).where(eq(s.orders.tenantId, t));
export const e = () => db.execute(sql`DELETE FROM orders WHERE id = ${id}`);
