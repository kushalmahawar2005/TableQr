"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, X, Soup } from "lucide-react";
import { useGuestExperience } from "../guest-shell";
import { useGuestBase } from "@/lib/guest-base";

export function GuestHeader({outlet,title,aside}:{outlet:string;title:string;aside?:ReactNode}) {
 const base=useGuestBase(outlet);
 return <header className="guest-page-header"><Link href={base} aria-label="Back to home" className="guest-icon-button"><ArrowLeft size={20}/></Link><h1>{title}</h1>{aside}</header>;
}
export function GuestSheet({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close()},[]);
 return <dialog ref={ref} className="guest-sheet" onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}><div className="guest-sheet-content"><header><h2>{title}</h2><button type="button" className="guest-icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></header>{children}</div></dialog>;
}
export function GuestSplash({name,logoUrl}:{name?:string;logoUrl?:string|null}) {
 const {brand}=useGuestExperience();
 name=brand?.outlet.name ?? name ?? "Welcome"; logoUrl=brand?.outlet.logoUrl ?? logoUrl;
 return <div className="guest-splash" role="status" aria-label={`Opening ${name}`}><div className="guest-splash-art"><Soup size={64} strokeWidth={1.4}/><span>✦</span></div>{logoUrl&&<Image src={logoUrl} alt="" width={56} height={56} unoptimized className="size-14 rounded-full object-cover"/>}<h1>{name}</h1><p>Your favourites. A little closer.</p><span className="guest-loading-dots" aria-hidden><i/><i/><i/></span></div>;
}
