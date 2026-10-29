import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const code=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(origin:string, control='no-cache') {
 const listeners:Record<string,(event:unknown)=>void>={};
 const put=vi.fn();const match=vi.fn().mockResolvedValue(undefined);
 const fetch=vi.fn().mockResolvedValue(new Response('chunk',{headers:{'cache-control':control}}));
 vm.runInNewContext(code,{URL,Response,fetch,caches:{open:async()=>({match,put})},self:{location:{origin},addEventListener:(key:string,fn:(event:unknown)=>void)=>{listeners[key]=fn}}});
 return {listeners,put,match,fetch};
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
});
