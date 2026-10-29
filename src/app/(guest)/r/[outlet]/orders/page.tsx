import { cookies } from "next/headers";
import { customerCookie, customerHistory, customerOutlet } from "@/server/guest/customer-account";
import { CustomerOrders } from "./screen";
import { restaurantApp, restaurantAppMetadata } from "@/server/guest/restaurant-app";
export async function generateMetadata({params}:{params:Promise<{outlet:string}>}){const {outlet}=await params;return {title:"My orders & bookings",...restaurantAppMetadata(await restaurantApp(outlet))};}
export default async function OrdersPage({params}:{params:Promise<{outlet:string}>}){const {outlet}=await params;const brand=await customerOutlet(outlet);const initial=await customerHistory(outlet,(await cookies()).get(customerCookie(outlet))?.value).catch(()=>null);return <CustomerOrders outlet={brand.code} brandName={brand.name} initial={initial}/>;}
