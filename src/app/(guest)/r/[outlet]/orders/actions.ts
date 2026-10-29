"use server";
import { cookies } from "next/headers";
import { customerCookie } from "@/server/guest/customer-account";
import { customerDeliveryView } from "@/server/delivery/checkout";
import { AppError } from "@/server/errors";
export async function trackCustomerOrderAction(outlet:string,id:string){try{return {ok:true as const,data:await customerDeliveryView(outlet,(await cookies()).get(customerCookie(outlet))?.value,id)}}catch(e){return {ok:false as const,error:e instanceof AppError?e.message:"Could not refresh your order."}}}
