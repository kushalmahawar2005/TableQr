// Who may see and do what on the staff console (PS 7.5). Pure data, shared by the server, which
// enforces it, and the sidebar, which hides what a role cannot use. Never trusted from a client.

export const staffRoles = ["owner", "manager", "cashier", "host", "waiter", "kitchen", "accountant", "reception", "rider"] as const;
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
  /** The POS terminal: punch an order for a table or a takeaway at the counter, then bill it */
  pos: ["cashier", "manager", "owner", "reception"],
  menu: ["manager", "owner"],
  /** Stock and recipes */
  inventory: ["manager", "owner"],
  pricing: ["manager", "owner"],
  reports: ["manager", "owner", "accountant"],
  /** Phone numbers of guests: owners and managers only */
  customers: ["manager", "owner"],
  team: ["manager", "owner"],
  /** The daily attendance register: managers and owners mark who was present, absent or on a half day */
  attendance: ["manager", "owner"],
  settings: ["manager", "owner"],
  /** What the restaurant pays Tableeqr, and paying it */
  plan: ["manager", "owner"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type ConsoleSectionSlug = keyof typeof consoleSectionRoles;

/**
 * Per restaurant, the platform admin can take sections away from roles, and give the read-only
 * sections below to more roles. The owner always keeps everything. Stored per tenant; a section
 * that is not listed follows the defaults above.
 */
export type RoleAccess = Partial<Record<ConsoleSectionSlug, StaffRole[]>>;
/** Sections a role can be added to: they only show information, so no action needs more roles */
export const grantableSections = ["dashboard", "reports", "customers"] as const satisfies readonly ConsoleSectionSlug[];
/** Roles the admin can tick for a section: its defaults, or every role for a read-only section */
export const assignableRoles = (section: ConsoleSectionSlug): readonly StaffRole[] =>
  ((grantableSections as readonly string[]).includes(section) ? (staffRoles as readonly StaffRole[]) : (consoleSectionRoles[section] as readonly StaffRole[])).filter((r) => r !== "owner");

/** Who may open a section at this restaurant, after the admin's changes; the owner always may */
export function sectionRoles(section: ConsoleSectionSlug, access?: RoleAccess | null): readonly StaffRole[] {
  const chosen = access?.[section];
  if (!chosen) return consoleSectionRoles[section];
  const allowed = assignableRoles(section);
  return ["owner", ...chosen.filter((r) => allowed.includes(r))];
}

/** Keeps only the changes the admin may make, so a saved value can never widen an action section */
export function cleanRoleAccess(input: unknown): RoleAccess {
  const out: RoleAccess = {};
  if (!input || typeof input !== "object") return out;
  for (const section of Object.keys(consoleSectionRoles) as ConsoleSectionSlug[]) {
    const raw = (input as Record<string, unknown>)[section];
    if (!Array.isArray(raw)) continue;
    const allowed = assignableRoles(section);
    const roles = [...new Set(raw.filter((r): r is StaffRole => typeof r === "string" && allowed.includes(r as StaffRole)))];
    // Only store a section that differs from the defaults
    const defaults: readonly StaffRole[] = consoleSectionRoles[section].filter((r) => r !== "owner");
    if (roles.length !== defaults.length || roles.some((r) => !defaults.includes(r))) out[section] = roles;
  }
  return out;
}

/**
 * Roles allowed to run one of a section's actions at this restaurant: the action's own roles less
 * any the admin took off the section. Roles added to a read-only section get its general actions.
 */
export function actionRoles(allowed: readonly StaffRole[], section: ConsoleSectionSlug, access?: RoleAccess | null): StaffRole[] {
  const defaults: readonly StaffRole[] = consoleSectionRoles[section];
  const effective = sectionRoles(section, access);
  const kept = allowed.filter((r) => effective.includes(r));
  const general = defaults.every((r) => allowed.includes(r));
  const added = general ? effective.filter((r) => !defaults.includes(r)) : [];
  return [...new Set<StaffRole>([...kept, ...added])];
}

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
/** Whether these roles may open a section; pass the signed-in staff (with `access`) to apply the restaurant's changes */
export const canSee = (who: readonly StaffRole[] | { roles: readonly StaffRole[]; access?: RoleAccess | null }, section: ConsoleSectionSlug) =>
  Array.isArray(who) ? canUse(who, consoleSectionRoles[section]) : canUse((who as { roles: readonly StaffRole[] }).roles, sectionRoles(section, (who as { access?: RoleAccess | null }).access));
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

/**
 * Who may print which slip. Setting printers up is a Settings action, so managers and owners; anyone
 * who prints a slip as part of their work may print it. Checked on the server for every job.
 */
export const printRoles = {
  receipt: ["cashier", "waiter", "host", "reception", "accountant", "manager", "owner"],
  bill: ["cashier", "waiter", "host", "reception", "accountant", "manager", "owner"],
  kot: ["cashier", "reception", "kitchen", "waiter", "manager", "owner"],
  order_slip: ["cashier", "waiter", "manager", "owner"],
  day_close: ["manager", "owner", "accountant"],
  test: ["manager", "owner"],
} as const satisfies Record<string, readonly StaffRole[]>;
export type PrintRoleKind = keyof typeof printRoles;
export const canPrintKind = (roles: readonly StaffRole[], kind: PrintRoleKind) => canUse(roles, printRoles[kind]);
