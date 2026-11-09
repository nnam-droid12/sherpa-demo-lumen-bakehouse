import { CartView } from "@/components/cart-view";

export const dynamic = "force-dynamic";

export default function CartPage() {
  return <CartView clientId={process.env.PAYPAL_CLIENT_ID || "sb"} />;
}
