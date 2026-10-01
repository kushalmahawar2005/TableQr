// The menu (G3) with a slot above it for the item sheet (G4). Opening a dish from the menu is
// intercepted into the slot, so the menu stays mounted underneath with its scroll and filters.
export default function MenuLayout({ children, sheet }: LayoutProps<"/r/[outlet]/t/[table]/menu">) {
  return (
    <>
      {children}
      {sheet}
    </>
  );
}
