import "server-only";
import { ownerPlan } from "@/server/fees";
import type { StaffSession } from "@/server/staff/auth";
import type { PlanView } from "./plan-panel";

/** The owner's plan, shaped for the My plan screen */
export async function planViewFor(staff: Pick<StaffSession, "tenantId" | "outlet">): Promise<PlanView> {
  const p = await ownerPlan(staff);
  return {
    commercial: p.commercial,
    businessType: p.businessType,
    planName: p.planName,
    planCode: p.planCode,
    plans: p.plans,
    outlet: staff.outlet.name,
    fee: p.fee,
    access: { state: p.access.state, reason: p.access.reason, endsAt: p.access.endsAt },
    features: p.features,
    waiting: p.waiting,
    payments: p.payments,
    now: Date.now(),
  };
}
