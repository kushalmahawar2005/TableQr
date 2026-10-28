import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { currentStaff } from "@/server/staff/request";
import { tenantFeatures } from "@/server/plan";
import { canSee } from "@/lib/staff-permissions";
import { publicMetaConfig } from "@/server/whatsapp/meta";
import { whatsappOverview } from "@/server/whatsapp/accounts";
import { broadcastWorkspace } from "@/server/whatsapp/campaigns";
import { FeatureLocked } from "../_components/feature-locked";
import { WhatsAppConnection } from "./whatsapp-connection";
import { CampaignComposer } from "./campaign-composer";
import { messageCreditPrice, messageCreditPurchaseHistory } from "@/server/whatsapp/credits";

export const metadata = { title: "WhatsApp broadcasts", robots: { index: false, follow: false } };

export default async function BroadcastsPage() {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "broadcasts")) notFound();
  if (!(await tenantFeatures(staff.tenantId)).broadcast) return <FeatureLocked feature="broadcast" />;
  const [connection, workspace, creditPricing, creditPurchases] = await Promise.all([whatsappOverview(staff.tenantId), broadcastWorkspace(staff), messageCreditPrice(), messageCreditPurchaseHistory(staff.tenantId)]);
  return <div className="space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold">WhatsApp broadcasts</h1><p className="text-sm text-muted-foreground">Send offers to opted-in customers from your restaurant&apos;s WhatsApp Business number.</p></div>
    <WhatsAppConnection config={publicMetaConfig()} nonce={(await headers()).get("x-nonce") ?? ""} data={connection} />
    <CampaignComposer workspace={workspace} templates={connection.templates} connected={connection.account?.status === "connected"} defaultOutletId={staff.outletId} owner={staff.roles.includes("owner")} creditPricing={creditPricing} creditPurchases={creditPurchases} />
  </div>;
}
