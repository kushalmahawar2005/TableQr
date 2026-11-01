import { notFound } from "next/navigation";
import { Board } from "./board";

export const dynamic = "force-dynamic";

export default async function GuestOrdersBoard(props: { searchParams: Promise<{ v?: string; dark?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { v = "orders", dark } = await props.searchParams;
  return <Board view={v} dark={dark === "1"} />;
}
