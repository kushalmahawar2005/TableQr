"use client";
import { useSyncExternalStore } from "react";
const eventName="tableeqr:guest-preferences";
const subscribe=(notify:()=>void)=>{window.addEventListener('storage',notify);window.addEventListener(eventName,notify);return()=>{window.removeEventListener('storage',notify);window.removeEventListener(eventName,notify)}};
export function useGuestPreference(key:string,fallback:string){
 const value=useSyncExternalStore(subscribe,()=>{try{return localStorage.getItem(key)??fallback}catch{return fallback}},()=>fallback);
 const set=(next:string)=>{try{localStorage.setItem(key,next)}catch{}window.dispatchEvent(new Event(eventName))};
 return [value,set] as const;
}
const subscribeSystem=(notify:()=>void)=>{const media=window.matchMedia('(prefers-color-scheme: dark)');media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify)};
export function useSystemDark(){return useSyncExternalStore(subscribeSystem,()=>window.matchMedia('(prefers-color-scheme: dark)').matches,()=>false)}
