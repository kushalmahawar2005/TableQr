import "server-only";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { DEFAULT_POLICY, type BookingPolicy } from "@/domain/booking-policy";
import type { Runner } from "../db-types";

/** The outlet's booking policy, or the defaults when none has been saved */
export async function loadPolicy(run: Runner, scope: { tenantId: string; outletId: string }): Promise<BookingPolicy> {
  const [row] = await run
    .select()
    .from(s.bookingPolicies)
    .where(and(eq(s.bookingPolicies.tenantId, scope.tenantId), eq(s.bookingPolicies.outletId, scope.outletId)));
  if (!row) return DEFAULT_POLICY;
  return {
    bookingWindowDays: row.bookingWindowDays,
    onlineCutoffMinutes: row.onlineCutoffMinutes,
    minPartySize: row.minPartySize,
    maxPartySize: row.maxPartySize,
    slotIntervalMinutes: row.slotIntervalMinutes,
    holdMinutes: row.holdMinutes,
    diningMinutes: row.diningMinutes?.length ? row.diningMinutes : DEFAULT_POLICY.diningMinutes,
    turnoverBufferMinutes: row.turnoverBufferMinutes,
    graceMinutes: row.graceMinutes,
    reserveAheadMinutes: row.reserveAheadMinutes,
    pacingCoversPerSlot: row.pacingCoversPerSlot,
    freeCancellationMinutes: row.freeCancellationMinutes,
    lateExtensionMinutes: row.lateExtensionMinutes,
    readyWindowMinutes: row.readyWindowMinutes,
    fallbackWaitMinutes: row.fallbackWaitMinutes,
    minimumHistoryParties: row.minimumHistoryParties,
    peakCreditPaise: row.peakCreditPaise,
    repeatNoShowCreditPaise: row.repeatNoShowCreditPaise,
    repeatNoShowThreshold: row.repeatNoShowThreshold,
  };
}
