import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { uuidv7 } from "@/db/id";
import { customerFor, customerHistory, customerReorderLines, hashCustomerToken, logoutCustomer, sendCustomerOtp, verifyCustomerOtp } from "@/server/guest/customer-account";
import { customerDeliveryView } from "@/server/delivery/checkout";
import { signInStaff, signOutStaff } from "@/server/staff/auth";
import { currentStaff } from "@/server/staff/request";
import { currentRider, RIDER_COOKIE } from "@/server/staff/rider-request";
import { resetTestDb } from "./setup-db";
const {jar}=vi.hoisted(()=>({jar:new Map<string,string>()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:(key:string)=>jar.has(key)?{value:jar.get(key)}:undefined})}));
let env:Awaited<ReturnType<typeof resetTestDb>>;
let token='';let otherToken='';const now=new Date();
beforeAll(async()=>{env=await resetTestDb();vi.stubEnv('SMS_PROVIDER','mock');});
afterAll(async()=>{vi.unstubAllEnvs();await env.conn.end();await db.$client.end();});
describe('customer accounts',()=>{
 it('requires a device-bound OTP and prevents resends, cross-outlet verification and replay',async()=>{
  const challenge=await sendCustomerOtp('SRJ01','9876543111','customer-one',now);
  await expect(sendCustomerOtp('SRJ01','9876543111','customer-one',now)).rejects.toThrow('Wait');
  await expect(verifyCustomerOtp('SRJ01','wrong-device',challenge.challengeId,challenge.devCode!,'Customer',now)).rejects.toThrow();
  const wrong=challenge.devCode==='9999'?'8888':'9999';
  await expect(verifyCustomerOtp('SRJ01','customer-one',challenge.challengeId,wrong,'Customer',now)).rejects.toThrow('not correct');
  token=await verifyCustomerOtp('SRJ01','customer-one',challenge.challengeId,challenge.devCode!,'Customer',now);
  expect((await customerFor('SRJ01',token))?.phone).toBe('+919876543111');
  await expect(verifyCustomerOtp('SRJ01','customer-one',challenge.challengeId,challenge.devCode!,'Customer',now)).rejects.toThrow();
  const otherOutlet=(await env.db.select().from(s.outlets).where(eq(s.outlets.tenantId,env.other.tenantId)))[0];
  expect(await customerFor(otherOutlet.code,token)).toBeNull();
 });
 it('locks out repeated guesses, expires codes, and does not sign in after an SMS failure',async()=>{
  const ch=await sendCustomerOtp('SRJ01','9876543112','customer-locked',now);const wrong=ch.devCode==='9999'?'8888':'9999';
  for(let i=0;i<3;i++)await expect(verifyCustomerOtp('SRJ01','customer-locked',ch.challengeId,wrong,'Guest',now)).rejects.toThrow();
  await expect(verifyCustomerOtp('SRJ01','customer-locked',ch.challengeId,ch.devCode!,'Guest',now)).rejects.toThrow('expired');
  const expired=await sendCustomerOtp('SRJ01','9876543113','customer-expired',now);
  await expect(verifyCustomerOtp('SRJ01','customer-expired',expired.challengeId,expired.devCode!,'Guest',new Date(now.getTime()+600000))).rejects.toThrow('expired');
  vi.stubEnv('SMS_PROVIDER','none');await expect(sendCustomerOtp('SRJ01','9876543114','sms-failure',now)).rejects.toThrow('send');vi.stubEnv('SMS_PROVIDER','mock');
 });
 it('only shows a verified customer their own orders, tracking and reorder items',async()=>{
  const ch=await sendCustomerOtp('SRJ01','9876543115','customer-two',now);otherToken=await verifyCustomerOtp('SRJ01','customer-two',ch.challengeId,ch.devCode!,'Another',now);
  const who=(await customerFor('SRJ01',token))!;const id=uuidv7();
  await env.db.insert(s.deliveryCheckouts).values({id,tenantId:who.tenantId,outletId:who.outletId,guestId:who.id,tokenHash:hashCustomerToken('order-token'),deviceId:'order-device',lines:[{itemId:uuidv7(),qty:2,modifierIds:[]}],address:{line:'Street',locality:'City',pincode:'302001',instructions:''},status:'placed',paymentStatus:'paid',totalPaise:35000,expiresAt:new Date(now.getTime()+86400000)});
  expect((await customerHistory('SRJ01',token)).deliveries.map(x=>x.id)).toContain(id);
  expect((await customerHistory('SRJ01',otherToken)).deliveries).toEqual([]);
  expect((await customerReorderLines('SRJ01',token,id))[0].qty).toBe(2);
  expect(await customerReorderLines('SRJ01',otherToken,id)).toEqual([]);
  expect((await customerDeliveryView('SRJ01',token,id)).id).toBe(id);
  await expect(customerDeliveryView('SRJ01',otherToken,id)).rejects.toThrow('not found');
  await logoutCustomer('SRJ01',token);expect(await customerFor('SRJ01',token)).toBeNull();
 });
});
describe('separate rider and owner sessions',()=>{
 it('requires the rider role and uses a distinct cookie without replacing the owner session',async()=>{
  const owner=await signInStaff({outletCode:'SRJ01',phone:'9000000001',pin:'1111'});
  await expect(signInStaff({outletCode:'SRJ01',phone:'9000000001',pin:'1111',asRole:'rider'})).rejects.toThrow('role');
  const [host]=await env.db.select().from(s.users).where(eq(s.users.phone,'9000000004'));
  await env.db.insert(s.staffRoles).values({tenantId:env.demo.tenantId,userId:host.id,outletId:env.demo.outletId,role:'rider'});
  const rider=await signInStaff({outletCode:'SRJ01',phone:'9000000004',pin:'4444',asRole:'rider'});
  jar.set('tq_staff',owner.token);expect(await currentRider()).toBeNull();
  jar.set(RIDER_COOKIE,rider.token);expect((await currentRider())?.roles).toContain('rider');expect((await currentStaff())?.roles).toContain('owner');
  await signOutStaff(rider.token);expect(await currentRider()).toBeNull();expect((await currentStaff())?.roles).toContain('owner');
 });
});
