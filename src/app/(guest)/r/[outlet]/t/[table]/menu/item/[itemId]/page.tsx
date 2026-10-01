import type { Metadata } from "next";
import { ItemSheetPage } from "../../_g4/item-sheet-page";

export const metadata: Metadata = { title: "Dish", robots: { index: false, follow: false } };

// G4 opened directly (a link or a reload): the same sheet, closing goes to the menu
export default function ItemSheetRoute(props: PageProps<"/r/[outlet]/t/[table]/menu/item/[itemId]">) {
  return <ItemSheetPage params={props.params} mode="page" />;
}
