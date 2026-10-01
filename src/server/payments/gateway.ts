import "server-only";
import { uuidv7 } from "@/db/id";

// Payment gateway boundary (PS 6.4). Each restaurant connects its own gateway account and money
// settles straight to them; TableQR never holds guest funds or sees card numbers. The real
// adapter (for example Razorpay) implements this interface with the outlet's own keys.

export type GatewayStatus = "pending" | "success" | "failed";

export type GatewayOrder = {
  gatewayRef: string;
  /** What the phone needs to open the gateway's hosted checkout or UPI intent */
  checkout: { provider: string; orderRef: string; amountPaise: number };
};

export interface PaymentGateway {
  readonly name: string;
  createOrder(input: { paymentId: string; amountPaise: number; receipt: string }): Promise<GatewayOrder>;
  fetchStatus(gatewayRef: string): Promise<{ status: GatewayStatus; amountPaise: number }>;
}

/** Development and test gateway: orders stay pending until settled by hand */
class MockGateway implements PaymentGateway {
  readonly name = "mock";
  private orders = new Map<string, { status: GatewayStatus; amountPaise: number }>();

  async createOrder(input: { paymentId: string; amountPaise: number }) {
    const gatewayRef = `mock_${uuidv7()}`;
    this.orders.set(gatewayRef, { status: "pending", amountPaise: input.amountPaise });
    return { gatewayRef, checkout: { provider: this.name, orderRef: gatewayRef, amountPaise: input.amountPaise } };
  }

  async fetchStatus(gatewayRef: string) {
    return this.orders.get(gatewayRef) ?? { status: "failed" as const, amountPaise: 0 };
  }

  /** Simulates the guest finishing or abandoning checkout */
  settle(gatewayRef: string, status: GatewayStatus) {
    const order = this.orders.get(gatewayRef);
    if (order) order.status = status;
  }
}

export const mockGateway = new MockGateway();

/** The gateway in use. The real adapter will take the outlet id and load that outlet's own keys. */
export function gatewayFor(): PaymentGateway {
  return mockGateway;
}
