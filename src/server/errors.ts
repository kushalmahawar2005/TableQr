// Errors the UI can act on. Messages follow the spec's writing rules (UI spec 9.3):
// say what happened and what to do, never blame the guest.

export type AppErrorCode =
  | "not_found"
  | "qr_revoked"
  | "outlet_unavailable"
  | "outlet_closed"
  | "table_not_open"
  | "table_settling"
  | "verification_required"
  /** The table host removed this phone from the current table session (G7) */
  | "participant_removed"
  | "session_expired"
  | "ordering_locked"
  | "cart_empty"
  | "invalid_line"
  | "items_unavailable"
  | "needs_staff_confirmation"
  | "invalid_state"
  | "recall_expired"
  | "needs_choice"
  | "name_required"
  | "phone_required"
  | "invalid_name"
  /** Staff: not signed in, or the sign-in has ended */
  | "staff_signed_out"
  /** Staff: signed in, but this role may not do this */
  | "forbidden"
  /** Staff: wrong phone or PIN, or locked after too many tries */
  | "sign_in_failed"
  | "invalid_phone"
  | "rate_limited"
  | "sms_failed"
  | "expired"
  | "locked"
  | "wrong"
  | "payment_required"
  /** Floor: the table, booking or party changed since the screen loaded; reload and retry */
  | "conflict"
  /** Place order: a price changed since the guest last reviewed their cart; nothing was ordered */
  | "price_changed";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
