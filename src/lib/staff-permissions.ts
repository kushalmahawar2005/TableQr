// Who may see and do what on the staff console (PS 7.5). Pure data, shared by the server, which
// enforces it, and the sidebar, which hides what a role cannot use. Never trusted from a client.

export const staffRoles = ["owner", "manager", "cashier", "host", "waiter", "kitchen", "accountant"] as const;
export type StaffRole = (typeof staffRoles)[number];

export const consoleSectionRoles = {
  floor: ["host", "manager", "owner"],
  reservations: ["host", "manager", "owner"],
  waitlist: ["host", "manager", "owner"],
  orders: ["cashier", "waiter", "manager", "owner"],
  billing: ["cashier", "manager", "owner", "accountant"],
  menu: ["manager", "owner"],
  pricing: ["manager", "owner"],
  reports: ["manager", "owner", "accountant"],
  settings: ["manager", "owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type ConsoleSectionSlug = keyof typeof consoleSectionRoles;

/** Floor actions (S1). Blocking a table takes it out of service, so it is a manager decision. */
export const floorPermissions = {
  "floor.view": ["host", "manager", "owner"],
  "floor.seat": ["host", "manager", "owner"],
  "floor.clean": ["waiter", "host", "manager", "owner"],
  "floor.reset": ["host", "manager", "owner"],
  "floor.block": ["manager", "owner"],
  "booking.manage": ["host", "manager", "owner"],
  "booking.pause": ["host", "manager", "owner"],
  "booking.capacity": ["manager", "owner"],
  "waitlist.manage": ["host", "manager", "owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type FloorPermission = keyof typeof floorPermissions;

export const canUse = (roles: readonly StaffRole[], allowed: readonly StaffRole[]) => roles.some((r) => allowed.includes(r));
export const canSee = (roles: readonly StaffRole[], section: ConsoleSectionSlug) => canUse(roles, consoleSectionRoles[section]);
export const can = (roles: readonly StaffRole[], permission: FloorPermission) => canUse(roles, floorPermissions[permission]);

/** Kitchen display (S2): who may set up, repin or revoke a wall screen, and who works on one */
export const kdsSetupRoles = ["manager", "owner"] as const satisfies readonly StaffRole[];
export const kdsWorkRoles = ["kitchen", "manager", "owner"] as const satisfies readonly StaffRole[];
