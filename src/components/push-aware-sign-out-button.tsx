"use client";

import { useState, type ReactNode } from "react";
import { signOutWithPushAction } from "@/app/(console)/console/login/actions";
import { signOutRiderWithPushAction } from "@/app/(staff)/rider/login/actions";

/** Unsubscribe the current browser endpoint and remove its tenant-scoped server record on logout. */
export function PushAwareSignOutButton({
  audience = "staff",
  className,
  children,
  ariaLabel,
  title,
  disabled = false,
}: {
  audience?: "staff" | "rider";
  className: string;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    let endpoint = "";
    try {
      const registration = await navigator.serviceWorker?.getRegistration("/");
      const notifications = await registration?.getNotifications();
      notifications?.forEach((notification) => {
        const url = typeof notification.data?.url === "string" ? notification.data.url : "";
        if (typeof notification.data?.sessionId === "string" || /^\/(console|waiter|rider)(\/|$)/.test(url)) notification.close();
      });
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => false);
      }
    } catch {
      // Session sign-out should still work when push is unsupported or unavailable.
    }
    try {
      if (audience === "rider") await signOutRiderWithPushAction(endpoint);
      else await signOutWithPushAction(endpoint);
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      disabled={busy || disabled}
      onClick={() => void signOut()}
      className={className}
    >
      {children}
    </button>
  );
}
