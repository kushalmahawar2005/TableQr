import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentStaff } from "@/server/staff/request";
import { RiderSignInForm } from "./sign-in-form";

export const metadata = { title: "Rider sign in", robots: { index: false, follow: false } };

export default async function RiderLoginPage() {
  const staff = await currentStaff();
  if (staff?.roles.includes("rider")) redirect("/rider");
  const outlet = (await cookies()).get("tq_staff_outlet")?.value ?? "";
  return <RiderSignInForm outlet={outlet} />;
}
