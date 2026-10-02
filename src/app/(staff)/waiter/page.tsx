import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentStaff } from "@/server/staff/request";
import { waiterBoard } from "@/server/staff/waiter-read";
import { WaiterScreen } from "./_components/waiter-screen";
export const metadata: Metadata={title:"My floor"};
export default async function WaiterPage(){
 const staff=await currentStaff();if(!staff) redirect("/console/login");
 if(!staff.roles.some(r=>["waiter","manager","owner"].includes(r))) return <main className="p-6">Permission denied. Ask a manager.</main>;
 return <WaiterScreen initial={await waiterBoard(staff)} realtimeUrl={process.env.NEXT_PUBLIC_REALTIME_URL??null}/>;
}
