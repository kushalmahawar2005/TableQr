import type { Metadata } from "next";
import { StaffInviteForm } from "./form";
import { getStaffInvitation } from "@/server/staff/invitations";

export const metadata: Metadata = {
  title: "Set up staff access",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function StaffInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getStaffInvitation(token);
  return <StaffInviteForm token={token} invitation={invitation} />;
}
