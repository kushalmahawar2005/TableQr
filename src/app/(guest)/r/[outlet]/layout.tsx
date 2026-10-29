import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { customerCookie, customerFor } from "@/server/guest/customer-account";
import { GuestShell } from "./guest-shell";
export default async function OutletLayout({children,params}:{children:ReactNode;params:Promise<{outlet:string}>}){
 const {outlet}=await params;
 const jar=await cookies();
 const customer=await customerFor(outlet,jar.get(customerCookie(outlet))?.value).catch(()=>null);
 return <GuestShell outlet={outlet} signedIn={!!customer}>{children}</GuestShell>;
}
