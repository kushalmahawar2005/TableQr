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
  | "invalid_name";

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
