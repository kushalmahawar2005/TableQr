import type { ComponentProps } from "react";
import type { WaiterBoard, WaiterDetail, WaiterMenu } from "@/server/staff/waiter-read";
import { WaiterScreen } from "@/app/(staff)/waiter/_components/waiter-screen";
type Props=ComponentProps<typeof WaiterScreen>;
export const cases=["normal-rush","no-tasks","new-water","waiting-3","escalated-5","oldest-first","completed","ready-food","ready-groups","my-tables","bill-requested","paid","needs-cleaning","combined","assignment-removed","table-picker","choose-diner","phoneless","menu","modifiers","draft","placed","sold-out","paused","order-blocked","move","move-blocked","request-bill","reopen-pin","cash","cash-change","card","void-placed","void-pin","wrong-pin","void-paid","large-first","offline","reconnecting","hindi","320","390","200-text","denied"] as const;
export function fixture(id:string):Props {
 const now=1791043200000;
 const table:WaiterBoard["tables"][number]={id:"t4",code:"T4",label:"T4",assigned:true,primary:true,state:"seated",sessionId:"visit",partySize:4,openedAt:now-35*60000,expectedEndAt:now+45*60000,orderingPaused:false,readyCount:3,requestCount:2,unpaidPaise:124000};
 const board:WaiterBoard={renderedAt:now,identity:{name:"Rahul Verma",roles:["waiter"],outlet:"Saffron · Rajouri Garden",duty:"on"},requests:[{id:"water",tableCode:"T2",kind:"water",createdAt:now-75000,escalated:false,escalatedAt:null},{id:"cutlery",tableCode:"T4",kind:"cutlery",createdAt:now-40000,escalated:false,escalatedAt:null}],ready:[{id:"ready",tableCode:"T4",roundNo:2,readyAt:now-90000,lines:[{id:"naan",qty:2,name:"Garlic Naan",nameHi:"गार्लिक नान"},{id:"paneer",qty:1,name:"Paneer Tikka",nameHi:"पनीर टिक्का"}]}],tables:[table,{...table,id:"t5",code:"T5",label:"T5 + T6",sessionId:"combined",partySize:6,requestCount:0,readyCount:0}],orderTables:[table]};
 const detail:WaiterDetail={sessionId:"visit",tableId:"t4",status:"open",orderingPaused:false,people:[{id:"aarav",name:"Aarav",paidOut:false},{id:"meera",name:"Meera",paidOut:false}],lines:[{id:"paneer",participantId:"aarav",name:"Paneer Tikka",nameHi:"पनीर टिक्का",qty:2,status:"placed",roundNo:1},{id:"naan",participantId:"meera",name:"Garlic Naan",nameHi:"गार्लिक नान",qty:2,status:"ready",roundNo:2}],requests:[{id:"water",kind:"water"}],shares:[{participantId:"aarav",amount:76000,paid:0,frozenAt:null},{participantId:"meera",amount:48000,paid:0,frozenAt:null}]};
 const menu:WaiterMenu=[{id:"paneer",name:"Paneer Tikka",nameHi:"पनीर टिक्का",pricing:{id:"paneer",pricePaise:32000,isAvailable:true,groups:[{id:"spice",nameEn:"Spice level",nameHi:"तीखापन",minSelect:1,maxSelect:1,modifiers:[{id:"mild",nameEn:"Mild",nameHi:"हल्का",priceDeltaPaise:0,isAvailable:true},{id:"hot",nameEn:"Hot",nameHi:"तीखा",priceDeltaPaise:0,isAvailable:true}]}]}},{id:"naan",name:"Garlic Naan",nameHi:"गार्लिक नान",pricing:{id:"naan",pricePaise:8000,isAvailable:true,groups:[]}},{id:"dal",name:"Dal Makhani",nameHi:"दाल मखनी",pricing:{id:"dal",pricePaise:26000,isAvailable:true,groups:[]}}];
 const p:Props={initial:board,preview:true,initialMenu:menu};
 if(id==="no-tasks"||id==="completed"){board.requests=[];board.ready=[];if(id==="completed")p.initialMessage="Request completed by another waiter. Your tasks are up to date.";}
 if(id==="new-water"){board.requests=board.requests.slice(0,1);board.requests[0].createdAt=now;p.initialMessage="New request · T2 needs water";}
 if(id==="waiting-3")board.requests[0].createdAt=now-210000;
 if(id==="escalated-5"||id==="oldest-first"){board.requests[0].createdAt=now-370000;board.requests[0].escalated=true;}
 if(id==="ready-food")board.requests=[];
 if(id==="ready-groups")board.ready.push({...board.ready[0],id:"second",tableCode:"T7",roundNo:1,readyAt:now-180000});
 if(["my-tables","bill-requested","paid","needs-cleaning","combined","assignment-removed"].includes(id)){p.initialTab="tables";if(id==="assignment-removed")board.tables=[];if(id==="bill-requested")board.tables[0].state="bill_requested";if(id==="paid")board.tables[0].state="paid";if(id==="needs-cleaning"){board.tables[0].state="needs_cleaning";board.tables[0].sessionId=null;}}
 const orderStates=["table-picker","choose-diner","phoneless","menu","modifiers","draft","placed","sold-out","paused","order-blocked","large-first"];
 if(orderStates.includes(id)){p.initialTab="order";if(id!=="table-picker")p.initialDetail=detail;}
 if(id==="phoneless")detail.people.push({id:"guest3",name:"Guest 3",paidOut:false});
 if(["menu","modifiers","sold-out","paused","large-first"].includes(id))p.initialStage="menu";
 if(id==="modifiers")p.initialItem=menu[0];
 if(id==="sold-out"){menu[0].pricing.isAvailable=false;p.initialMessage="Paneer Tikka just sold out. Nothing was ordered. Update your draft.";}
 if(id==="draft"){p.initialStage="cart";p.initialDraft=[{itemId:"paneer",qty:2,modifierIds:["mild"],note:"No onion",name:"Paneer Tikka",paise:64000},{itemId:"naan",qty:2,modifierIds:[],note:"",name:"Garlic Naan",paise:16000}];}
 if(id==="placed")p.initialMessage="Round 3 placed · sent to the kitchen";
 if(id==="paused")detail.orderingPaused=true;
 if(id==="order-blocked")detail.status="bill_requested";
 if(id==="large-first")p.initialMessage="Staff-assisted first order · guest cap bypass is audited";
 if(["move","move-blocked","request-bill","reopen-pin","cash","cash-change","card","void-placed","void-pin","wrong-pin","void-paid"].includes(id)){p.initialTab="tables";p.initialDetail=detail;}
 if(id==="move"||id==="move-blocked")p.initialSheet={kind:"move",lineId:"paneer"};
 if(id==="move-blocked")p.initialMessage="A paid or frozen share cannot be moved.";
 if(id==="reopen-pin"){detail.status="bill_requested";p.initialSheet={kind:"reopen"};}
 if(["cash","cash-change","card"].includes(id)){detail.status="bill_requested";p.initialSheet={kind:"settle"};}
 if(id==="cash-change")p.initialMessage="Cash ₹1,500 · bill ₹1,240 · change ₹260";
 if(["void-placed","void-pin","wrong-pin","void-paid"].includes(id))p.initialSheet={kind:"void",lineId:"paneer",status:id==="void-placed"?"placed":"accepted"};
 if(id==="wrong-pin")p.initialMessage="Phone number or PIN is not right.";
 if(id==="void-paid")p.initialMessage="Manager action required";
 if(id==="offline")p.initialOffline=true;
 if(id==="reconnecting")p.initialConnection="connecting";
 if(id==="hindi")p.initialLanguage="hi";
 return p;
}
