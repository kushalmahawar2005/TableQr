"use server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { customerCookie, customerFor, customerHistory, logoutCustomer, sendCustomerOtp, verifyCustomerOtp } from "@/server/guest/customer-account";
import { AppError } from "@/server/errors";
import type { DeliveryAddress } from "@/db/schema/delivery";
const options={httpOnly:true,sameSite:"lax" as const,secure:process.env.NODE_ENV==="production",path:"/",maxAge:30*86400};
async function device(){const jar=await cookies();let id=jar.get("tq_customer_device")?.value;if(!id){id=randomBytes(24).toString("base64url");jar.set("tq_customer_device",id,options);}return id;}
async function run<T>(fn:()=>Promise<T>){try{return {ok:true as const,data:await fn()}}catch(e){return {ok:false as const,error:e instanceof AppError?e.message:"Could not complete this request. Try again."}}}
export async function requestCustomerCodeAction(outlet:string,phone:string){return run(()=>device().then(id=>sendCustomerOtp(outlet,phone,id)));}
export async function verifyCustomerCodeAction(outlet:string,challengeId:string,code:string,name:string){return run(async()=>{const token=await verifyCustomerOtp(outlet,await device(),challengeId,code,name);(await cookies()).set(customerCookie(outlet),token,options);return customerHistory(outlet,token);});}
export async function customerAccountAction(outlet:string){return run(()=>cookies().then(jar=>customerHistory(outlet,jar.get(customerCookie(outlet))?.value)));}
export async function signOutCustomerAction(outlet:string){return run(async()=>{const jar=await cookies();await logoutCustomer(outlet,jar.get(customerCookie(outlet))?.value);jar.delete(customerCookie(outlet));return true;});}
export async function saveCustomerAddressAction(outlet:string,address:DeliveryAddress,label:string){return run(async()=>{
 const who=await customerFor(outlet,(await cookies()).get(customerCookie(outlet))?.value);if(!who)throw new AppError("verification_required","Sign in first.");
 const clean={id:randomBytes(12).toString("hex"),label:String(label).trim().slice(0,30)||"Home",line:String(address.line??"").trim().slice(0,240),locality:String(address.locality??"").trim().slice(0,100),pincode:String(address.pincode??"").trim(),instructions:String(address.instructions??"").trim().slice(0,200)};
 if(!clean.line || !clean.locality || !/^\d{6}$/.test(clean.pincode))throw new AppError("invalid_state","Enter a street address, locality and six-digit pincode.");
 await db.transaction(async tx=>{await tx.select({id:s.guests.id}).from(s.guests).where(and(eq(s.guests.tenantId,who.tenantId),eq(s.guests.id,who.id))).for("update");const [old]=await tx.select().from(s.customerProfiles).where(and(eq(s.customerProfiles.tenantId,who.tenantId),eq(s.customerProfiles.guestId,who.id)));const addresses=[clean,...(old?.addresses??[])].slice(0,5);await tx.insert(s.customerProfiles).values({tenantId:who.tenantId,guestId:who.id,addresses}).onDuplicateKeyUpdate({set:{addresses}});});return true;
});}
export async function removeCustomerAddressAction(outlet:string,id:string){return run(async()=>{const who=await customerFor(outlet,(await cookies()).get(customerCookie(outlet))?.value);if(!who)throw new AppError("verification_required","Sign in first.");await db.transaction(async tx=>{const [row]=await tx.select().from(s.customerProfiles).where(and(eq(s.customerProfiles.tenantId,who.tenantId),eq(s.customerProfiles.guestId,who.id))).for("update");if(row)await tx.update(s.customerProfiles).set({addresses:row.addresses.filter(a=>a.id!==id)}).where(and(eq(s.customerProfiles.tenantId,who.tenantId),eq(s.customerProfiles.guestId,who.id)));});return true;});}
