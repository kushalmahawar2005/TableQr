export const LIVE_GUEST_DEMO = "/r/SRJ01/t/HhK8";

export const DEMO_CONTACT =
  "https://wa.me/916367828788?text=Hi%20Craftory%20Innovation%2C%20I%27d%20like%20a%20Tableeqr%20product%20demo.";

export const DEMO_SURFACES = [
  {
    slug: "admin",
    title: "Owner / Admin",
    shortTitle: "Owner dashboard",
    description: "See sales, orders and outlet activity together.",
    image: "/demo/owner-dashboard.png",
    alt: "Tableeqr owner dashboard preview with sales and live operations",
    shape: "wide",
  },
  {
    slug: "pos",
    title: "Cashier / POS",
    shortTitle: "POS and billing",
    description: "Build an order, manage the cart and take payment.",
    image: "/demo/cashier-pos.png",
    alt: "Tableeqr point of sale and billing preview",
    shape: "wide",
  },
  {
    slug: "kitchen",
    title: "Kitchen display",
    shortTitle: "Kitchen display",
    description: "Follow new, preparing and ready kitchen tickets.",
    image: "/demo/kitchen-display.png",
    alt: "Tableeqr kitchen display preview with order columns",
    shape: "wide",
  },
  {
    slug: "waiter",
    title: "Waiter app",
    shortTitle: "Waiter orders",
    description: "See table orders, ready alerts and guest requests.",
    image: "/demo/waiter-orders.png",
    alt: "Tableeqr waiter app preview showing table orders",
    shape: "phone",
  },
  {
    slug: "rider",
    title: "Rider app",
    shortTitle: "Rider delivery",
    description: "Review a delivery request, route and earnings at a glance.",
    image: "/demo/rider-delivery-request.png",
    alt: "Tableeqr rider app preview showing a delivery request",
    shape: "phone",
  },
] as const;

export type DemoSurface = (typeof DEMO_SURFACES)[number];
