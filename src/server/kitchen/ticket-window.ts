/**
 * The kitchen board shows tickets that are still open and were sent within this window. A ticket
 * nobody bumped (a restaurant that does not use the screen, or a table paid at the counter)
 * stays "open" in the database for good; without a limit the board would read them all.
 */
export const OPEN_TICKET_WINDOW_MS = 24 * 3_600_000;
