"use client";
import { useMemo, useState } from "react";
import * as actions from "../actions";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { adjustPrice } from "@/domain/price-adjust";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { LibraryItemView } from "@/server/staff/menu-library";
import { LibraryPanel, LibraryQuickPick } from "./library-panel";
type Data = Awaited<ReturnType<typeof import("@/server/staff/menu-manager").menuManagerData>>;
export function MenuManager({initial,canEditPrice}:{initial:Data;canEditPrice:boolean}){
 const [data,setData]=useState(initial),[selected,setSelected]=useState<string|null>(null),[query,setQuery]=useState(""),[category,setCategory]=useState("all"),[panel,setPanel]=useState<"item"|"modifiers"|"pairings"|"sizes"|"import"|"bulk"|"categories"|"library">("item"),[message,setMessage]=useState(""),[open,setOpen]=useState(false);
 const item=data.items.find(x=>x.id===selected)||null; const refresh=async()=>{const r=await actions.dataAction();if(r.ok)setData(r.data)};
 const inCategory=(x:Data["items"][number],cat:string)=>cat==="archived"?!x.isActive:cat==="all"?x.isActive:cat==="popular"?x.isActive&&(x.tags??[]).includes("bestseller"):x.isActive&&x.categoryId===cat;
 const visible=useMemo(()=>data.items.filter(x=>inCategory(x,category)).filter(x=>`${x.nameEn} ${x.nameHi??""} ${x.searchTerms??""}`.toLowerCase().includes(query.toLowerCase())),[data.items,category,query]);
 const isOn=(x:Data["items"][number])=>{const o=data.overrides.find(v=>v.itemId===x.id);return x.isActive&&o?.isAvailable!==false&&(o?.portionsLeft==null||o.portionsLeft>0)};
 const outToday=data.items.filter(x=>x.isActive&&!isOn(x)).length;
 const cats=data.categories.filter(c=>c.isActive);
 const openPanel=(next:typeof panel,id:string|null=selected)=>{setSelected(id);setPanel(next);setOpen(true)};
 const chips:[string,string,number][]=[["all","On the menu",data.items.filter(x=>x.isActive).length],["popular","Popular",data.items.filter(x=>inCategory(x,"popular")).length],...cats.map(c=>[c.id,c.nameEn,data.items.filter(x=>x.isActive&&x.categoryId===c.id).length] as [string,string,number]),["archived","Archived",data.items.filter(x=>!x.isActive).length]];
 const title=panel==="item"?(item?item.nameEn:"New dish"):panel==="modifiers"?"Choices and extras":panel==="sizes"?"Sizes and prices":panel==="pairings"?"Goes well with":panel==="import"?"Import a menu":panel==="bulk"?"Change many prices":panel==="library"?"Add from the menu library":"Categories";
 const act="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-ink";
 return <main className="console-ui mx-auto w-full max-w-[1200px] px-4 py-5 text-ink sm:px-6 lg:px-8 lg:py-7">
  <header className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0"><p className="text-caption font-semibold text-muted">{data.currentOutlet}{data.outlets.length>1?` · shared by ${data.outlets.length} outlets`:""}</p><h1 className="mt-1 font-display text-title font-bold">Menu</h1></div>
   <div className="flex flex-wrap gap-2"><button className={act} onClick={()=>openPanel("library",null)}>Add from library</button><button className={act} onClick={()=>openPanel("categories",null)}>Categories</button><button className={act} onClick={()=>openPanel("import",null)}>Import</button>{canEditPrice&&<button className={act} onClick={()=>openPanel("bulk",null)}>Change prices</button>}<button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-ink" onClick={()=>openPanel("item",null)}><span aria-hidden="true" className="text-lg leading-none">+</span> New dish</button></div></header>
  {message&&<p role="status" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-brand-soft p-3 text-sm font-semibold">{message}<button type="button" aria-label="Dismiss" onClick={()=>setMessage("")} className="grid size-8 place-items-center rounded-lg hover:bg-ink/5">✕</button></p>}
  <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{([["Dishes",String(data.items.filter(x=>x.isActive).length),"on your menu"],["Categories",String(cats.length),"to group them"],["Out today",String(outToday),outToday?"not being served":"everything is available"]] as const).map(([k,v,n],i)=><div key={k} className={`rounded-2xl border border-line bg-surface p-3 sm:p-4 ${i===2?'col-span-2 sm:col-span-1':''}`}><dt className="text-caption font-semibold text-muted">{k}</dt><dd className="mt-1 font-display text-[26px] leading-8 font-bold tabular-nums">{v}</dd><p className="text-caption text-muted">{n}</p></div>)}</dl>
  <div className="mt-5 flex flex-wrap items-center gap-3"><div role="tablist" aria-label="Categories" className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">{chips.map(([id,label,n])=><button key={id} role="tab" aria-selected={category===id} onClick={()=>setCategory(id)} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${category===id?"border-ink bg-ink text-white":"border-line bg-surface text-muted hover:text-ink"}`}>{label} <span className="tabular-nums opacity-70">{n}</span></button>)}</div>
   <div className="relative w-full sm:w-72"><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span><input aria-label="Search the menu" className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-ink/20" placeholder="Search dishes" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
  {visible.length===0?<section className="mt-5 rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center"><span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-2xl">🍽</span><h2 className="mt-4 font-display text-section font-bold">{category==="archived"?"No archived dishes":data.items.filter(x=>x.isActive).length===0?"Add your first dish":"No dishes here"}</h2><p className="mx-auto mt-1 max-w-md text-body text-muted">{category==="archived"?"Dishes you archive are kept here and can be restored any time.":query?"Nothing matches your search.":category==="all"?"Start with a few dishes. You can set the price, photo and extras for each one.":"This category has no dishes yet."}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{category!=="archived"&&<button className="inline-flex min-h-11 items-center rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-white" onClick={()=>openPanel("item",null)}>+ New dish</button>}{data.items.filter(x=>x.isActive).length===0&&category!=="archived"&&<><button className={act} onClick={()=>openPanel("library",null)}>Add from library</button><button className={act} onClick={()=>openPanel("import",null)}>Import a menu</button></>}</div></section>
  :<ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map(x=><li className="min-w-0" key={x.id}><ItemCard item={x} data={data} on={isOn(x)} onOpen={()=>openPanel("item",x.id)} onMessage={setMessage} refresh={refresh}/></li>)}</ul>}
  <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-full overflow-y-auto bg-background data-[side=right]:sm:max-w-xl"><SheetHeader><SheetTitle className="font-display text-title font-bold">{title}</SheetTitle><SheetDescription>{panel==="item"?(item?"Change anything about this dish and save.":"Fill in the basics. You can add extras and photos after."):panel==="library"?"Hundreds of common dishes, ready to add. You set the prices.":"Changes apply to your whole menu."}</SheetDescription></SheetHeader>
   <div className="px-4 pb-8">{panel==="item"?<Editor item={item} data={data} canEditPrice={canEditPrice} onSaved={async m=>{setMessage(m);await refresh()}} onPanel={setPanel}/>:panel==="sizes"&&item?<SizesPanel item={item} data={data} canEditPrice={canEditPrice} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="modifiers"&&item?<ModifierPanel item={item} data={data} canEditPrice={canEditPrice} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="pairings"&&item?<PairingPanel item={item} data={data} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="import"?<ImportPanel onDone={m=>{setMessage(m);void refresh()}}/>:panel==="bulk"?<BulkPanel data={data} onDone={m=>{setMessage(m);void refresh()}}/>:panel==="library"?<LibraryPanel canEdit={canEditPrice} onDone={m=>{setMessage(m);setOpen(false);void refresh()}}/>:<CategoryPanel data={data} onDone={m=>{setMessage(m);void refresh()}}/>}</div></SheetContent></Sheet>
 </main>;
}
function ItemCard({item,data,on,onOpen,onMessage,refresh}:{item:Data["items"][number];data:Data;on:boolean;onOpen:()=>void;onMessage:(x:string)=>void;refresh:()=>Promise<void>}){
 const o=data.overrides.find(x=>x.itemId===item.id); const cat=data.categories.find(c=>c.id===item.categoryId)?.nameEn;
 const price=((o?.pricePaise??item.pricePaise)/100).toLocaleString("en-IN",{minimumFractionDigits:(o?.pricePaise??item.pricePaise)%100?2:0});
 const sizeGroup=data.groups.find(g=>g.itemId===item.id&&g.isActive&&/^size$/i.test(g.nameEn.trim()));
 const sizes=sizeGroup?data.modifiers.filter(m=>m.groupId===sizeGroup.id):[];
 const done=(ok:string)=>(r:{ok:boolean;error?:string})=>{onMessage(r.ok?ok:r.error||"Failed");return refresh()};
 const label=!item.isActive?"Archived":on?"Available":o?.portionsLeft===0?"Sold out":"Out today";
 return <article className={`flex h-full min-w-0 flex-col rounded-2xl border bg-surface p-4 ${item.isActive?"border-line":"border-dashed border-line opacity-70"}`}>
  <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-3 text-left focus-visible:outline-2 focus-visible:outline-ink" aria-label={`Edit ${item.nameEn}`}>
   <span className="grid size-12 sm:size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink/5 text-2xl">{item.imageUrl?<img src={item.imageUrl} alt="" className="size-full object-cover"/>:"🍽"}</span>
   <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span aria-label={item.isVeg?"Vegetarian":"Non-vegetarian"} title={item.isVeg?"Veg":"Non-veg"} className={`grid size-4 shrink-0 place-items-center rounded-[3px] border-2 ${item.isVeg?"border-[#237a68]":"border-[#b83a3a]"}`}><i className={`size-1.5 rounded-full ${item.isVeg?"bg-[#237a68]":"bg-[#b83a3a]"}`}/></span><strong className="truncate font-display text-section">{item.nameEn}</strong></span>
    <span className="mt-0.5 block truncate text-caption text-muted">{item.nameHi||"No Hindi name"}{cat?` · ${cat}`:""}</span>
    <span className="mt-1 block text-caption text-muted">{item.station} · {item.prepMinutes} min</span>{sizes.length>0&&<span className="mt-1.5 flex flex-wrap gap-1">{sizes.map(m=><span key={m.id} className="rounded-full bg-ink/5 px-2 py-0.5 text-label font-semibold">{m.nameEn} ₹{(((o?.pricePaise??item.pricePaise)+m.priceDeltaPaise)/100).toFixed(0)}</span>)}</span>}</span>
   <span className="text-right"><span className="block font-display text-section font-bold tabular-nums">₹{price}</span>{sizes.length>0&&<span className="block text-label text-muted">starting</span>}</span>
  </button>
  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
   <button type="button" role="switch" aria-checked={on} disabled={!item.isActive} onClick={()=>void actions.availabilityAction(item.id,on?"today":"available").then(done("Availability updated."))} className="flex min-h-9 items-center gap-2 text-sm font-semibold disabled:opacity-50"><span className={`relative h-6 w-11 rounded-full transition-colors ${on?"bg-[#237a68]":"bg-ink/20"}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on?"left-[22px]":"left-0.5"}`}/></span><span className={on?"":"text-warning"}>{label}</span></button>
   <div className="flex items-center gap-2">
    <label className="flex items-center gap-1.5 text-caption text-muted">Left<input aria-label={`Portions left for ${item.nameEn}`} className="h-8 w-14 rounded-lg border border-line bg-surface px-2 text-sm text-ink" type="number" min="0" placeholder="∞" defaultValue={o?.portionsLeft??""} onBlur={e=>void actions.portionsAction(item.id,e.target.value===""?null:Number(e.target.value)).then(done("Portions updated."))}/></label>
    <button type="button" className="min-h-8 rounded-lg px-2 text-caption font-semibold text-muted underline-offset-4 hover:text-ink hover:underline" onClick={()=>void actions.archiveItemAction(item.id,item.isActive).then(done("Dish updated."))}>{item.isActive?"Archive":"Restore"}</button>
   </div>
  </div>
 </article>}
const ALLERGENS=["Milk","Nuts","Gluten","Soy","Egg","Fish","Shellfish","Sesame"];
const SPICES:[string,string][]=[["","Not sure"],["0","Not spicy"],["1","Mild"],["2","Medium"],["3","Hot"]];
const chip=(on:boolean)=>`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors ${on?"border-brand bg-brand-soft text-ink":"border-line bg-surface text-muted hover:text-ink"}`;
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
   <div onDragOver={e=>{if([...e.dataTransfer.items].some(i=>i.kind==="file")){e.preventDefault();setDragging(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);const f=[...e.dataTransfer.files].find(x=>x.type.startsWith("image/"));if(f)void upload(f);else if(e.dataTransfer.files.length)setPhotoError("Drop a photo (JPG, PNG or WebP).")}} onPaste={e=>{const f=[...e.clipboardData.files].find(x=>x.type.startsWith("image/"));if(f){e.preventDefault();void upload(f)}}} className={`flex items-center gap-4 rounded-xl border-2 border-dashed p-2 transition-colors ${dragging?"border-brand bg-brand-soft":"border-transparent"}`}><span className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-ink/5 text-3xl">{photo?<img src={photo} alt="" className="size-full object-cover"/>:"🍽"}</span>
    <div className="space-y-2"><label className={`inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-line px-3.5 text-sm font-semibold hover:border-ink/40 ${uploading?"opacity-60":""}`}>{uploading?"Uploading…":photo?"Change photo":"Upload photo"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f)}}/></label><p className="text-xs text-muted">{dragging?"Drop it here":"Or drag a photo here"}</p>{photo&&<button type="button" className="block text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink" onClick={()=>setPhoto("")}>Remove photo</button>}{photoError&&<p role="alert" className="text-xs font-semibold text-danger">{photoError}</p>}</div></div>
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

  <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button disabled={busy} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-60">{busy?"Saving…":newItem?"Add dish":"Save changes"}</button></div>
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
  {canEditPrice&&<div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">{group&&<button type="button" className="min-h-12 rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40" onClick={()=>void actions.modifierActiveAction(group.id,false).then(r=>onDone(r.ok?"Sizes removed.":r.error||"Failed"))}>Remove sizes</button>}<button disabled={!valid||busy} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50" onClick={()=>void save()}>{busy?"Saving…":"Save sizes"}</button></div>}
 </div>}
function ModifierPanel({item,data,canEditPrice,onDone}:{item:Data["items"][number];data:Data;canEditPrice:boolean;onDone:(m:string)=>void}){
 const groups=data.groups.filter(g=>g.itemId===item.id&&!/^size$/i.test(g.nameEn.trim()));
 const [sel,setSel]=useState<string>(groups[0]?.id??"new");
 const group=groups.find(g=>g.id===sel);
 return <div className="space-y-4">
  <p className={hint}>Extras are choices a guest makes for this dish, like “Spice level”, “Add cheese” or “Choose a drink”. For Half / Full plate use Sizes instead.</p>
  <div className="flex flex-wrap gap-2">
   {groups.map(g=><button key={g.id} type="button" onClick={()=>setSel(g.id)} className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold ${sel===g.id?"border-ink bg-ink text-paper":"border-line hover:border-ink/40"} ${g.isActive?"":"opacity-50"}`}>{g.nameEn}{g.isActive?"":" (off)"}</button>)}
   <button type="button" onClick={()=>setSel("new")} className={`min-h-10 rounded-full border border-dashed px-3.5 text-sm font-semibold ${sel==="new"?"border-ink bg-ink text-paper":"border-line text-muted hover:text-ink"}`}>+ New group</button>
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
 const chip=(on:boolean)=>`min-h-10 rounded-full border px-3.5 text-sm font-semibold ${on?"border-ink bg-ink text-paper":"border-line hover:border-ink/40"}`;
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
     <button type="button" role="switch" aria-checked={r.isAvailable} onClick={()=>set(i,{isAvailable:!r.isAvailable})} className="inline-flex min-h-8 items-center gap-2 text-xs font-semibold"><span className={`relative h-5 w-9 rounded-full border ${r.isAvailable?"border-brand bg-brand":"border-line bg-ink/10"}`}><span className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-all ${r.isAvailable?"left-[1.125rem]":"left-0.5"}`}/></span>{r.isAvailable?"Available":"Sold out"}</button>
     <span className="flex gap-1"><button type="button" aria-label="Move up" disabled={i===0} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" onClick={()=>move(i,-1)}>↑</button><button type="button" aria-label="Move down" disabled={i===rows.length-1} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" onClick={()=>move(i,1)}>↓</button>{!r.id&&<button type="button" aria-label="Remove option" className="grid size-8 place-items-center rounded-lg border border-line text-muted hover:text-danger" onClick={()=>setRows(x=>x.length>1?x.filter((_,j)=>j!==i):x)}>✕</button>}</span>
    </div>
   </li>)}</ul>
   <button type="button" onClick={()=>setRows(r=>[...r,{nameEn:"",nameHi:"",price:"0",isAvailable:true}])} className="min-h-10 rounded-full border border-dashed border-line px-4 text-sm font-semibold text-muted hover:text-ink">+ Add option</button>
  </Block>
  <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-background/95 px-4 py-3 backdrop-blur">
   {group&&<button type="button" className="min-h-12 rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/40" onClick={()=>void actions.modifierActiveAction(group.id,!group.isActive).then(r=>onDone(r.ok?(group.isActive?"Group turned off.":"Group turned on."):r.error||"Failed"))}>{group.isActive?"Turn off":"Turn on"}</button>}
   <button type="button" disabled={!valid||busy} onClick={()=>void save()} className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{busy?"Saving…":group?"Save group":"Create group"}</button>
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
    {shown.map(x=>{const on=ids.includes(x.id);return <li key={x.id}><button type="button" aria-pressed={on} onClick={()=>toggle(x.id)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left hover:bg-ink/5"><span className="min-w-0 truncate text-sm font-semibold">{x.nameEn}</span><span className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs ${on?"border-brand bg-brand text-white":"border-line text-transparent"}`}>✓</span></button></li>})}
    {shown.length===0&&<li className="p-4 text-center text-sm text-muted">No dishes match.</li>}
   </ul>
  </Block>
  <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button type="button" disabled={busy} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50" onClick={()=>{setBusy(true);void actions.pairingsAction(item.id,ids).then(r=>onDone(r.ok?"Pairings saved.":r.error||"Failed")).finally(()=>setBusy(false))}}>{busy?"Saving…":"Save pairings"}</button></div>
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
   <button disabled={!rows.length} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50" onClick={()=>void actions.importCommitAction(rows).then(r=>onDone(r.ok?`Added ${r.data.imported} dishes.`:r.error||"Import failed"))}>Add {rows.length} {rows.length===1?"dish":"dishes"} to the menu</button></>}</Block>}
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
   <ul className="no-scrollbar max-h-72 space-y-2 overflow-auto">{pool.map(x=>{const on=ids.includes(x.id);return <li key={x.id}><label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 transition-colors ${on?"border-brand bg-brand-soft":"border-line hover:border-ink/30"}`}><input type="checkbox" className="size-4 accent-[#c9482b]" checked={on} onChange={e=>setIds(e.target.checked?[...ids,x.id]:ids.filter(id=>id!==x.id))}/><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink/5 text-lg">{(x as {imageUrl?:string|null}).imageUrl?<img src={(x as {imageUrl?:string|null}).imageUrl!} alt="" className="size-full object-cover"/>:"🍽"}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{x.nameEn}</b><span className="block truncate text-xs text-muted">{catName(x.categoryId)} · {x.station}</span></span><span className="text-sm font-bold tabular-nums">₹{(x.pricePaise/100).toFixed(0)}</span></label></li>})}{pool.length===0&&<li className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">{q?"No dish matches your search.":"No dishes here."}</li>}</ul></Block>
  <Block title="2 · How much?"><div className="flex gap-2"><button type="button" aria-pressed={mode==="percent"} onClick={()=>setMode("percent")} className={chip(mode==="percent")}>By percent (%)</button><button type="button" aria-pressed={mode==="fixed"} onClick={()=>setMode("fixed")} className={chip(mode==="fixed")}>By rupees (₹)</button></div>
   <div className="flex items-center gap-2"><button type="button" aria-label="Decrease" className="grid size-11 place-items-center rounded-xl border border-line text-xl" onClick={()=>setAmount(String((Number(amount)||0)-1))}>−</button><Input aria-label="Amount" type="number" value={amount} onChange={e=>setAmount(e.target.value)} className="h-11 w-28 rounded-xl text-center text-lg font-bold"/><button type="button" aria-label="Increase" className="grid size-11 place-items-center rounded-xl border border-line text-xl" onClick={()=>setAmount(String((Number(amount)||0)+1))}>+</button><span className="text-sm text-muted">{mode==="percent"?"%":"₹"} {Number(amount)>=0?"increase":"decrease"}</span></div><p className={hint}>Use a minus number to lower prices. Prices are rounded to whole rupees.</p></Block>
  <Block title="3 · Preview">{changes.length===0?<p className="text-sm text-muted">Pick at least one dish to see the new prices.</p>:<ul className="divide-y divide-line rounded-xl border border-line">{changes.map(c=><li key={c.x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="truncate font-semibold">{c.x.nameEn}</span><span className="tabular-nums"><span className="text-muted line-through">₹{(c.x.pricePaise/100).toFixed(0)}</span> → <b>₹{(c.after/100).toFixed(0)}</b></span></li>)}</ul>}</Block>
  <div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button disabled={changes.length===0||!Number.isFinite(value)||value===0} className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50" onClick={()=>void actions.bulkPriceAction(ids,mode,value).then(r=>onDone(r.ok?"Prices updated.":r.error||"Failed"))}>Update {changes.length} {changes.length===1?"price":"prices"}</button></div>
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
    <button className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-brand bg-brand text-sm font-semibold text-white hover:bg-brand-strong" onClick={()=>void actions.saveCategoryAction({id:c.id,nameEn:form.nameEn,nameHi:form.nameHi,availableFrom:form.availableFrom||null,availableTo:form.availableTo||null}).then(r=>{setEditing(null);onDone(r.ok?"Category saved.":r.error||"Failed")})}>Save category</button></div>}
  </li>)}</ul>

  {adding?<form className="space-y-3 rounded-2xl border border-line bg-surface p-3" onSubmit={async e=>{e.preventDefault();const r=await actions.saveCategoryAction({nameEn:newName.trim(),nameHi:newHi.trim()||undefined});setNewName("");setNewHi("");setAdding(false);onDone(r.ok?"Category added.":r.error||"Failed")}}>
   <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="cn" className={lab}>Category name</Label><Input id="cn" autoFocus required className={`mt-1 ${inp}`} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Starters"/></div><div><Label htmlFor="ch" className={lab}>Hindi name <span className="font-normal text-muted">(optional)</span></Label><Input id="ch" className={`mt-1 ${inp}`} value={newHi} onChange={e=>setNewHi(e.target.value)}/></div></div>
   <div className="flex gap-2"><button type="button" className="min-h-11 flex-1 rounded-xl border border-line text-sm font-semibold" onClick={()=>setAdding(false)}>Cancel</button><button disabled={!newName.trim()} className="min-h-11 flex-1 rounded-xl border border-brand bg-brand text-sm font-semibold text-white disabled:opacity-50">Add category</button></div></form>
  :<button type="button" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:border-ink/40 hover:text-ink" onClick={()=>setAdding(true)}><span className="text-lg leading-none">+</span> Add a category</button>}

  {dirty&&<div className="sticky bottom-0 -mx-4 border-t border-line bg-background/95 px-4 py-3 backdrop-blur"><button className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand bg-brand text-base font-semibold text-white hover:bg-brand-strong" onClick={()=>void actions.reorderAction(ids).then(r=>onDone(r.ok?"New order saved.":r.error||"Failed"))}>Save the new order</button></div>}
 </div>}
