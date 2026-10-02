import { notFound } from "next/navigation";
import { WaiterScreen } from "@/app/(staff)/waiter/_components/waiter-screen";
import { cases, fixture } from "./_fixtures";
export const dynamic="force-dynamic";
export const metadata={title:"S3 · Waiter review",robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(process.env.NODE_ENV==="production")notFound();const q=await searchParams;const id=String(q.solo??"");
 if(!cases.some(c=>c===id))return <main className="mx-auto max-w-3xl p-6"><h1 className="text-3xl font-bold">S3 · Waiter phone</h1><p className="my-4">Review fixtures · one state per route · no real mutations</p><ol className="grid list-decimal gap-3 pl-6 sm:grid-cols-2">{cases.map(id=><li key={id}><a className="inline-flex min-h-11 items-center underline" href={`?solo=${id}`}>{id.replaceAll("-"," ")}</a></li>)}</ol></main>;
 if(id==="denied")return <main className="p-6"><h1>Permission denied</h1><p>Your role cannot use the waiter app for this outlet.</p></main>;
 return <div style={id==="320"?{maxWidth:320,margin:"auto"}:id==="390"?{maxWidth:390,margin:"auto"}:undefined}>{id==="200-text"&&<style>{`html { font-size: 200%; }`}</style>}<WaiterScreen {...fixture(id)}/></div>;
}
