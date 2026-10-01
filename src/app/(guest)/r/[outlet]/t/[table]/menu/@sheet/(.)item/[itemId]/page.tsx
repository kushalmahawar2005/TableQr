import { ItemSheetPage } from "../../../_g4/item-sheet-page";

// G4 opened from the menu: shown over it, closed with Back
export default function InterceptedItemSheet(props: PageProps<"/r/[outlet]/t/[table]/menu/item/[itemId]">) {
  return <ItemSheetPage params={props.params} mode="sheet" />;
}
