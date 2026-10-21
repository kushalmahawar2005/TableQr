export type FormCheckout = {
  provider: string;
  kind: "form";
  method: "GET" | "POST";
  action: string;
  fields: Record<string, string>;
};

export type CashfreeCheckout = {
  provider: "cashfree";
  kind: "cashfree";
  mode: "sandbox" | "production";
  paymentSessionId: string;
};

export type Checkout = FormCheckout | CashfreeCheckout;

type CashfreeResult = { error?: { message?: string }; redirect?: boolean; paymentDetails?: { paymentMessage?: string } };
type CashfreeSdk = { checkout(options: { paymentSessionId: string; redirectTarget: "_self" }): Promise<CashfreeResult> };

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => CashfreeSdk;
  }
}

let cashfreeScript: Promise<void> | null = null;

function loadCashfree() {
  if (window.Cashfree) return Promise.resolve();
  if (cashfreeScript) return cashfreeScript;
  cashfreeScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://sdk.cashfree.com/js/v3/cashfree.js"]');
    const script = existing ?? document.createElement("script");
    const loaded = () => window.Cashfree ? resolve() : reject(new Error("Cashfree checkout did not load"));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", () => reject(new Error("Cashfree checkout could not be loaded")), { once: true });
    if (!existing) {
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    cashfreeScript = null;
    throw error;
  });
  return cashfreeScript;
}

/** Opens a gateway-hosted checkout without exposing any server credential to the browser. */
export async function openCheckout(checkout: Checkout) {
  if (checkout.kind === "cashfree") {
    await loadCashfree();
    const cashfree = window.Cashfree?.({ mode: checkout.mode });
    if (!cashfree) throw new Error("Cashfree checkout is unavailable");
    const result = await cashfree.checkout({ paymentSessionId: checkout.paymentSessionId, redirectTarget: "_self" });
    if (result.error) throw new Error(result.error.message || "Cashfree checkout failed");
    return;
  }

  const form = document.createElement("form");
  form.method = checkout.method;
  form.action = checkout.action;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
