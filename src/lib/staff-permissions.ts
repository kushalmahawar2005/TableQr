// Who may see and do what on the staff console (PS 7.5). Pure data, shared by the server, which
// enforces it, and the sidebar, which hides what a role cannot use. Never trusted from a client.

export const staffRoles = ["owner", "manager", "cashier", "host", "waiter", "kitchen", "accountant", "reception"] as const;
export type StaffRole = (typeof staffRoles)[number];

export const consoleSectionRoles = {
  /** O1 Owner Dashboard: read-only, the current outlet only */
  dashboard: ["manager", "owner"],
  floor: ["host", "manager", "owner"],
  /** Hotel rooms: the front desk checks guests in and out and answers room requests */
  rooms: ["reception", "manager", "owner"],
  reservations: ["host", "manager", "owner"],
  waitlist: ["host", "manager", "owner"],
  orders: ["cashier", "waiter", "manager", "owner"],
  /** The kitchen board inside the console, on every plan (the separate wall screen is a plan feature) */
  kitchen: ["kitchen", "manager", "owner"],
  billing: ["cashier", "manager", "owner", "accountant", "reception"],
  menu: ["manager", "owner"],
  /** Stock and recipes */
  inventory: ["manager", "owner"],
  pricing: ["manager", "owner"],
  reports: ["manager", "owner", "accountant"],
  /** Phone numbers of guests: owners and managers only */
  customers: ["manager", "owner"],
  team: ["manager", "owner"],
  settings: ["manager", "owner"],
  /** What the restaurant pays TableQR, and paying it */
  plan: ["manager", "owner"],
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
  "floor_plan.view": ["manager", "owner"],
  "floor_plan.edit": ["manager", "owner"],
  "floor_plan.publish": ["manager", "owner"],
  "floor_plan.qr": ["manager", "owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type FloorPermission = keyof typeof floorPermissions;

export const canUse = (roles: readonly StaffRole[], allowed: readonly StaffRole[]) => roles.some((r) => allowed.includes(r));
export const canSee = (roles: readonly StaffRole[], section: ConsoleSectionSlug) => canUse(roles, consoleSectionRoles[section]);
export const can = (roles: readonly StaffRole[], permission: FloorPermission) => canUse(roles, floorPermissions[permission]);

/** Outlet price overrides (O4). Brand prices stay with the Menu Manager (O3). */
export const pricingPermissions = {
  "pricing.view": ["manager", "owner"],
  "pricing.edit": ["owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type PricingPermission = keyof typeof pricingPermissions;
export const canPrice = (roles: readonly StaffRole[], permission: PricingPermission) => canUse(roles, pricingPermissions[permission]);

/** Kitchen display (S2): who may set up, repin or revoke a wall screen, and who works on one */
/** Who signs a kitchen wall screen in, with their own phone and PIN: kitchen staff, managers and owners */
export const kdsSetupRoles = ["kitchen", "manager", "owner"] as const satisfies readonly StaffRole[];
export const kdsWorkRoles = ["kitchen", "manager", "owner"] as const satisfies readonly StaffRole[];
