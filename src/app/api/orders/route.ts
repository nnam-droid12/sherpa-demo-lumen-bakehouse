import { NextResponse } from "next/server";
import { type CartLine, createOrder } from "@/lib/paypal";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { items } = body as { items: CartLine[] };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "cart is empty" }, { status: 400 });
    }
    // Compute order amount strictly on server from product catalog.
    // Never trust a total sent by the browser.
    const sanitizedItems: CartLine[] = items.map((i) => ({
      id: String(i.id),
      qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
    }));
    const { status, body: orderBody } = await createOrder(sanitizedItems);
    return NextResponse.json(orderBody, { status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create order" }, { status: 400 });
  }
}
