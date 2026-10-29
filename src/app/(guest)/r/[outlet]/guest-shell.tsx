"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Package, UserRound } from "lucide-react";
import { useGuestBase } from "@/lib/guest-base";
const GuestAuthContext=createContext<(signedIn:boolean)=>void>(()=>{});
export const useGuestAuthStatus=()=>useContext(GuestAuthContext);
export function GuestShell({outlet,children,signedIn=false}:{outlet:string;children:ReactNode;signedIn?:boolean}) {
 const [authenticated,setAuthenticated]=useState(signedIn);
 const base=useGuestBase(outlet),path=usePathname();
 const section=(path??'').replace(/^\/r\/[^/]+(?:\/app(?=\/|$))?/, '');
 const show=section===''||section==='/'||/^\/(delivery|book|profile|orders|waitlist)(\/|$)/.test(section);
 if(!show)return children;
 const hideNav=section.startsWith("/profile")&&!authenticated;
 return <GuestAuthContext.Provider value={setAuthenticated}><div className={hideNav?"":"pb-24"}>{children}{!hideNav&&<nav aria-label="Guest app navigation" className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[480px] border-t border-line bg-surface px-3 pb-[env(safe-area-inset-bottom)] shadow-lg">{[{href:base,label:'Home',icon:Home,active:section===''||section==='/'},{href:`${base}/orders`,label:'Orders & bookings',icon:Package,active:section.startsWith('/orders')},{href:`${base}/profile`,label:'Profile',icon:UserRound,active:section.startsWith('/profile')}].map(({href,label,icon:Icon,active})=><Link key={label} href={href} aria-current={active?'page':undefined} className={`flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold ${active?'text-ink':'text-muted'}`}><Icon className="size-5"/>{label}</Link>)}</nav>}</div></GuestAuthContext.Provider>;
}
