/**
 * Who is acting on a staff screen. Staff sign-in fills this from the session once it exists;
 * until then callers build it directly. Every staff query is scoped by tenantId and outletId.
 */
export type StaffContext = {
  tenantId: string;
  outletId: string;
  userId: string | null;
  /** Who acted, for the audit log when it is not a signed-in user (e.g. "kds:Tandoor") */
  actorLabel?: string;
};
