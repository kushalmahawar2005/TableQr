/** Delivery configuration is per outlet. Money is always stored as integer paise. */
export type DeliveryPolicy = {
  acceptingOrders: boolean;
  pincodes: string[];
  minimumOrderPaise: number;
  deliveryFeePaise: number;
  freeDeliveryAbovePaise: number | null;
  estimatedMinutes: number;
  paymentMode: "gateway" | "manual_qr" | "cod";
};

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = {
  acceptingOrders: false, pincodes: [], minimumOrderPaise: 0, deliveryFeePaise: 0,
  freeDeliveryAbovePaise: null, estimatedMinutes: 45, paymentMode: "cod",
};

/** Strict on writes: malformed configuration must never turn into free or unrestricted delivery. */
export function validateDeliveryPolicy(raw: unknown): DeliveryPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Choose valid delivery settings.");
  const value = raw as Record<string, unknown>;
  if (typeof value.acceptingOrders !== "boolean") throw new Error("Choose whether delivery orders are accepted.");
  if (!Array.isArray(value.pincodes) || value.pincodes.length > 100 || value.pincodes.some(code => typeof code !== "string" || !/^[1-9]\d{5}$/.test(code))) throw new Error("Enter up to 100 valid six-digit delivery pincodes.");
  const pincodes = [...new Set(value.pincodes as string[])].sort();
  if (value.acceptingOrders && !pincodes.length) throw new Error("Add at least one delivery pincode before accepting orders.");
  const money = (key: string): number => {
    const amount = value[key];
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000) throw new Error("Delivery amounts must be between ₹0 and ₹1,00,000, with at most two decimal places.");
    return amount;
  };
  const minimumOrderPaise = money("minimumOrderPaise");
  const deliveryFeePaise = money("deliveryFeePaise");
  const freeDeliveryAbovePaise = value.freeDeliveryAbovePaise === null ? null : money("freeDeliveryAbovePaise");
  if (typeof value.estimatedMinutes !== "number" || !Number.isInteger(value.estimatedMinutes) || value.estimatedMinutes < 10 || value.estimatedMinutes > 240) throw new Error("Estimated delivery time must be between 10 and 240 minutes.");
  if (typeof value.paymentMode !== "string" || !["gateway", "manual_qr", "cod"].includes(value.paymentMode)) throw new Error("Choose a valid delivery payment method.");
  return { acceptingOrders: value.acceptingOrders, pincodes, minimumOrderPaise, deliveryFeePaise, freeDeliveryAbovePaise, estimatedMinutes: value.estimatedMinutes, paymentMode: value.paymentMode as DeliveryPolicy["paymentMode"] };
}

/** Missing or damaged stored configuration fails closed. */
export function readDeliveryPolicy(raw: unknown): DeliveryPolicy {
  try { return validateDeliveryPolicy(raw); }
  catch { return { ...DEFAULT_DELIVERY_POLICY, pincodes: [] }; }
}

/** Call only with the food subtotal priced by the server; excludes delivery fees and tips. */
export function deliveryQuote(policy: DeliveryPolicy, pincode: string, foodSubtotalPaise: number) {
  if (!Number.isSafeInteger(foodSubtotalPaise) || foodSubtotalPaise < 0) throw new Error("Invalid food subtotal.");
  if (!policy.acceptingOrders) throw new Error("Delivery is paused at this restaurant.");
  if (!policy.pincodes.includes(pincode)) throw new Error("This restaurant does not deliver to this pincode.");
  if (foodSubtotalPaise < policy.minimumOrderPaise) throw new Error(`Minimum food order is ₹${(policy.minimumOrderPaise / 100).toFixed(2)}.`);
  const feePaise = policy.freeDeliveryAbovePaise !== null && foodSubtotalPaise >= policy.freeDeliveryAbovePaise ? 0 : policy.deliveryFeePaise;
  return { feePaise, estimatedMinutes: policy.estimatedMinutes, paymentMode: policy.paymentMode };
}
