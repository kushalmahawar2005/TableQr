import { customerOutlet, customerCookie, customerHistory } from "@/server/guest/customer-account";
import { cookies } from "next/headers";
import { restaurantApp, restaurantAppMetadata } from "@/server/guest/restaurant-app";
import { CustomerProfile } from "./screen";
export async function generateMetadata({params}:{params:Promise<{outlet:string}>}){const {outlet}=await params;const app=await restaurantApp(outlet);return {title:app?`${app.name} | My profile`:"My profile",...restaurantAppMetadata(app)};}
export default async function ProfilePage({params}:{params:Promise<{outlet:string}>}){const {outlet}=await params;const brand=await customerOutlet(outlet);const jar=await cookies();const initial=await customerHistory(outlet,jar.get(customerCookie(outlet))?.value).catch(()=>null);return <CustomerProfile outlet={brand.code} brandName={brand.name} initial={initial}/>;}
