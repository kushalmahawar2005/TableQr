import { describe, expect, it } from "vitest";
import { readFeatures } from "./plan-features";
import { canOpenNotification, orderNotificationDestination } from "./staff-notification-access";
import { pushNotificationDestination } from "./staff-push-audience";

const features = readFeatures({ waiterApp: true, delivery: true, kitchenDisplay: true, reservations: true });
const owner = { id: "owner", roles: ["owner"] as const, duty: "off" };
const waiter = { id: "waiter", roles: ["waiter"] as const, duty: "on" };
const ready = { kind: "ready", sessionId: "visit" } as const;

describe("staff notification permissions and destinations", () => {
  it("does not send waiter task alerts to an owner when the waiter app is off", () => {
    for (const kind of ["ready", "service"] as const) {
      expect(pushNotificationDestination(owner, { ...features, waiterApp: false }, "/waiter", { kind, sessionId: "visit" }, null)).toBeNull();
    }
    expect(pushNotificationDestination(owner, { ...features, waiterApp: false }, "/console", { kind: "order", sessionId: "visit" }, null)).toBe("/console/orders");
  });
  it("keeps waiter duty and assignment rules", () => {
    expect(pushNotificationDestination(waiter, features, "/waiter", ready, waiter.id)).toBe("/waiter");
    expect(pushNotificationDestination(waiter, features, "/waiter", ready, "another-waiter")).toBeNull();
    expect(pushNotificationDestination({ ...waiter, duty: "off" }, features, "/waiter", ready, null)).toBeNull();
  });
  it("opens kitchen alerts in the kitchen rather than the delivery desk", () => {
    const kitchen = { id: "chef", roles: ["kitchen"] as const, duty: "on" };
    expect(pushNotificationDestination(kitchen, features, "/console/orders?view=delivery", { kind: "delivery" }, null)).toBe("/console/kitchen");
    expect(orderNotificationDestination(kitchen, features)).toBe("/console/kitchen");
    expect(pushNotificationDestination(kitchen, { ...features, kitchenDisplay: false }, "/console", { kind: "delivery" }, null)).toBeNull();
    expect(pushNotificationDestination(owner, { ...features, delivery: false }, "/console/orders?view=delivery", { kind: "delivery" }, null)).toBeNull();
  });
  it("honours section restrictions for management and payment alerts", () => {
    const manager = { id: "manager", roles: ["manager"] as const, duty: "on", access: { reservations: [], orders: [] } };
    expect(pushNotificationDestination(manager, features, "/console/reservations", { kind: "management" }, null)).toBeNull();
    expect(pushNotificationDestination(manager, features, "/console/orders?view=delivery", { kind: "management" }, null)).toBeNull();
  });
  it("lets a host receive bookings only while reservations are enabled", () => {
    const host = { id: "host", roles: ["host"] as const, duty: "on" };
    expect(pushNotificationDestination(host, features, "/console/reservations", { kind: "management" }, null)).toBe("/console/reservations");
    expect(pushNotificationDestination(host, { ...features, reservations: false }, "/console/reservations", { kind: "management" }, null)).toBeNull();
  });
  it("keeps rider assignment alerts exclusive to the assigned rider", () => {
    const audience = { riderUserId: "rider" };
    expect(pushNotificationDestination(owner, features, "/rider", audience, null)).toBeNull();
    expect(pushNotificationDestination({ id: "rider", roles: ["rider"], duty: "on" }, features, "/rider", audience, null)).toBe("/rider");
  });
  it("hides bell destinations outside the staff member's access or package", () => {
    expect(canOpenNotification(waiter, features, "/console/billing")).toBe(false);
    expect(canOpenNotification({ roles: ["kitchen"] }, features, "/console/reservations")).toBe(false);
    expect(canOpenNotification(owner, { ...features, rooms: false }, "/console/rooms")).toBe(false);
    expect(canOpenNotification(owner, { ...features, dineIn: false }, "/console/floor")).toBe(false);
  });
});
