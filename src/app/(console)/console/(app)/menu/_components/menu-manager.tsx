"use client";
import { useMemo, useState } from "react";
import * as actions from "../actions";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { adjustPrice } from "@/domain/price-adjust";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MoreHorizontal, Plus, Search, UtensilsCrossed, X } from "lucide-react";
import type { LibraryItemView } from "@/server/staff/menu-library";
import { DetailSection, Pill, primaryButton, secondaryButton } from "../../orders/_components/orders-ui";
import { LibraryPanel, LibraryQuickPick } from "./library-panel";
type Data = Awaited<ReturnType<typeof import("@/server/staff/menu-manager").menuManagerData>>;
type Item=Data["items"][number];
const PAGE_SIZE=24;
const SAFE="bg-[var(--state-available-soft)] text-[var(--state-available-text)]",WARN="bg-[var(--state-held-soft)] text-[var(--state-held-text)]",BAD="bg-[var(--state-seated-soft)] text-[var(--state-seated-text)]",OFF="bg-[var(--state-paid-soft)] text-[var(--state-paid-text)]";
const rupees=(paise:number)=>`₹${(paise/100).toLocaleString("en-IN",{minimumFractionDigits:paise%100?2:0})}`;
const FIELD="h-10 rounded-input border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-[var(--state-available)]";
/** What staff need to know about a dish right now, in one place for the table and the panel */
function stateOf(item:Item,data:Data){
 const o=data.overrides.find(x=>x.itemId===item.id),left=o?.portionsLeft??null;
 if(!item.isActive)return{key:"archived",label:"Archived",note:"Not on the menu",tone:OFF,on:false};
 if(left===0)return{key:"out",label:"Sold out",note:"0 portions left",tone:BAD,on:false};
 if(o?.isAvailable===false)return{key:"out",label:"Out today",note:"Back tomorrow",tone:BAD,on:false};
 if(left!==null)return{key:"limited",label:"Limited",note:`${left} ${left===1?"portion":"portions"} left`,tone:WARN,on:true};
 return{key:"available",label:"Available",note:"No daily limit",tone:SAFE,on:true};
}
function sizesOf(item:Item,data:Data){
 const o=data.overrides.find(x=>x.itemId===item.id),base=o?.pricePaise??item.pricePaise;
 const group=data.groups.find(g=>g.itemId===item.id&&g.isActive&&/^size$/i.test(g.nameEn.trim()));
 return{base,sizes:group?data.modifiers.filter(m=>m.groupId===group.id).map(m=>({id:m.id,name:m.nameEn,paise:base+m.priceDeltaPaise})):[]};
}
export function MenuManager({initial,canEditPrice}:{initial:Data;canEditPrice:boolean}){
 const [data,setData]=useState(initial),[selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(""),[category,setCategory]=useState("all"),[panel,setPanel]=useState<"item"|"modifiers"|"pairings"|"sizes"|"import"|"bulk"|"categories"|"library">("item"),[message,setMessage]=useState(""),[open,setOpen]=useState(false);
 const [page,setPage]=useState(1),[picked,setPicked]=useState<string|null>(null),[more,setMore]=useState(false);
 const item=data.items.find(x=>x.id===selected)||null; const refresh=async()=>{const r=await actions.dataAction();if(r.ok)setData(r.data)};
 const active=data.items.filter(x=>x.isActive),cats=data.categories.filter(c=>c.isActive);
 const visible=useMemo(()=>data.items.filter(x=>category==="archived"?!x.isActive:!x.isActive?false:category==="all"?true:category==="popular"?(x.tags??[]).includes("bestseller"):category==="out"?stateOf(x,data).key==="out":x.categoryId===category).filter(x=>`${x.nameEn} ${x.nameHi??""} ${x.searchTerms??""}`.toLowerCase().includes(query.toLowerCase())),[data,category,query]);
 const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE)),current=Math.min(page,pages),shown=visible.slice((current-1)*PAGE_SIZE,current*PAGE_SIZE);
 const openDish=data.items.find(x=>x.id===picked)??null;
 const out=active.filter(x=>stateOf(x,data).key==="out").length,popular=active.filter(x=>(x.tags??[]).includes("bestseller")).length,archived=data.items.length-active.length;
 const tabs:[string,string,number][]=[["all","All",active.length],...(popular?[["popular","Popular",popular] as [string,string,number]]:[]),...cats.map(c=>[c.id,c.nameEn,active.filter(x=>x.categoryId===c.id).length] as [string,string,number]),...(out?[["out","Sold out",out] as [string,string,number]]:[]),...(archived?[["archived","Archived",archived] as [string,string,number]]:[])];
 const openPanel=(next:typeof panel,id:string|null=selected)=>{setSelected(id);setPanel(next);setOpen(true)};
 const title=panel==="item"?(item?item.nameEn:"New dish"):panel==="modifiers"?"Choices and extras":panel==="sizes"?"Sizes and prices":panel==="pairings"?"Goes well with":panel==="import"?"Import a menu":panel==="bulk"?"Change many prices":panel==="library"?"Add from the menu library":"Categories";
 const act=secondaryButton;
 const done=(ok:string)=>(r:{ok:boolean;error?:string})=>{setMessage(r.ok?ok:r.error||"Failed");return refresh()};
 const toggle=(x:Item)=>void actions.availabilityAction(x.id,stateOf(x,data).on?"today":"available").then(done("Availability updated."));
 return <div className="dashboard-theme min-h-[calc(100dvh-4rem)] bg-dashboard-canvas sm:min-h-[calc(100dvh-4.5rem)]"><main className="console-ui mx-auto w-full max-w-[1440px] px-3 py-3 pb-6 text-ink sm:px-6 sm:py-5 lg:px-8 lg:py-6">
  <header className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0"><h1 className="font-display text-lg font-bold leading-6 tracking-tight sm:text-[28px] sm:leading-8">Menu</h1><p className="mt-1 text-sm font-medium text-muted">Choose a category to see its dishes{data.outlets.length>1?` · shared by ${data.outlets.length} outlets`:""}.</p></div>
   <div className="flex items-center gap-2"><div className="relative">{more&&<button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={()=>setMore(false)}/>}<button type="button" aria-expanded={more} aria-label="More menu actions" className={`${act} relative z-20 !px-3`} onClick={()=>setMore(!more)}><MoreHorizontal className="size-4" aria-hidden="true"/>More</button>{more&&<div className="absolute right-0 z-20 mt-1 grid w-48 gap-1 rounded-input border border-line bg-surface p-1.5 shadow-lg [&>button]:w-full [&>button]:justify-start [&>button]:border-0" onClick={()=>setMore(false)}><button className={act} onClick={()=>openPanel("library",null)}>Add from library</button><button className={act} onClick={()=>openPanel("import",null)}>Import</button><button className={act} onClick={()=>openPanel("categories",null)}>Categories</button>{canEditPrice&&<button className={act} onClick={()=>openPanel("bulk",null)}>Change prices</button>}</div>}</div><button className={primaryButton} onClick={()=>openPanel("item",null)}><Plus className="size-4" aria-hidden="true"/>New dish</button></div></header>
  {message&&<p role="status" className="mt-4 flex items-center justify-between gap-3 rounded-input border border-line bg-sage p-3 text-sm font-semibold">{message}<button type="button" aria-label="Dismiss" onClick={()=>setMessage("")} className="grid size-8 cursor-pointer place-items-center rounded-lg hover:bg-ink/5"><X className="size-4" aria-hidden="true"/></button></p>}
  <div className="mt-4 flex flex-wrap items-center gap-3">
   <div role="tablist" aria-label="Categories" className="no-scrollbar flex min-w-0 flex-1 basis-full gap-2 overflow-x-auto lg:basis-0">{tabs.map(([id,label,n])=><button key={id} type="button" role="tab" aria-selected={category===id} onClick={()=>{setCategory(id);setPage(1)}} className={`min-h-10 shrink-0 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors ${category===id?"border-forest bg-forest text-white":"border-line bg-surface text-muted hover:text-ink"}`}>{label} <span className="tabular-nums opacity-70">{n}</span></button>)}</div>
   <div className="relative w-full lg:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true"/><input aria-label="Search the menu" className={`${FIELD} w-full pl-9 font-normal`} placeholder="Search dishes" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></div>
  </div>
  {visible.length===0?<section className="mt-4 rounded-2xl border border-line bg-surface px-6 py-12 text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-sage text-forest"><UtensilsCrossed className="size-6" aria-hidden="true"/></span><h2 className="mt-3 font-display text-[15px] font-bold">{active.length===0?"Add your first dish":"No dishes here"}</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted">{query?"Nothing matches your search.":active.length===0?"Start with a few dishes. You can set the price, photo and extras for each one.":"This category has no dishes yet."}</p><div className="mt-5 flex flex-wrap justify-center gap-2"><button className={primaryButton} onClick={()=>openPanel("item",null)}><Plus className="size-4" aria-hidden="true"/>New dish</button>{active.length===0&&<><button className={act} onClick={()=>openPanel("library",null)}>Add from library</button><button className={act} onClick={()=>openPanel("import",null)}>Import a menu</button></>}</div></section>
  :<>
   <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{shown.map(x=>{const s=stateOf(x,data),p=sizesOf(x,data);return <li key={x.id} className="min-w-0"><article className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-forest/30">
    <button type="button" aria-label={`Open ${x.nameEn}`} onClick={()=>setPicked(x.id)} className="flex min-w-0 flex-1 cursor-pointer flex-col justify-start text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--state-available)]">
     <span className={`block ${s.on||!x.isActive?"":"opacity-50"}`}><Thumb url={x.imageUrl} size="h-28 w-full !rounded-none sm:h-36"/></span>
     <span className="block p-3"><span className="flex items-start gap-1.5"><span className="mt-0.5"><VegMark veg={x.isVeg}/></span><span className="line-clamp-2 min-w-0 text-sm font-bold leading-tight">{x.nameEn}</span></span><span className="mt-1.5 block text-sm font-bold tabular-nums">{p.sizes.length?`From ${rupees(Math.min(...p.sizes.map(z=>z.paise)))}`:rupees(p.base)}</span></span>
    </button>
    <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2"><span className={`min-w-0 truncate text-xs font-semibold ${s.key==="available"?"text-[var(--state-available-text)]":s.key==="limited"?"text-[var(--state-held-text)]":s.key==="out"?"text-danger":"text-muted"}`}>{s.key==="limited"?s.note:s.label}</span>{x.isActive&&<Toggle on={s.on} label={`Available: ${x.nameEn}`} onChange={()=>toggle(x)}/>}</div>
   </article></li>})}</ul>
   {pages>1&&<div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-muted">Showing {shown.length} of {visible.length}</p><div className="flex items-center gap-2"><button type="button" className={`${secondaryButton} !min-h-9 !px-3 text-xs`} disabled={current===1} onClick={()=>setPage(current-1)}>Previous</button><span className="text-xs font-semibold tabular-nums">{current} / {pages}</span><button type="button" className={`${secondaryButton} !min-h-9 !px-3 text-xs`} disabled={current===pages} onClick={()=>setPage(current+1)}>Next</button></div></div>}
  </>}
  <Sheet open={!!openDish} onOpenChange={o=>{if(!o)setPicked(null)}}><SheetContent className="w-full gap-0 overflow-y-auto bg-surface p-0 data-[side=right]:sm:max-w-md"><SheetTitle className="sr-only">{openDish?.nameEn??"Dish"}</SheetTitle><SheetDescription className="sr-only">Prices and availability for this dish.</SheetDescription>{openDish&&<DishPanel key={openDish.id} item={openDish} data={data} onEdit={()=>{setPicked(null);openPanel("item",openDish.id)}} onSizes={()=>{setPicked(null);openPanel("sizes",openDish.id)}} onToggle={()=>toggle(openDish)} done={done}/>}</SheetContent></Sheet>
  <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-xl"><SheetHeader><SheetTitle className="font-display text-title font-bold">{title}</SheetTitle><SheetDescription>{panel==="item"?(item?"Change anything about this dish and save.":"Fill in the basics. You can add extras and photos after."):panel==="library"?"Hundreds of common dishes, ready to add. You set the prices.":"Changes apply to your whole menu."}</SheetDescription></SheetHeader>
   <div className="px-4 pb-8">{panel==="item"?<Editor item={item} data={data} canEditPrice={canEditPrice} onSaved={async m=>{setMessage(m);await refresh()}} onPanel={setPanel}/>:panel==="sizes"&&item?<SizesPanel item={item} data={data} canEditPrice={canEditPrice} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="modifiers"&&item?<ModifierPanel item={item} data={data} canEditPrice={canEditPrice} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="pairings"&&item?<PairingPanel item={item} data={data} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="import"?<ImportPanel onDone={m=>{setMessage(m);void refresh()}}/>:panel==="bulk"?<BulkPanel data={data} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="library"?<LibraryPanel canEdit={canEditPrice} onDone={m=>{setMessage(m);setOpen(false);void refresh()}}/>:<CategoryPanel data={data} onDone={m=>{setMessage(m);void refresh()}}/>}</div></SheetContent></Sheet>
 </main></div>;
}
function Thumb({url,size="size-9 sm:size-11"}:{url:string|null;size?:string}){
 // Menu photos live in the photo bucket, so this stays a plain image
 // eslint-disable-next-line @next/next/no-img-element
 return <span className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-lg bg-ink/5 text-muted`}>{url?<img src={url} alt="" className="size-full object-cover"/>:<UtensilsCrossed className="size-4" aria-hidden="true"/>}</span>;
}
function VegMark({veg}:{veg:boolean}){return <span aria-label={veg?"Vegetarian":"Non-vegetarian"} title={veg?"Veg":"Non-veg"} className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] ${veg?"border-[#237a68]":"border-[#b83a3a]"}`}><i className={`size-1.5 rounded-full ${veg?"bg-[#237a68]":"bg-[#b83a3a]"}`}/></span>}
function Toggle({on,label,onChange}:{on:boolean;label:string;onChange:()=>void}){return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"><span className={`relative block h-6 w-10 rounded-full transition-colors ${on?"bg-[var(--state-available)]":"bg-ink/20"}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on?"left-[18px]":"left-0.5"}`}/></span></button>}
function DishPanel({item,data,onEdit,onSizes,onToggle,done}:{item:Item;data:Data;onEdit:()=>void;onSizes:()=>void;onToggle:()=>void;done:(ok:string)=>(r:{ok:boolean;error?:string})=>Promise<void>}){
 const s=stateOf(item,data),p=sizesOf(item,data),o=data.overrides.find(x=>x.itemId===item.id),cat=data.categories.find(c=>c.id===item.categoryId)?.nameEn;
 return <>
  <Thumb url={item.imageUrl} size="h-44 w-full !rounded-none"/>
  <div className="border-b border-line px-5 py-4"><div className="flex flex-wrap items-center gap-2"><VegMark veg={item.isVeg}/><h2 className="min-w-0 font-display text-lg font-bold leading-6">{item.nameEn}</h2><Pill className={s.tone}>{s.label}</Pill></div><p className="mt-1 text-xs font-medium text-muted">{[item.nameHi,cat,`${item.prepMinutes} min`].filter(Boolean).join(" · ")}</p></div>
  <DetailSection title={p.sizes.length?"Sizes and prices":"Price"}>
   {p.sizes.length?<dl className="space-y-1.5 text-sm">{p.sizes.map(z=><div key={z.id} className="flex justify-between gap-3"><dt className="text-muted">{z.name}</dt><dd className="font-semibold tabular-nums">{rupees(z.paise)}</dd></div>)}</dl>:<p className="font-display text-2xl font-bold tabular-nums">{rupees(p.base)}</p>}
   {item.isActive&&<button type="button" className={`mt-3 ${secondaryButton}`} onClick={onSizes}>Edit sizes and prices</button>}
  </DetailSection>
  {item.isActive&&<DetailSection title="Today">
   <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Available to order</span><Toggle on={s.on} label={`Available: ${item.nameEn}`} onChange={onToggle}/></div>
   <label className="mt-3 flex items-center justify-between gap-3 text-sm font-medium">Portions left<input key={String(o?.portionsLeft)} aria-label={`Portions left for ${item.nameEn}`} className="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-right text-sm text-ink" type="number" min="0" placeholder="No limit" defaultValue={o?.portionsLeft??""} onBlur={e=>{const next=e.target.value===""?null:Number(e.target.value);if(next!==(o?.portionsLeft??null))void actions.portionsAction(item.id,next).then(done("Portions updated."))}}/></label>
   <p className="mt-2 text-xs text-muted">Leave it empty for no limit. At 0 the dish shows as sold out.</p>
  </DetailSection>}
  <DetailSection>
   <button type="button" className={`w-full ${primaryButton}`} onClick={onEdit}>Edit dish details</button>
   <button type="button" className="mt-3 cursor-pointer text-xs font-semibold text-muted underline-offset-4 hover:text-ink hover:underline" onClick={()=>void actions.archiveItemAction(item.id,item.isActive).then(done("Dish updated."))}>{item.isActive?"Archive this dish":"Restore this dish"}</button>
  </DetailSection>
 </>;
}
const ALLERGENS=["Milk","Nuts","Gluten","Soy","Egg","Fish","Shellfish","Sesame"];
const SPICES:[string,string][]=[["","Not sure"],["0","Not spicy"],["1","Mild"],["2","Medium"],["3","Hot"]];
const chip=(on:boolean)=>`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors ${on?"border-forest bg-sage text-ink":"border-line bg-surface text-muted hover:text-ink"}`;
const lab="text-sm font-semibold text-ink";
const hint="mt-1 text-xs text-muted";
const inp="h-11 rounded-xl border-line bg-surface px-3 text-sm";
function Block({title,note,children}:{title:string;note?:string;children:React.ReactNode}){return <section className="rounded-2xl border border-line bg-surface p-4"><h3 className="font-display text-section font-bold">{title}</h3>{note&&<p className={hint}>{note}</p>}<div className="mt-3 space-y-4">{children}</div></section>}
function Editor(props:{item:Data["items"][number]|null;data:Data;canEditPrice:boolean;onSaved:(m:string)=>Promise<void>;onPanel:(p:"modifiers"|"pairings"|"sizes")=>void}){
 // A new dish can start from the library: picking one fills the form (and its category) in
 const [seed,setSeed]=useState<LibraryItemView|null>(null);
 if(props.item)return <EditorForm {...props} seed={null}/>;
 return <div className="space-y-4"><LibraryQuickPick onPick={setSeed}/>{seed&&<p role="status" className="rounded-xl bg-[var(--state-available-soft)] p-3 text-sm font-semibold text-[var(--state-available-text)]">Filled in from “{seed.nameEn}”. Add the price and check the rest.</p>}<EditorForm key={seed?.id??"blank"} {...props} seed={seed}/></div>;
}
function EditorForm({item,data,canEditPrice,onSaved,onPanel,seed}:{item:Data["items"][number]|null;data:Data;canEditPrice:boolean;onSaved:(m:string)=>Promise<void>;onPanel:(p:"modifiers"|"pairings"|"sizes")=>void;seed:LibraryItemView|null}){
 // The seed's category: the menu's own when it has one with that name, else made on save
 const seedCategory=seed?data.categories.find(c=>c.nameEn.trim().toLowerCase()===seed.categoryName.trim().toLowerCase()):undefined;
 const draft=item??{id:"",categoryId:seed?(seedCategory?.id??`lib:${seed.categoryKey}`):data.categories[0]?.id??"",nameEn:seed?.nameEn??"",nameHi:seed?.nameHi??null,pricePaise:0,isVeg:seed?.isVeg??true,isJain:false,spiceLevel:seed?seed.spice:null,allergens:null,searchTerms:seed?.searchTerms??null,prepMinutes:seed?.prepMinutes??15,station:seed?.station??"Main"};
 const newItem=!item;
 const [useSizes,setUseSizes]=useState(false);
 const [newSizes,setNewSizes]=useState([{name:"Half",price:""},{name:"Full",price:""}]);
 const known=Array.isArray(draft.allergens)?draft.allergens:[];
 const [photo,setPhoto]=useState((draft as {imageUrl?:string|null}).imageUrl??""),[veg,setVeg]=useState(draft.isVeg),[jain,setJain]=useState(!!draft.isJain),[spice,setSpice]=useState(draft.spiceLevel==null?"":String(draft.spiceLevel));
 const [allergenMode,setAllergenMode]=useState<"unknown"|"none"|"some">(known.length===0?"unknown":known.length===1&&known[0].toLowerCase()==="none"?"none":"some");
 const [picked,setPicked]=useState<string[]>(known.filter(x=>x.toLowerCase()!=="none"));
 const [prep,setPrep]=useState(String(draft.prepMinutes)),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[photoError,setPhotoError]=useState(""),[dragging,setDragging]=useState(false);
 const stations=[...new Set(data.items.map(x=>x.station).filter(Boolean))];
 const override=item?data.overrides.find(x=>x.itemId===item.id):null;
 const upload=async(file:File)=>{setUploading(true);setPhotoError("");try{const p=await shrinkPhoto(file);const r=await actions.uploadImageAction(p.name,p.type,p.base64);if(r.ok)setPhoto(r.data.url);else setPhotoError(r.error)}catch{setPhotoError(navigator.onLine?"Could not upload. The app may have just updated: refresh the page and try again.":"You are offline. Connect to the internet and try again.")}finally{setUploading(false)}};
 return <form className="space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);const q=new FormData(e.currentTarget);
  const allergens=allergenMode==="unknown"?[]:allergenMode==="none"?["none"]:picked;
  let categoryId=String(q.get("categoryId"));
  if(categoryId.startsWith("lib:")){const c=await actions.libraryEnsureCategoryAction(categoryId.slice(4));if(!c.ok){setBusy(false);await onSaved(c.error||"Failed");return}categoryId=c.data}
  const r=await actions.saveItemAction({id:newItem?undefined:draft.id,categoryId,nameEn:String(q.get("nameEn")),nameHi:String(q.get("nameHi")||""),pricePaise:Math.round(Number(q.get("price"))*100),isVeg:veg,isJain:jain,spiceLevel:spice===""?null:Number(spice),allergens,searchTerms:String(q.get("aliases")||""),prepMinutes:Number(prep),station:String(q.get("station")),imageUrl:photo,sizes:newItem&&useSizes?newSizes.map(x=>({name:x.name,pricePaise:Math.round(Number(x.price)*100)})):undefined});
  setBusy(false);await onSaved(r.ok?(newItem?"Dish added.":"Dish saved."):r.error||"Failed")}}>
  <p className={hint}>{data.outlets.length>1?`Dish details and base prices are shared by all ${data.outlets.length} outlets. Availability and portions are set for this outlet; custom prices are in Pricing.`:"Dish details show up on your menu right away. Availability and portions are set for this outlet."}</p>

  <Block title="Photo" note="A good photo helps guests choose. Square photos look best.">
   {/* Drop a photo anywhere on this box, or paste one copied from elsewhere */}
   <div onDragOver={e=>{if([...e.dataTransfer.items].some(i=>i.kind==="file")){e.preventDefault();setDragging(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);const f=[...e.dataTransfer.files].find(x=>x.type.startsWith("image/"));if(f)void upload(f);else if(e.dataTransfer.files.length)setPhotoError("Drop a photo (JPG, PNG or WebP).")}} onPaste={e=>{const f=[...e.clipboardData.files].find(x=>x.type.startsWith("image/"));if(f){e.preventDefault();void upload(f)}}} className={`flex min-w-0 items-center gap-3 rounded-xl border-2 border-dashed p-2 sm:gap-4 ${dragging?"border-forest bg-sage":"border-transparent"}`}><span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-ink/5 text-3xl sm:size-24">{photo?<img src={photo} alt="" className="size-full object-cover"/>:"🍽"}</span>
    <div className="min-w-0 flex-1 space-y-2"><label className={`inline-flex min-h-10 max-w-full cursor-pointer items-center whitespace-nowrap rounded-xl border border-line px-3 text-sm font-semibold hover:border-ink/40 ${uploading?"opacity-60":""}`}>{uploading?"Uploading…":photo?"Change photo":"Upload photo"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f)}}/></label><p className="text-xs text-muted">{dragging?"Drop it here":"Or drag a photo here"}</p>{photo&&<button type="button" className="block text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink" onClick={()=>setPhoto("")}>Remove photo</button>}{photoError&&<p role="alert" className="text-xs font-semibold text-danger">{photoError}</p>}</div></div>
  </Block>

  <Block title="Basics">
   <div><Label htmlFor="nameEn" className={lab}>Dish name</Label><Input id="nameEn" name="nameEn" className={`mt-1 ${inp}`} defaultValue={draft.nameEn} required placeholder="e.g. Paneer Tikka"/></div>
   <div><Label htmlFor="nameHi" className={lab}>Name in Hindi <span className="font-normal text-muted">(optional)</span></Label><Input id="nameHi" name="nameHi" className={`mt-1 ${inp}`} defaultValue={draft.nameHi??""} placeholder="पनीर टिक्का"/></div>
   <div><Label htmlFor="categoryId" className={lab}>Category</Label><select id="categoryId" name="categoryId" className="mt-1 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" defaultValue={draft.categoryId}>{seed&&!seedCategory&&<option value={`lib:${seed.categoryKey}`}>{seed.categoryName} (new)</option>}{data.categories.filter(c=>c.isActive||c.id===draft.categoryId).map(c=><option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></div>
  </Block>

  <Block title="Price">
   <div><Label htmlFor="price" className={lab}>Price</Label><div className="relative mt-1"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">₹</span><Input id="price" name="price" type="number" step="1" min="0" className={`${inp} pl-7 text-base font-bold`} defaultValue={draft.pricePaise/100} readOnly={!canEditPrice}/></div>
    {!canEditPrice&&<p className={hint}>Only the owner can change prices.</p>}
    {override?.pricePaise!=null&&<p className={hint}>At this outlet the price is ₹{(override.pricePaise/100).toFixed(2)} (set in Pricing).</p>}</div>
  </Block>

  {newItem&&<Block title="Sizes · Half / Full plate" note="Set different prices while adding this dish."><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={useSizes} onChange={e=>setUseSizes(e.target.checked)}/>This dish has sizes</label>{useSizes&&<><p className={hint}>The lowest size price becomes the base price.</p>{newSizes.map((size,i)=><div key={i} className="flex flex-wrap gap-2"><Input aria-label={`Size ${i+1} name`} className="min-w-0 flex-1" value={size.name} required maxLength={80} onChange={e=>setNewSizes(old=>old.map((x,j)=>i===j?{...x,name:e.target.value}:x))}/><Input aria-label={`Size ${i+1} price`} className="w-28" type="number" min="1" step="1" value={size.price} required onChange={e=>setNewSizes(old=>old.map((x,j)=>i===j?{...x,price:e.target.value}:x))}/><button type="button" disabled={newSizes.length<=2} onClick={()=>setNewSizes(old=>old.filter((_,j)=>j!==i))}>Remove</button></div>)}<button type="button" className="rounded-xl border px-3 py-2 text-sm" disabled={newSizes.length>=20} onClick={()=>setNewSizes(old=>[...old,{name:"",price:""}])}>+ Add size</button></>}</Block>}
  <Block title="Food details" note="Shown to guests so they can choose safely.">
   <div><p className={lab}>Type</p><div className="mt-1.5 flex flex-wrap gap-2">
    <button type="button" aria-pressed={veg} onClick={()=>setVeg(true)} className={`${chip(veg)} inline-flex items-center gap-2`}><i className="size-2.5 rounded-full bg-[#237a68]"/>Veg</button>
    <button type="button" aria-pressed={!veg} onClick={()=>setVeg(false)} className={`${chip(!veg)} inline-flex items-center gap-2`}><i className="size-2.5 rounded-full bg-[#b83a3a]"/>Non-veg</button>
    <button type="button" aria-pressed={jain} onClick={()=>setJain(!jain)} className={chip(jain)}>Jain</button></div></div>
   <div><p className={lab}>How spicy?</p><div className="mt-1.5 flex flex-wrap gap-2">{SPICES.map(([v,l])=><button key={v||"u"} type="button" aria-pressed={spice===v} onClick={()=>setSpice(v)} className={chip(spice===v)}>{l}</button>)}</div></div>
   <div><p className={lab}>Allergens</p><div className="mt-1.5 flex flex-wrap gap-2">
    <button type="button" aria-pressed={allergenMode==="unknown"} onClick={()=>setAllergenMode("unknown")} className={chip(allergenMode==="unknown")}>Not sure</button>
    <button type="button" aria-pressed={allergenMode==="none"} onClick={()=>setAllergenMode("none")} className={chip(allergenMode==="none")}>None</button>
    {ALLERGENS.map(a=><button key={a} type="button" aria-pressed={allergenMode==="some"&&picked.includes(a)} onClick={()=>{setAllergenMode("some");setPicked(x=>x.includes(a)?x.filter(y=>y!==a):[...x,a])}} className={chip(allergenMode==="some"&&picked.includes(a))}>{a}</button>)}</div>
    <p className={hint}>{allergenMode==="unknown"?"Guests will see “allergens not listed”.":allergenMode==="none"?"Guests will see “no common allergens”.":"Tap every allergen this dish contains."}</p></div>
  </Block>

  <Block title="Kitchen">
   <div><Label htmlFor="station" className={lab}>Which kitchen station makes it?</Label><Input id="station" name="station" list="stations" className={`mt-1 ${inp}`} defaultValue={draft.station} required/><datalist id="stations">{stations.map(x=><option key={x} value={x}/>)}</datalist></div>
   <div><p className={lab}>Time to make it</p><div className="mt-1.5 flex flex-wrap items-center gap-2">{[5,10,15,20,30,45].map(m=><button key={m} type="button" aria-pressed={prep===String(m)} onClick={()=>setPrep(String(m))} className={chip(prep===String(m))}>{m} min</button>)}<Input aria-label="Minutes" type="number" min="0" value={prep} onChange={e=>setPrep(e.target.value)} className="h-10 w-20 rounded-xl border-line bg-surface px-2 text-sm"/></div></div>
  </Block>

  <Block title="Search" note="Other names guests might type, separated by commas.">
   <Input name="aliases" className={inp} defaultValue={draft.searchTerms??""} placeholder="e.g. tikka, paneer starter"/>
  </Block>

  {item&&<Block title="More options"><div className="grid gap-2 sm:grid-cols-2"><button type="button" className="rounded-xl border border-line p-3 text-left hover:border-ink/40 sm:col-span-2" onClick={()=>onPanel("sizes")}><b className="block text-sm">Sizes · Half / Full plate</b><span className="text-xs text-muted">Sell the same dish in different sizes at different prices</span></button><button type="button" className="rounded-xl border border-line p-3 text-left hover:border-ink/40" onClick={()=>onPanel("modifiers")}><b className="block text-sm">Choices and extras</b><span className="text-xs text-muted">Size, add-ons, spice level…</span></button><button type="button" className="rounded-xl border border-line p-3 text-left hover:border-ink/40" onClick={()=>onPanel("pairings")}><b className="block text-sm">Goes well with</b><span className="text-xs text-muted">Suggest other dishes</span></button></div></Block>}

  <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button disabled={busy} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover disabled:opacity-60">{busy?"Saving…":newItem?"Add dish":"Save changes"}</button></div>
 </form>}
const SIZE_PRESETS=["Quarter","Half","Full","Small","Medium","Large","Regular"];
function SizesPanel({item,data,canEditPrice,onDone}:{item:Data["items"][number];data:Data;canEditPrice:boolean;onDone:(m:string)=>void}){
 const group=data.groups.find(g=>g.itemId===item.id&&/^size$/i.test(g.nameEn.trim()));
 const base=item.pricePaise;
 const existing=group?data.modifiers.filter(m=>m.groupId===group.id).map(m=>({id:m.id as string|undefined,name:m.nameEn,price:String((base+m.priceDeltaPaise)/100)})):[];
 const [rows,setRows]=useState<{id?:string;name:string;price:string}[]>(existing.length?existing:[{name:"Half",price:String(base/100||"")},{name:"Full",price:""}]);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const set=(i:number,patch:Partial<typeof rows[number]>)=>setRows(r=>r.map((x,j)=>j===i?{...x,...patch}:x));
 const valid=rows.length>=2&&rows.every(r=>r.name.trim()&&Number(r.price)>0)&&new Set(rows.map(r=>r.name.trim().toLowerCase())).size===rows.length;
 const sorted=[...rows].sort((a,b)=>Number(a.price)-Number(b.price));
 const min=sorted.length?Number(sorted[0].price):0;
 const save=async()=>{
  setBusy(true);setError("");
  try{
   if(canEditPrice&&Math.round(min*100)!==item.pricePaise){
    const r=await actions.saveItemAction({id:item.id,categoryId:item.categoryId,nameEn:item.nameEn,nameHi:item.nameHi??"",pricePaise:Math.round(min*100),isVeg:item.isVeg,isJain:item.isJain,spiceLevel:item.spiceLevel,allergens:item.allergens??[],searchTerms:item.searchTerms??"",prepMinutes:item.prepMinutes,station:item.station,imageUrl:(item as {imageUrl?:string|null}).imageUrl??""});
    if(!r.ok){setError(r.error||"Could not save the base price");return}
   }
   const basePaise=canEditPrice?Math.round(min*100):item.pricePaise;
   const r=await actions.modifierAction({id:group?.id,itemId:item.id,nameEn:"Size",nameHi:"साइज़",minSelect:1,maxSelect:1,options:sorted.map(o=>({id:o.id,nameEn:o.name.trim(),nameHi:"",priceDeltaPaise:Math.max(0,Math.round(Number(o.price)*100)-basePaise),isAvailable:true}))});
   onDone(r.ok?"Sizes saved.":r.error||"Failed");
  }finally{setBusy(false)}
 };
 return <div className="space-y-4">
  <p className={hint}>Guests must pick one size before ordering. The smallest size sets the starting price shown on the menu.</p>
  <Block title="Sizes for “{item.nameEn}”" note="Type the full price of each size, not the difference.">
   {!canEditPrice&&<p className="rounded-xl bg-[var(--state-held-soft)] p-3 text-sm text-[var(--state-held-text)]">Only the owner can change prices, so you can only view sizes here.</p>}
   <ul className="space-y-2">{rows.map((r,i)=><li key={i} className="flex items-center gap-2 rounded-xl border border-line p-2.5">
    <Input aria-label="Size name" value={r.name} onChange={e=>set(i,{name:e.target.value})} placeholder="e.g. Half" className="h-11 flex-1 rounded-xl" disabled={!canEditPrice}/>
    <div className="relative w-32 shrink-0"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">₹</span><Input aria-label={`Price of ${r.name||"size"}`} type="number" min="1" value={r.price} onChange={e=>set(i,{price:e.target.value})} className="h-11 rounded-xl pl-7 font-bold" disabled={!canEditPrice}/></div>
    <button type="button" aria-label={`Remove ${r.name||"size"}`} disabled={rows.length<=2||!canEditPrice} onClick={()=>setRows(x=>x.filter((_,j)=>j!==i))} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--state-seated-soft)] hover:text-danger disabled:opacity-30">✕</button></li>)}</ul>
   {canEditPrice&&<div><p className="text-xs font-semibold text-muted">Add another size</p><div className="mt-1.5 flex flex-wrap gap-2">{SIZE_PRESETS.filter(p=>!rows.some(r=>r.name.trim().toLowerCase()===p.toLowerCase())).map(p=><button key={p} type="button" onClick={()=>setRows(r=>[...r,{name:p,price:""}])} className="min-h-9 rounded-full border border-line px-3 text-sm font-semibold hover:border-ink/40">+ {p}</button>)}<button type="button" onClick={()=>setRows(r=>[...r,{name:"",price:""}])} className="min-h-9 rounded-full border border-dashed border-line px-3 text-sm font-semibold text-muted hover:text-ink">+ Other</button></div></div>}
  </Block>
  {valid&&<Block title="What guests will see"><ul className="divide-y divide-line rounded-xl border border-line">{sorted.map(r=><li key={r.name} className="flex items-center justify-between px-3 py-2 text-sm"><span className="font-semibold">{item.nameEn} · {r.name}</span><b className="tabular-nums">₹{Number(r.price)}</b></li>)}</ul><p className={hint}>Menu shows “starting ₹{min}”.</p></Block>}
  {error&&<p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
  {canEditPrice&&<div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">{group&&<button type="button" className="min-h-12 rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40" onClick={()=>void actions.modifierActiveAction(group.id,false).then(r=>onDone(r.ok?"Sizes removed.":r.error||"Failed"))}>Remove sizes</button>}<button disabled={!valid||busy} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover disabled:opacity-50" onClick={()=>void save()}>{busy?"Saving…":"Save sizes"}</button></div>}
 </div>}
function ModifierPanel({item,data,canEditPrice,onDone}:{item:Data["items"][number];data:Data;canEditPrice:boolean;onDone:(m:string)=>void}){
 const groups=data.groups.filter(g=>g.itemId===item.id&&!/^size$/i.test(g.nameEn.trim()));
 const [sel,setSel]=useState<string>(groups[0]?.id??"new");
 const group=groups.find(g=>g.id===sel);
 return <div className="space-y-4">
  <p className={hint}>Extras are choices a guest makes for this dish, like “Spice level”, “Add cheese” or “Choose a drink”. For Half / Full plate use Sizes instead.</p>
  <div className="flex flex-wrap gap-2">
   {groups.map(g=><button key={g.id} type="button" onClick={()=>setSel(g.id)} className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold ${sel===g.id?"border-forest bg-forest text-white":"border-line hover:border-ink/40"} ${g.isActive?"":"opacity-50"}`}>{g.nameEn}{g.isActive?"":" (off)"}</button>)}
   <button type="button" onClick={()=>setSel("new")} className={`min-h-10 rounded-full border border-dashed px-3.5 text-sm font-semibold ${sel==="new"?"border-forest bg-forest text-white":"border-line text-muted hover:text-ink"}`}>+ New group</button>
  </div>
  <GroupEditor key={sel} item={item} group={group} options={group?data.modifiers.filter(m=>m.groupId===group.id):[]} canEditPrice={canEditPrice} onDone={m=>{onDone(m)}} onCreated={()=>setSel("new")}/>
  {groups.length>1&&<Block title="Order of groups" note="The order guests see them in."><ul className="space-y-1.5">{groups.map((g,i)=><li key={g.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><span className="flex-1 font-semibold">{g.nameEn}</span><button type="button" disabled={i===0} aria-label={`Move ${g.nameEn} up`} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" onClick={()=>{const ids=groups.map(x=>x.id);[ids[i-1],ids[i]]=[ids[i],ids[i-1]];void actions.modifierOrderAction(item.id,ids).then(r=>onDone(r.ok?"Order saved.":r.error||"Failed"))}}>↑</button><button type="button" disabled={i===groups.length-1} aria-label={`Move ${g.nameEn} down`} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" onClick={()=>{const ids=groups.map(x=>x.id);[ids[i+1],ids[i]]=[ids[i],ids[i+1]];void actions.modifierOrderAction(item.id,ids).then(r=>onDone(r.ok?"Order saved.":r.error||"Failed"))}}>↓</button></li>)}</ul></Block>}
 </div>}
function GroupEditor({item,group,options,canEditPrice,onDone,onCreated}:{item:Data["items"][number];group?:Data["groups"][number];options:Data["modifiers"];canEditPrice:boolean;onDone:(m:string)=>void;onCreated:()=>void}){
 const [name,setName]=useState(group?.nameEn??"");
 const [nameHi,setNameHi]=useState(group?.nameHi??"");
 const [required,setRequired]=useState((group?.minSelect??0)>0);
 const [many,setMany]=useState((group?.maxSelect??1)>1);
 const [max,setMax]=useState(String(Math.max(2,group?.maxSelect??3)));
 const [rows,setRows]=useState<{id?:string;nameEn:string;nameHi:string;price:string;isAvailable:boolean}[]>(options.length?options.map(o=>({id:o.id,nameEn:o.nameEn,nameHi:o.nameHi??"",price:String(o.priceDeltaPaise/100),isAvailable:o.isAvailable})):[{nameEn:"",nameHi:"",price:"0",isAvailable:true}]);
 const [busy,setBusy]=useState(false);
 const set=(i:number,patch:Partial<typeof rows[number]>)=>setRows(r=>r.map((x,j)=>j===i?{...x,...patch}:x));
 const move=(i:number,d:number)=>setRows(r=>{const n=[...r],j=i+d;if(j<0||j>=n.length)return n;[n[i],n[j]]=[n[j],n[i]];return n});
 const filled=rows.filter(r=>r.nameEn.trim());
 const maxN=many?Math.max(2,Math.min(20,Number(max)||2)):1;
 const valid=name.trim().length>0&&filled.length>0&&(!required||filled.some(r=>r.isAvailable));
 const save=async()=>{
  setBusy(true);
  try{
   const r=await actions.modifierAction({id:group?.id,itemId:item.id,nameEn:name.trim(),nameHi:nameHi.trim(),minSelect:required?1:0,maxSelect:maxN,options:filled.map(o=>({id:o.id,nameEn:o.nameEn.trim(),nameHi:o.nameHi.trim(),priceDeltaPaise:canEditPrice?Math.max(0,Math.round(Number(o.price||0)*100)):Math.round(Number(o.price||0)*100),isAvailable:o.isAvailable}))});
   onDone(r.ok?"Group saved.":r.error||"Failed");if(r.ok&&!group)onCreated();
  }finally{setBusy(false)}
 };
 const chip=(on:boolean)=>`min-h-10 rounded-full border px-3.5 text-sm font-semibold ${on?"border-forest bg-forest text-white":"border-line hover:border-ink/40"}`;
 return <div className="space-y-4">
  <Block title={group?"Group details":"New group"}>
   <div className="space-y-1.5"><Label htmlFor="g-name">Group name</Label><Input id="g-name" className="h-11 rounded-xl" placeholder="e.g. Spice level, Add-ons" value={name} onChange={e=>setName(e.target.value)}/></div>
   <div className="space-y-1.5"><Label htmlFor="g-hi">Hindi name <span className="font-normal text-muted">(optional)</span></Label><Input id="g-hi" className="h-11 rounded-xl" value={nameHi} onChange={e=>setNameHi(e.target.value)}/></div>
   <div className="space-y-2"><p className="text-sm font-semibold">Guest must choose?</p><div className="flex gap-2"><button type="button" className={chip(!required)} onClick={()=>setRequired(false)}>No, optional</button><button type="button" className={chip(required)} onClick={()=>setRequired(true)}>Yes, required</button></div></div>
   <div className="space-y-2"><p className="text-sm font-semibold">How many can they pick?</p><div className="flex flex-wrap items-center gap-2"><button type="button" className={chip(!many)} onClick={()=>setMany(false)}>Only one</button><button type="button" className={chip(many)} onClick={()=>setMany(true)}>More than one</button>{many&&<span className="flex items-center gap-2 text-sm">up to <Input aria-label="Maximum picks" type="number" min="2" max="20" className="h-10 w-20 rounded-xl" value={max} onChange={e=>setMax(e.target.value)}/></span>}</div></div>
  </Block>
  <Block title="Options" note={canEditPrice?"Extra price is added to the dish price. Use 0 for free.":"Only the owner can change option prices."}>
   <ul className="space-y-2">{rows.map((r,i)=><li key={r.id??i} className={`rounded-xl border border-line p-2.5 ${r.isAvailable?"":"opacity-60"}`}>
    <div className="flex items-center gap-2">
     <Input aria-label={`Option ${i+1} name`} className="h-11 flex-1 rounded-xl" placeholder="Option name" value={r.nameEn} onChange={e=>set(i,{nameEn:e.target.value})}/>
     <div className="relative w-28 shrink-0"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">+₹</span><Input aria-label={`Option ${i+1} extra price`} type="number" min="0" className="h-11 rounded-xl pl-9 font-bold" value={r.price} readOnly={!canEditPrice} onChange={e=>set(i,{price:e.target.value})}/></div>
    </div>
    <div className="mt-2 flex items-center justify-between gap-2">
     <button type="button" role="switch" aria-checked={r.isAvailable} onClick={()=>set(i,{isAvailable:!r.isAvailable})} className="inline-flex min-h-8 items-center gap-2 text-xs font-semibold"><span className={`relative h-5 w-9 rounded-full border ${r.isAvailable?"border-forest bg-forest":"border-line bg-ink/10"}`}><span className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-all ${r.isAvailable?"left-[1.125rem]":"left-0.5"}`}/></span>{r.isAvailable?"Available":"Sold out"}</button>
     <span className="flex gap-1"><button type="button" aria-label="Move up" disabled={i===0} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" onClick={()=>move(i,-1)}>↑</button><button type="button" aria-label="Move down" disabled={i===rows.length-1} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" onClick={()=>move(i,1)}>↓</button>{!r.id&&<button type="button" aria-label="Remove option" className="grid size-8 place-items-center rounded-lg border border-line text-muted hover:text-danger" onClick={()=>setRows(x=>x.length>1?x.filter((_,j)=>j!==i):x)}>✕</button>}</span>
    </div>
   </li>)}</ul>
   <button type="button" onClick={()=>setRows(r=>[...r,{nameEn:"",nameHi:"",price:"0",isAvailable:true}])} className="min-h-10 rounded-full border border-dashed border-line px-4 text-sm font-semibold text-muted hover:text-ink">+ Add option</button>
  </Block>
  <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">
   {group&&<button type="button" className="min-h-12 rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40" onClick={()=>void actions.modifierActiveAction(group.id,!group.isActive).then(r=>onDone(r.ok?(group.isActive?"Group turned off.":"Group turned on."):r.error||"Failed"))}>{group.isActive?"Turn off":"Turn on"}</button>}
   <button type="button" disabled={!valid||busy} onClick={()=>void save()} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover disabled:opacity-50">{busy?"Saving…":group?"Save group":"Create group"}</button>
  </div>
 </div>}
function PairingPanel({item,data,onDone}:{item:Data["items"][number];data:Data;onDone:(m:string)=>void}){
 const [ids,setIds]=useState(data.pairings.filter(x=>x.sourceItemId===item.id).map(x=>x.pairedItemId));
 const [q,setQ]=useState("");
 const [busy,setBusy]=useState(false);
 const others=data.items.filter(x=>x.id!==item.id&&x.isActive);
 const shown=others.filter(x=>!q.trim()||x.nameEn.toLowerCase().includes(q.trim().toLowerCase()));
 const toggle=(id:string)=>setIds(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 return <div className="space-y-4">
  <p className={hint}>Pick dishes that go well with “{item.nameEn}”, like a drink with a burger. Staff can suggest them to guests.</p>
  {ids.length>0&&<Block title={`Chosen (${ids.length})`}><div className="flex flex-wrap gap-2">{ids.map(id=>{const x=data.items.find(i=>i.id===id);return x?<button key={id} type="button" onClick={()=>toggle(id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink bg-ink px-3 text-sm font-semibold text-paper">{x.nameEn}<span aria-hidden="true">✕</span></button>:null})}</div></Block>}
  <Block title="Add dishes">
   <Input aria-label="Search dishes" className="h-11 rounded-xl" placeholder="Search dishes" value={q} onChange={e=>setQ(e.target.value)}/>
   <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
    {shown.map(x=>{const on=ids.includes(x.id);return <li key={x.id}><button type="button" aria-pressed={on} onClick={()=>toggle(x.id)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left hover:bg-ink/5"><span className="min-w-0 truncate text-sm font-semibold">{x.nameEn}</span><span className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs ${on?"border-forest bg-forest text-white":"border-line text-transparent"}`}>✓</span></button></li>})}
    {shown.length===0&&<li className="p-4 text-center text-sm text-muted">No dishes match.</li>}
   </ul>
  </Block>
  <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button type="button" disabled={busy} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover disabled:opacity-50" onClick={()=>{setBusy(true);void actions.pairingsAction(item.id,ids).then(r=>onDone(r.ok?"Pairings saved.":r.error||"Failed")).finally(()=>setBusy(false))}}>{busy?"Saving…":"Save pairings"}</button></div>
 </div>}
function ImportPanel({onDone}:{onDone:(m:string)=>void}){
 const[rows,setRows]=useState<Awaited<ReturnType<typeof import("@/server/staff/menu-import").parseMenuFile>>>([]);const[file,setFile]=useState<File|null>(null);const[error,setError]=useState("");const[validated,setValidated]=useState(false);const[busy,setBusy]=useState(false);
 const template=()=>{const csv=["category,english name,hindi name,price,veg,station,prep minutes","Starters,Paneer Tikka,पनीर टिक्का,260,yes,Tandoor,15","Mains,Dal Makhani,दाल मखनी,220,yes,Main,12","Drinks,Masala Chai,मसाला चाय,50,yes,Bar,5"].join("\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));Object.assign(document.createElement("a"),{href:url,download:"menu-template.csv"}).click();URL.revokeObjectURL(url)};
 const check=async()=>{if(!file)return;setBusy(true);const bytes=new Uint8Array(await file.arrayBuffer());let binary="";bytes.forEach(x=>binary+=String.fromCharCode(x));const r=await actions.importPreviewAction(file.name,btoa(binary));setBusy(false);if(r.ok){setRows(r.data.rows);setError("")}else{setRows([]);setError(r.error||"We could not read this file");onDone(r.error||"Preview failed")}setValidated(true)};
 return <div className="space-y-4">
  <Block title="1 · Get the sheet ready" note="Use a CSV file with one dish per row."><button type="button" onClick={template} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40">Download a sample file</button><p className={hint}>Needed columns: category, english name, price, station, prep minutes. Optional: hindi name, veg.</p></Block>
  <Block title="2 · Choose your file"><label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line px-4 py-6 text-center hover:border-ink/40"><span className="text-2xl" aria-hidden="true">📄</span><b className="text-sm">{file?file.name:"Tap to choose a file"}</b><span className="text-xs text-muted">{file?"Tap to pick a different one":"CSV · up to 1 MB"}</span><input className="sr-only" type="file" accept=".csv,text/csv" onChange={e=>{setFile(e.target.files?.[0]??null);setRows([]);setError("");setValidated(false)}}/></label>
   <button className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-ink bg-ink text-sm font-semibold text-white disabled:opacity-50" disabled={!file||busy} onClick={()=>void check()}>{busy?"Checking…":"Check the file"}</button></Block>
  {validated&&<Block title="3 · Review">{error?<p role="alert" className="rounded-xl border border-danger bg-[var(--state-seated-soft)] p-3 text-sm font-semibold text-danger">{error}</p>:<><p className="rounded-xl bg-[var(--state-available-soft)] p-3 text-sm font-semibold text-[var(--state-available-text)]">{rows.length} {rows.length===1?"dish is":"dishes are"} ready to add. Nothing is added until you confirm.</p>
   <div className="max-h-72 overflow-auto rounded-xl border border-line"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-surface text-muted"><tr><th className="p-2">#</th><th className="p-2">Category</th><th className="p-2">Dish</th><th className="p-2 text-right">Price</th><th className="p-2">Station</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-t border-line"><td className="p-2 text-muted">{i+1}</td><td className="p-2">{r.category}</td><td className="p-2 font-semibold">{r.nameEn}{r.nameHi?<span className="block font-normal text-muted">{r.nameHi}</span>:null}</td><td className="p-2 text-right tabular-nums">₹{r.price}</td><td className="p-2">{r.station}</td></tr>)}</tbody></table></div>
   <button disabled={!rows.length} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover disabled:opacity-50" onClick={()=>void actions.importCommitAction(rows).then(r=>onDone(r.ok?`Added ${r.data.imported} dishes.`:r.error||"Import failed"))}>Add {rows.length} {rows.length===1?"dish":"dishes"} to the menu</button></>}</Block>}
 </div>}

function BulkPanel({data,onDone}:{data:Data;onDone:(m:string)=>void}){
 const[ids,setIds]=useState<string[]>([]),[mode,setMode]=useState<"percent"|"fixed">("percent"),[amount,setAmount]=useState("5"),[cat,setCat]=useState("all"),[q,setQ]=useState("");
 const pool=data.items.filter(x=>x.isActive&&(cat==="all"||x.categoryId===cat)&&`${x.nameEn} ${x.nameHi??""} ${x.searchTerms??""}`.toLowerCase().includes(q.trim().toLowerCase()));
 const catName=(id:string)=>data.categories.find(c=>c.id===id)?.nameEn??"";
 const value=mode==="fixed"?Math.round(Number(amount)*100):Number(amount);
 const changes=data.items.filter(x=>ids.includes(x.id)).map(x=>({x,after:adjustPrice(x.pricePaise,mode,value)}));
 const allOn=pool.length>0&&pool.every(x=>ids.includes(x.id));
 return <div className="space-y-4">
  <Block title="1 · Pick dishes" note="Search, filter by category and tick the dishes. Only the owner can change prices; outlet-only prices are set in Pricing.">
   <div className="relative"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span><Input aria-label="Search dishes" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search dishes" className="h-11 rounded-xl pl-9"/></div>
   <div className="flex flex-wrap items-center gap-2"><select aria-label="Category" value={cat} onChange={e=>setCat(e.target.value)} className="h-10 rounded-xl border border-line bg-surface px-3 text-sm"><option value="all">All categories</option>{data.categories.filter(c=>c.isActive).map(c=><option key={c.id} value={c.id}>{c.nameEn}</option>)}</select><button type="button" className={chip(allOn)} onClick={()=>setIds(allOn?ids.filter(i=>!pool.some(x=>x.id===i)):[...new Set([...ids,...pool.map(x=>x.id)])])}>{allOn?"Unselect these":`Select all ${pool.length}`}</button><span className="ml-auto rounded-full bg-ink/5 px-2.5 py-1 text-xs font-semibold">{ids.length} picked</span></div>
   <ul className="no-scrollbar max-h-72 space-y-2 overflow-auto">{pool.map(x=>{const on=ids.includes(x.id);return <li key={x.id}><label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 transition-colors ${on?"border-forest bg-sage":"border-line hover:border-ink/30"}`}><input type="checkbox" className="size-4 accent-[#c9482b]" checked={on} onChange={e=>setIds(e.target.checked?[...ids,x.id]:ids.filter(id=>id!==x.id))}/><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink/5 text-lg">{(x as {imageUrl?:string|null}).imageUrl?<img src={(x as {imageUrl?:string|null}).imageUrl!} alt="" className="size-full object-cover"/>:"🍽"}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{x.nameEn}</b><span className="block truncate text-xs text-muted">{catName(x.categoryId)} · {x.station}</span></span><span className="text-sm font-bold tabular-nums">₹{(x.pricePaise/100).toFixed(0)}</span></label></li>})}{pool.length===0&&<li className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">{q?"No dish matches your search.":"No dishes here."}</li>}</ul></Block>
  <Block title="2 · How much?"><div className="flex gap-2"><button type="button" aria-pressed={mode==="percent"} onClick={()=>setMode("percent")} className={chip(mode==="percent")}>By percent (%)</button><button type="button" aria-pressed={mode==="fixed"} onClick={()=>setMode("fixed")} className={chip(mode==="fixed")}>By rupees (₹)</button></div>
   <div className="flex items-center gap-2"><button type="button" aria-label="Decrease" className="grid size-11 place-items-center rounded-xl border border-line text-xl" onClick={()=>setAmount(String((Number(amount)||0)-1))}>−</button><Input aria-label="Amount" type="number" value={amount} onChange={e=>setAmount(e.target.value)} className="h-11 w-28 rounded-xl text-center text-lg font-bold"/><button type="button" aria-label="Increase" className="grid size-11 place-items-center rounded-xl border border-line text-xl" onClick={()=>setAmount(String((Number(amount)||0)+1))}>+</button><span className="text-sm text-muted">{mode==="percent"?"%":"₹"} {Number(amount)>=0?"increase":"decrease"}</span></div><p className={hint}>Use a minus number to lower prices. Prices are rounded to whole rupees.</p></Block>
  <Block title="3 · Preview">{changes.length===0?<p className="text-sm text-muted">Pick at least one dish to see the new prices.</p>:<ul className="divide-y divide-line rounded-xl border border-line">{changes.map(c=><li key={c.x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="truncate font-semibold">{c.x.nameEn}</span><span className="tabular-nums"><span className="text-muted line-through">₹{(c.x.pricePaise/100).toFixed(0)}</span> → <b>₹{(c.after/100).toFixed(0)}</b></span></li>)}</ul>}</Block>
  <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button disabled={changes.length===0||!Number.isFinite(value)||value===0} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover disabled:opacity-50" onClick={()=>void actions.bulkPriceAction(ids,mode,value).then(r=>onDone(r.ok?"Prices updated.":r.error||"Failed"))}>Update {changes.length} {changes.length===1?"price":"prices"}</button></div>
 </div>}

function CategoryPanel({data,onDone}:{data:Data;onDone:(m:string)=>void}){
 const[ids,setIds]=useState(data.categories.map(c=>c.id));const[editing,setEditing]=useState<string|null>(null);const[adding,setAdding]=useState(false);const[newName,setNewName]=useState("");const[newHi,setNewHi]=useState("");
 const[form,setForm]=useState({nameEn:"",nameHi:"",availableFrom:"",availableTo:""});const[confirm,setConfirm]=useState<{id:string;kind:"hide"|"delete"}|null>(null);const dirty=ids.join()!==data.categories.map(c=>c.id).join();
 const begin=(c:Data["categories"][number])=>{setEditing(c.id);setForm({nameEn:c.nameEn,nameHi:c.nameHi??"",availableFrom:c.availableFrom??"",availableTo:c.availableTo??""})};
 const sorted=ids.map(i=>data.categories.find(c=>c.id===i)).filter(Boolean) as Data["categories"];
 const move=(id:string,d:-1|1)=>setIds(x=>{const n=[...x],i=n.indexOf(id),j=i+d;if(j<0||j>=n.length)return n;[n[i],n[j]]=[n[j],n[i]];return n});
 const count=(id:string)=>data.items.filter(x=>x.categoryId===id&&x.isActive).length;
 // Any dish at all, hidden ones too: those keep a category from being deleted (old bills point at them)
 const total=(id:string)=>data.items.filter(x=>x.categoryId===id).length;
 const hide=(c:Data["categories"][number],withDishes:boolean)=>void actions.archiveCategoryAction(c.id,false,withDishes).then(r=>{setConfirm(null);onDone(r.ok?(withDishes?`Category ${c.nameEn} and its dishes hidden.`:`Category ${c.nameEn} hidden.`):r.error||"Failed")});
 return <div className="space-y-4">
  <p className={hint}>Categories group your dishes on the guest menu. Use the arrows to change the order guests see. Hide takes a category off the menu; an empty one can be deleted.</p>
  <ul className="space-y-2">{sorted.map((c,i)=><li key={c.id} className={`rounded-2xl border bg-surface p-3 ${c.isActive?"border-line":"border-dashed border-line opacity-70"}`}>
   <div className="flex items-center gap-2"><div className="flex flex-col"><button type="button" aria-label="Move up" disabled={i===0} onClick={()=>move(c.id,-1)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-ink/5 disabled:opacity-30">▲</button><button type="button" aria-label="Move down" disabled={i===sorted.length-1} onClick={()=>move(c.id,1)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-ink/5 disabled:opacity-30">▼</button></div>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{c.nameEn}{c.nameHi?<span className="ml-2 font-normal text-muted">{c.nameHi}</span>:null}</p><p className="text-xs text-muted">{count(c.id)} {count(c.id)===1?"dish":"dishes"} · {c.availableFrom?`${c.availableFrom}${c.availableTo?`–${c.availableTo}`:""}`:"all day"}{c.isActive?"":" · hidden"}</p></div>
    <button type="button" className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold hover:border-ink/40" onClick={()=>editing===c.id?setEditing(null):begin(c)}>{editing===c.id?"Close":"Edit"}</button>
    <button type="button" className="min-h-9 rounded-lg px-2 text-xs font-semibold text-muted hover:text-ink" onClick={()=>c.isActive?(count(c.id)>0?setConfirm({id:c.id,kind:"hide"}):hide(c,false)):void actions.archiveCategoryAction(c.id,true).then(r=>onDone(r.ok?"Category shown again.":r.error||"Failed"))}>{c.isActive?"Hide":"Show"}</button>
    {total(c.id)===0&&<button type="button" aria-label={`Delete ${c.nameEn}`} title="Delete" className="min-h-9 rounded-lg px-2 text-xs font-semibold text-danger hover:bg-[var(--state-seated-soft)]" onClick={()=>setConfirm({id:c.id,kind:"delete"})}>Delete</button>}</div>
   {confirm?.id===c.id&&<div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--state-seated-soft)] p-3 text-sm">
    <span className="min-w-0 flex-1 font-semibold text-ink">{confirm.kind==="delete"?`Delete “${c.nameEn}” for good?`:`Hide “${c.nameEn}” and its ${count(c.id)} ${count(c.id)===1?"dish":"dishes"} from the menu? You can show them again later.`}</span>
    <button type="button" className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs font-semibold" onClick={()=>setConfirm(null)}>Cancel</button>
    <button type="button" className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white" onClick={()=>confirm.kind==="delete"?void actions.deleteCategoryAction(c.id).then(r=>{setConfirm(null);onDone(r.ok?`Category ${c.nameEn} deleted.`:r.error||"Failed")}):hide(c,true)}>{confirm.kind==="delete"?"Delete":"Hide both"}</button>
   </div>}
   {editing===c.id&&<div className="mt-3 space-y-3 border-t border-line pt-3">
    <div className="grid gap-3 sm:grid-cols-2"><div><Label className={lab}>Name</Label><Input className={`mt-1 ${inp}`} value={form.nameEn} onChange={e=>setForm({...form,nameEn:e.target.value})}/></div><div><Label className={lab}>Hindi name</Label><Input className={`mt-1 ${inp}`} value={form.nameHi} onChange={e=>setForm({...form,nameHi:e.target.value})}/></div></div>
    <div><p className={lab}>When is it served?</p><div className="mt-1.5 flex flex-wrap items-center gap-2"><button type="button" aria-pressed={!form.availableFrom&&!form.availableTo} className={chip(!form.availableFrom&&!form.availableTo)} onClick={()=>setForm({...form,availableFrom:"",availableTo:""})}>All day</button><span className="text-xs text-muted">or only between</span><Input aria-label="From" type="time" className="h-10 w-32 rounded-xl" value={form.availableFrom} onChange={e=>setForm({...form,availableFrom:e.target.value})}/><span className="text-xs text-muted">and</span><Input aria-label="To" type="time" className="h-10 w-32 rounded-xl" value={form.availableTo} onChange={e=>setForm({...form,availableTo:e.target.value})}/></div><p className={hint}>Example: a breakfast category from 07:00 to 11:00.</p></div>
    <button className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-forest bg-forest text-sm font-semibold text-white hover:bg-forest-hover" onClick={()=>void actions.saveCategoryAction({id:c.id,nameEn:form.nameEn,nameHi:form.nameHi,availableFrom:form.availableFrom||null,availableTo:form.availableTo||null}).then(r=>{setEditing(null);onDone(r.ok?"Category saved.":r.error||"Failed")})}>Save category</button></div>}
  </li>)}</ul>

  {adding?<form className="space-y-3 rounded-2xl border border-line bg-surface p-3" onSubmit={async e=>{e.preventDefault();const r=await actions.saveCategoryAction({nameEn:newName.trim(),nameHi:newHi.trim()||undefined});setNewName("");setNewHi("");setAdding(false);onDone(r.ok?"Category added.":r.error||"Failed")}}>
   <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="cn" className={lab}>Category name</Label><Input id="cn" autoFocus required className={`mt-1 ${inp}`} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Starters"/></div><div><Label htmlFor="ch" className={lab}>Hindi name <span className="font-normal text-muted">(optional)</span></Label><Input id="ch" className={`mt-1 ${inp}`} value={newHi} onChange={e=>setNewHi(e.target.value)}/></div></div>
   <div className="flex gap-2"><button type="button" className="min-h-11 flex-1 rounded-xl border border-line text-sm font-semibold" onClick={()=>setAdding(false)}>Cancel</button><button disabled={!newName.trim()} className="min-h-11 flex-1 rounded-xl border border-forest bg-forest text-sm font-semibold text-white disabled:opacity-50">Add category</button></div></form>
  :<button type="button" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:border-ink/40 hover:text-ink" onClick={()=>setAdding(true)}><span className="text-lg leading-none">+</span> Add a category</button>}

  {dirty&&<div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-forest bg-forest text-base font-semibold text-white hover:bg-forest-hover" onClick={()=>void actions.reorderAction(ids).then(r=>onDone(r.ok?"New order saved.":r.error||"Failed"))}>Save the new order</button></div>}
 </div>}
