// Guest screens G3 can lead to. A destination is switched on only once it is built, so no
// control on the menu ever opens a missing page (G3 blocker decision 2).
export const BUILT = {
  /** G4 item sheet: row taps and "Choose" */
  itemSheet: true,
  /** G5 cart: "View cart" on the cart bar */
  cart: true,
} as const;
