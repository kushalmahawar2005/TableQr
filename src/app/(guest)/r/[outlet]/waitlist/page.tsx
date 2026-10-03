import type { Metadata } from "next";
import { WaitlistClient } from "./waitlist-client";
export const metadata: Metadata = { title: "Waitlist", robots: { index: false, follow: false } };
export default async function WaitlistPage(props: { params: Promise<{ outlet: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) { const { outlet } = await props.params; const q = await props.searchParams; return <WaitlistClient outlet={outlet} token={typeof q.token === "string" ? q.token : ""} />; }
