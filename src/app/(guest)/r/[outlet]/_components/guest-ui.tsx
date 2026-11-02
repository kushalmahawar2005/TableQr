"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { useGuestExperience } from "../guest-shell";
import { useGuestBase } from "@/lib/guest-base";
import { BowlArt } from "./order-art";

export function GuestHeader({outlet,title,aside}:{outlet:string;title:string;aside?:ReactNode}) {
 const base=useGuestBase(outlet);
 return <header className="guest-page-header"><Link href={base} aria-label="Back to home" className="guest-icon-button"><ArrowLeft size={20}/></Link><h1>{title}</h1>{aside}</header>;
}
export function GuestSheet({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close()},[]);
 return <dialog ref={ref} className="guest-sheet" onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}><div className="guest-sheet-content"><header><h2>{title}</h2><button type="button" className="guest-icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>{children}</div></dialog>;
}
export function GuestSplash({name}:{name?:string}) {
 const {brand}=useGuestExperience();
 name=brand?.outlet.name ?? name ?? "Welcome";
 return <div className="guest-splash" role="status" aria-label={`Opening ${name}`}><span className="guest-splash-bowl"><BowlArt/></span><h1>{name}</h1><p>Your favourites. A little closer.</p><span className="guest-splash-bar" aria-hidden="true"/></div>;
}

/** "EN / हिन्दी": taps straight to the other language */
export function LanguageSwitch() {
 const {language,setLanguage}=useGuestExperience();
 return <button type="button" onClick={()=>setLanguage(language==="hi"?"en":"hi")} aria-label={language==="hi"?"Switch to English":"हिन्दी में देखें"} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm"><b className={language==="en"?"text-ink":"font-normal text-muted"}>EN</b><span className="text-muted">/</span><b className={language==="hi"?"text-ink":"font-normal text-muted"}>हिन्दी</b></button>;
}
