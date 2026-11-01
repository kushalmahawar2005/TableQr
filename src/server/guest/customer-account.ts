import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, gte, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { OTP, normaliseCode } from "@/domain/otp";
import { normaliseIndianMobile, isValidIndianMobile, toE164 } from "@/domain/phone";
import { checkFirstName } from "@/domain/guest-name";
import { smsSender, smsMockEnabled } from "../sms/sender";
import { AppError } from "../errors";
import { limitSmsByClient } from "../request-limit";
import { tenantAccess } from "../access";
import { LOCK_THEN_READ } from "../db-types";
export const customerCookie = (code:string) => `tq_customer_${code.trim().toUpperCase().replace(/[^A-Z0-9]/g,"")}`;
export const hashCustomerToken = (token:string) => createHash("sha256").update(token).digest("hex");
/** One verified phone stays signed in this long, so a returning customer costs no new code */
const SESSION_DAYS=180;
export const customerCookieOptions={httpOnly:true,sameSite:"lax" as const,secure:process.env.NODE_ENV==="production",path:"/",maxAge:SESSION_DAYS*86400};
const sessionEnd=(now:Date)=>new Date(now.getTime()+SESSION_DAYS*86400000);
/** Any code this customer just verified also signs them in; the caller sets the cookie */
export async function startCustomerSession(tenantId:string,guestId:string,now=new Date()) {
 const token=randomBytes(32).toString("base64url");
 await db.insert(s.customerSessions).values({tenantId,guestId,tokenHash:hashCustomerToken(token),expiresAt:sessionEnd(now),createdAt:now});
 return token;
}
/** Each visit restarts the sign-in period */
export async function renewCustomerSession(code:string,token:string|undefined,now=new Date()) {
 const who=await customerFor(code,token,now);if(!who||!token)return false;
 await db.update(s.customerSessions).set({expiresAt:sessionEnd(now)}).where(and(eq(s.customerSessions.tenantId,who.tenantId),eq(s.customerSessions.tokenHash,hashCustomerToken(token))));
 return true;
}
const digest = (id:string,code:string) => {
 const secret=process.env.OTP_SECRET || (process.env.NODE_ENV!=="production"?"tableqr-local-otp-secret":"");
 if(!secret) throw new AppError("sms_failed","Phone verification is temporarily unavailable.");
 return createHmac("sha256",secret).update(`customer:${id}:${code}`).digest("hex");
};
export async function customerOutlet(code:string) {
 const [row]=await db.select({id:s.outlets.id,tenantId:s.outlets.tenantId,code:s.outlets.code,name:s.brands.name,logoUrl:s.brands.logoUrl}).from(s.outlets).innerJoin(s.brands,and(eq(s.brands.id,s.outlets.brandId),eq(s.brands.tenantId,s.outlets.tenantId))).where(eq(s.outlets.code,String(code).trim().toUpperCase()));
 if(!row)throw new AppError("not_found","Business not found.");
 if((await tenantAccess(row.tenantId)).state==="blocked")throw new AppError("outlet_unavailable","This business is unavailable.");
 return row;
}
export async function sendCustomerOtp(code:string,phoneInput:string,device:string,now=new Date()) {
 await limitSmsByClient();
 const outlet=await customerOutlet(code), digits=normaliseIndianMobile(phoneInput);
 if(!isValidIndianMobile(digits))throw new AppError("invalid_phone","Enter a valid Indian mobile number.");
 if(!device || device.length>128)throw new AppError("invalid_state","Reopen the app and try again.");
 const phone=toE164("+91",digits), id=uuidv7(), otp=String(randomInt(0,10**OTP.length)).padStart(OTP.length,"0"), deviceHash=hashCustomerToken(device), codeHash=digest(id,otp);
 await db.transaction(async tx=>{
  await tx.select({id:s.tenants.id}).from(s.tenants).where(eq(s.tenants.id,outlet.tenantId)).for("update");
  const identity=or(eq(s.customerChallenges.phone,phone),eq(s.customerChallenges.deviceHash,deviceHash));
  const [recent]=await tx.select({id:s.customerChallenges.id}).from(s.customerChallenges).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),identity,gt(s.customerChallenges.createdAt,new Date(now.getTime()-OTP.resendSeconds*1000)))).limit(1);
  if(recent)throw new AppError("rate_limited","Wait a minute before requesting another code.");
  const [[p],[d]]=await Promise.all([
   tx.select({n:count()}).from(s.customerChallenges).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.phone,phone),gte(s.customerChallenges.createdAt,new Date(now.getTime()-86400000)))),
   tx.select({n:count()}).from(s.customerChallenges).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.deviceHash,deviceHash),gte(s.customerChallenges.createdAt,new Date(now.getTime()-600000)))),
  ]);
  if(Number(p.n)>=OTP.perPhonePerDay || Number(d.n)>=OTP.perDevicePer10Min)throw new AppError("rate_limited","Too many codes requested. Try again later.");
  await tx.update(s.customerChallenges).set({usedAt:now}).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.outletId,outlet.id),identity));
  await tx.insert(s.customerChallenges).values({id,tenantId:outlet.tenantId,outletId:outlet.id,phone,deviceHash,codeHash,expiresAt:new Date(now.getTime()+OTP.validSeconds*1000),createdAt:now});
 },LOCK_THEN_READ);
 const sender=smsSender();const sent=await sender.sendOtp({phone,code:otp,outletName:outlet.name}).catch(()=>({ok:false}));
 if(!sent.ok){await db.update(s.customerChallenges).set({usedAt:now}).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.id,id)));throw new AppError("sms_failed","Could not send your code. Try again shortly.");}
 return {challengeId:id,phone,resendIn:OTP.resendSeconds,devCode:sender.name==="mock"&&(process.env.NODE_ENV!=="production"||smsMockEnabled())?otp:undefined};
}
export async function verifyCustomerOtp(code:string,device:string,challengeId:string,codeInput:string,nameInput:string,now=new Date()) {
 const outlet=await customerOutlet(code), name=checkFirstName(nameInput);
 if(!name.ok)throw new AppError("invalid_name","Enter your name using letters, up to 40 characters.");
 const token=randomBytes(32).toString("base64url");
 const result=await db.transaction(async tx=>{
  const [challenge]=await tx.select().from(s.customerChallenges).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.outletId,outlet.id),eq(s.customerChallenges.id,challengeId),eq(s.customerChallenges.deviceHash,hashCustomerToken(device)))).for("update");
  if(!challenge || challenge.usedAt || challenge.expiresAt<=now || challenge.attempts>=OTP.maxAttempts)return {error:"This code expired. Request another code."};
  const given=Buffer.from(digest(challenge.id,normaliseCode(codeInput)),"hex"),expected=Buffer.from(challenge.codeHash,"hex");
  if(!timingSafeEqual(given,expected)){await tx.update(s.customerChallenges).set({attempts:challenge.attempts+1}).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.id,challenge.id)));return {error:"That code is not correct."};}
  await tx.insert(s.guests).values({tenantId:outlet.tenantId,phone:challenge.phone,name:name.name,lastSeenAt:now}).onDuplicateKeyUpdate({set:{name:name.name,lastSeenAt:now}});
  const [guest]=await tx.select({id:s.guests.id}).from(s.guests).where(and(eq(s.guests.tenantId,outlet.tenantId),eq(s.guests.phone,challenge.phone)));
  await tx.update(s.customerChallenges).set({usedAt:now}).where(and(eq(s.customerChallenges.tenantId,outlet.tenantId),eq(s.customerChallenges.id,challenge.id)));
  await tx.insert(s.customerSessions).values({tenantId:outlet.tenantId,guestId:guest.id,tokenHash:hashCustomerToken(token),expiresAt:sessionEnd(now),createdAt:now});return {error:null};
 },LOCK_THEN_READ);
 if(result.error)throw new AppError("verification_required",result.error);
 return token;
}
export async function customerFor(code:string,token:string|undefined,now=new Date()) {
 const outlet=await customerOutlet(code); if(!token)return null;
 const [guest]=await db.select({id:s.guests.id,name:s.guests.name,phone:s.guests.phone}).from(s.customerSessions).innerJoin(s.guests,and(eq(s.guests.tenantId,s.customerSessions.tenantId),eq(s.guests.id,s.customerSessions.guestId))).where(and(eq(s.customerSessions.tenantId,outlet.tenantId),eq(s.customerSessions.tokenHash,hashCustomerToken(token)),gt(s.customerSessions.expiresAt,now)));
 return guest?{...guest,tenantId:outlet.tenantId,outletId:outlet.id}:null;
}
/** For a table: who this phone is signed in as, if anyone */
export async function customerAtTable(code:string,token:string|undefined) {
 const who=await customerFor(code,token).catch(()=>null);
 return who?{guestId:who.id,name:who.name??"Guest"}:null;
}
export async function customerHistory(code:string,token:string|undefined) {
 const who=await customerFor(code,token);if(!who)throw new AppError("verification_required","Sign in to view your orders.");
 const [deliveries,bookings,profiles,parties]=await Promise.all([
  db.select({id:s.deliveryCheckouts.id,sessionId:s.deliveryCheckouts.sessionId,serviceMode:s.deliveryCheckouts.serviceMode,status:s.deliveryCheckouts.status,totalPaise:s.deliveryCheckouts.totalPaise,at:s.deliveryCheckouts.createdAt,paymentMode:s.deliveryCheckouts.paymentMode,paymentStatus:s.deliveryCheckouts.paymentStatus,lines:s.deliveryCheckouts.lines,address:s.deliveryCheckouts.address}).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId,who.tenantId),eq(s.deliveryCheckouts.outletId,who.outletId),eq(s.deliveryCheckouts.guestId,who.id),or(ne(s.deliveryCheckouts.status,"draft"),ne(s.deliveryCheckouts.paymentStatus,"none")))).orderBy(desc(s.deliveryCheckouts.createdAt)).limit(50),
  db.select({id:s.reservations.id,status:s.reservations.status,startAt:s.reservations.startAt,partySize:s.reservations.partySize,reference:s.reservations.publicReference}).from(s.reservations).where(and(eq(s.reservations.tenantId,who.tenantId),eq(s.reservations.outletId,who.outletId),eq(s.reservations.guestId,who.id))).orderBy(desc(s.reservations.startAt)).limit(50),
  db.select({addresses:s.customerProfiles.addresses}).from(s.customerProfiles).where(and(eq(s.customerProfiles.tenantId,who.tenantId),eq(s.customerProfiles.guestId,who.id))),
  db.select({id:s.groupRequests.id,status:s.groupRequests.status,startAt:s.groupRequests.desiredStartAt,partySize:s.groupRequests.partySize,reference:s.groupRequests.publicReference}).from(s.groupRequests).where(and(eq(s.groupRequests.tenantId,who.tenantId),eq(s.groupRequests.outletId,who.outletId),eq(s.groupRequests.guestId,who.id))).orderBy(desc(s.groupRequests.createdAt)).limit(50),
 ]);
 const sessions=deliveries.flatMap(d=>d.sessionId?[d.sessionId]:[]);
 const items=sessions.length?await db.select({sessionId:s.orderLines.sessionId,name:s.orderLines.nameEn,qty:s.orderLines.qty,imageUrl:s.menuItems.imageUrl,status:s.orderLines.status}).from(s.orderLines).leftJoin(s.menuItems,and(eq(s.menuItems.tenantId,s.orderLines.tenantId),eq(s.menuItems.id,s.orderLines.itemId))).where(and(eq(s.orderLines.tenantId,who.tenantId),inArray(s.orderLines.sessionId,sessions))):[];
 return {guest:{name:who.name,phone:who.phone},deliveries:deliveries.map(d=>({...d,at:d.at.toISOString(),items:items.filter(i=>i.sessionId===d.sessionId&&i.status!=="voided"&&i.status!=="cancelled").map(({name,qty,imageUrl})=>({name,qty,imageUrl}))})),bookings:[...bookings.map(b=>({...b,kind:"reservation" as const,startAt:b.startAt.toISOString()})),...parties.map(b=>({...b,kind:"party" as const,startAt:b.startAt.toISOString()}))].sort((a,b)=>b.startAt.localeCompare(a.startAt)),addresses:profiles[0]?.addresses??[]};
}
export async function logoutCustomer(code:string,token:string|undefined) {
 const who=await customerFor(code,token);if(!who||!token)return;
 await db.delete(s.customerSessions).where(and(eq(s.customerSessions.tenantId,who.tenantId),eq(s.customerSessions.tokenHash,hashCustomerToken(token))));
}

/** Only a verified customer session may attach identity to their device-bound draft. */
export async function identifyCustomerCheckout(code:string,token:string|undefined,checkoutToken:string,deviceId:string) {
 const who=await customerFor(code,token);if(!who)return false;
 const {deliveryCheckout}=await import("../delivery/checkout");
 const {row}=await deliveryCheckout(code,checkoutToken,deviceId);
 if(row.status!=="draft")throw new AppError("invalid_state","This order was already placed.");
 await db.update(s.deliveryCheckouts).set({guestId:who.id,verifiedAt:new Date(),name:who.name,phone:who.phone}).where(and(eq(s.deliveryCheckouts.tenantId,who.tenantId),eq(s.deliveryCheckouts.outletId,who.outletId),eq(s.deliveryCheckouts.id,row.id),eq(s.deliveryCheckouts.status,"draft")));
 return true;
}
export async function customerReorderLines(code:string,token:string|undefined,id:string) {
 const who=await customerFor(code,token);if(!who)return [];
 const [row]=await db.select({lines:s.deliveryCheckouts.lines}).from(s.deliveryCheckouts).where(and(eq(s.deliveryCheckouts.tenantId,who.tenantId),eq(s.deliveryCheckouts.outletId,who.outletId),eq(s.deliveryCheckouts.guestId,who.id),eq(s.deliveryCheckouts.id,id)));
 return row?.lines??[];
}
export async function identifyCustomerBooking(code:string,token:string|undefined,manageToken:string) {
 const who=await customerFor(code,token);if(!who)return;
 const {bookingByToken}=await import("../booking/core");const {row}=await bookingByToken(code,manageToken);
 await db.update(s.reservations).set({guestId:who.id,name:who.name??"Guest",phone:who.phone}).where(and(eq(s.reservations.tenantId,who.tenantId),eq(s.reservations.outletId,who.outletId),eq(s.reservations.id,row.id),eq(s.reservations.status,"requested")));
}
