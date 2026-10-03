import { redirect } from "next/navigation";
import { getReservationCalendar } from "@/server/staff/reservations";
import { currentStaff } from "@/server/staff/request";
import { ReservationCalendar } from "./_components/reservation-calendar";
import { ReservationCompanion } from "./_components/companion";
export default async function ReservationsPage(){const staff=await currentStaff();if(!staff)redirect("/console/login");const data=await getReservationCalendar(staff);return <><ReservationCalendar initial={data} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/,"ws")??null}/><div className="px-5 pb-5"><ReservationCompanion data={data}/></div></>}
