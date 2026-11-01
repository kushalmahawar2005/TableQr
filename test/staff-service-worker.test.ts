import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const code=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(origin:string, control='no-cache') {
 const listeners:Record<string,(event:unknown)=>void>={};
 const put=vi.fn();const match=vi.fn().mockResolvedValue(undefined);
 const showNotification=vi.fn().mockResolvedValue(undefined);
 const fetch=vi.fn().mockResolvedValue(new Response('chunk',{headers:{'cache-control':control}}));
 vm.runInNewContext(code,{URL,Response,fetch,setTimeout:(run:()=>void)=>run(),caches:{open:async()=>({match,put})},self:{location:{origin},registration:{showNotification},addEventListener:(key:string,fn:(event:unknown)=>void)=>{listeners[key]=fn}}});
 return {listeners,put,match,fetch,showNotification};
}
describe('staff worker app chunk caching',()=>{
 it('always lets localhost development chunks go to the network',()=>{
  const w=worker('http://localhost:3000');const respondWith=vi.fn();
  w.listeners.fetch({request:{method:'GET',url:'http://localhost:3000/_next/static/chunks/page.js'},respondWith});
  expect(respondWith).not.toHaveBeenCalled();expect(w.match).not.toHaveBeenCalled();
 });
 it('never stores non-immutable chunks under reusable URLs',async()=>{
  const w=worker('https://app.example.com');let response:Promise<Response>|undefined;
  w.listeners.fetch({request:{method:'GET',url:'https://app.example.com/_next/static/chunks/page.js'},respondWith:(p:Promise<Response>)=>{response=p}});
  expect(await (await response!).text()).toBe('chunk');expect(w.put).not.toHaveBeenCalled();
 });
 it('preserves offline caching for immutable production chunks',async()=>{
  const w=worker('https://app.example.com','public,max-age=31536000,immutable');let response:Promise<Response>|undefined;
  w.listeners.fetch({request:{method:'GET',url:'https://app.example.com/_next/static/chunks/hash.js'},respondWith:(p:Promise<Response>)=>{response=p}});
  await response;expect(w.put).toHaveBeenCalledOnce();
 });
 it('does not show a staff alert after its session is no longer active',async()=>{
  const w=worker('https://app.example.com');
  w.fetch.mockResolvedValueOnce(Response.json({active:false}));
  let pending:Promise<unknown>|undefined;
  w.listeners.push({data:{json:()=>({title:'New party request',body:'A party requested a booking.',url:'/console/reservations',sessionId:'session-a'})},waitUntil:(work:Promise<unknown>)=>{pending=work}});
  await pending;
  expect(w.fetch).toHaveBeenCalledWith('https://app.example.com/api/staff/push-session?sessionId=session-a',expect.objectContaining({credentials:'include',cache:'no-store'}));
  expect(w.showNotification).not.toHaveBeenCalled();
 });
 it('shows a staff alert only for its active session and permits guest reminders',async()=>{
  const w=worker('https://app.example.com');
  w.fetch.mockResolvedValueOnce(Response.json({active:true}));
  let pending:Promise<unknown>|undefined;
  w.listeners.push({data:{json:()=>({title:'New order',body:'A staff member sent an order.',url:'/console/orders',sessionId:'session-a'})},waitUntil:(work:Promise<unknown>)=>{pending=work}});
  await pending;
  expect(w.showNotification).toHaveBeenCalledWith('New order',expect.objectContaining({data:{url:'/console/orders',sessionId:'session-a'}}));

  pending=undefined;
  w.listeners.push({data:{json:()=>({title:'Booking reminder',url:'/r/SRJ01'})},waitUntil:(work:Promise<unknown>)=>{pending=work}});
  await pending;
  expect(w.showNotification).toHaveBeenCalledTimes(2);
 });
 it('retries the session check and then shows a detail-free alert instead of losing it',async()=>{
  const w=worker('https://app.example.com');
  w.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('',{status:503})).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  let pending:Promise<unknown>|undefined;
  w.listeners.push({data:{json:()=>({title:'New order',body:'Table 4: 2 x Paneer',icon:'/staff-icon/192?outlet=SRJ01',url:'/console/orders',sessionId:'session-a'})},waitUntil:(work:Promise<unknown>)=>{pending=work}});
  await pending;
  expect(w.fetch).toHaveBeenCalledTimes(3);
  expect(w.showNotification).toHaveBeenCalledWith('Tableeqr update',expect.objectContaining({body:'There is a new update for your restaurant.',icon:'/staff-icon/192',data:{url:'/console/orders',sessionId:'session-a'}}));
 });
 it('shows the full alert when a retry reaches the server',async()=>{
  const w=worker('https://app.example.com');
  w.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(Response.json({active:true}));
  let pending:Promise<unknown>|undefined;
  w.listeners.push({data:{json:()=>({title:'New order',body:'Table 4',url:'/console/orders',sessionId:'session-a'})},waitUntil:(work:Promise<unknown>)=>{pending=work}});
  await pending;
  expect(w.showNotification).toHaveBeenCalledWith('New order',expect.objectContaining({body:'Table 4'}));
 });
 it('suppresses queued staff alerts from before session binding',async()=>{
  const w=worker('https://app.example.com');
  let pending:Promise<unknown>|undefined;
  w.listeners.push({data:{json:()=>({title:'Old staff alert',url:'/waiter'})},waitUntil:(work:Promise<unknown>)=>{pending=work}});
  await pending;
  expect(w.fetch).not.toHaveBeenCalled();
  expect(w.showNotification).not.toHaveBeenCalled();
 });
 it('does not open an old staff notification after the browser session changes',async()=>{
  const w=worker('https://app.example.com');
  w.fetch.mockResolvedValueOnce(Response.json({active:false}));
  const close=vi.fn();const focus=vi.fn();const navigate=vi.fn();const openWindow=vi.fn();
  const client={url:'https://app.example.com/console',focus,navigate};
  const event={notification:{data:{url:'/console/orders',sessionId:'session-a'},close},waitUntil:vi.fn()};
  // Re-evaluate with the client API available for the click handler.
  const listeners:Record<string,(event:unknown)=>void>={};
  vm.runInNewContext(code,{URL,Response,fetch:w.fetch,caches:{open:async()=>({match:w.match,put:w.put})},self:{location:{origin:'https://app.example.com'},registration:{showNotification:w.showNotification},clients:{matchAll:async()=>[client],openWindow},addEventListener:(key:string,fn:(event:unknown)=>void)=>{listeners[key]=fn}}});
  listeners.notificationclick?.(event);
  await (event.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(close).toHaveBeenCalledOnce();
  expect(w.fetch).toHaveBeenCalledWith('https://app.example.com/api/staff/push-session?sessionId=session-a',expect.objectContaining({credentials:'include',cache:'no-store'}));
  expect(navigate).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled();expect(openWindow).not.toHaveBeenCalled();
 });
});
