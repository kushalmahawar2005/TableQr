"use client";

// Moving around the admin from anywhere: open a page, and optionally one tenant's panel on it.

const EVENT = "admin:open";
let pendingTenant: string | null = null;

export function openAdminPage(page: string, tenantId?: string) {
  pendingTenant = tenantId ?? null;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { page } }));
}

/** The tenant a link asked to open, once; the Tenants page reads it when it appears */
export function takePendingTenant() {
  const id = pendingTenant;
  pendingTenant = null;
  return id;
}

export function onAdminOpen(handler: (page: string) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<{ page: string }>).detail.page);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
