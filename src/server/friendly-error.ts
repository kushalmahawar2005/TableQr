import { AppError } from "./errors";

/** Looks like a database or driver message: SQL text, error codes, bound parameters */
const TECHNICAL = /failed query|\bER_[A-Z_]+|params:|sqlstate|select .* from|insert into|update `|econnrefused|etimedout|stack|\bat \w+ \(/i;

/**
 * The message a person may see. Our own errors and short plain messages we wrote pass through;
 * anything that looks like a database or system message is replaced by the fallback and left to
 * the server log, so SQL, ids and parameters never reach a screen.
 */
export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && error.message.length <= 160 && !TECHNICAL.test(error.message)) return error.message;
  console.error("[error]", error);
  return fallback;
}
