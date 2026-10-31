import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { customerCookie, customerFor } from "@/server/guest/customer-account";
import { getRestaurantHome } from "@/server/guest/restaurant-home";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { GuestShell } from "./guest-shell";
export default async function OutletLayout({children,params}:{children:ReactNode;params:Promise<{outlet:string}>}){
 const {outlet}=await params;
 const jar=await cookies();
 const customer=await customerFor(outlet,jar.get(customerCookie(outlet))?.value).catch(()=>null);
 const brand=await getRestaurantHome(outlet).catch(()=>null);
 return <GuestShell outlet={outlet} signedIn={!!customer} brand={brand} initialLanguage={parseLang(jar.get(LANG_COOKIE)?.value)}>{children}</GuestShell>;
}
