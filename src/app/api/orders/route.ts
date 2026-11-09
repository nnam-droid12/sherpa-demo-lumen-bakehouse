import { NextResponse } from "next/server";
import { type CartLine, createOrder } from "@/lib/paypal";

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const items = data.items as CartLine[];
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "cart is empty" }, { status: 400 });
    }
    // Only use product ids and quantities, completely ignoring any price or total sent by the browser
    const sanitizedItems: CartLine[] = items.map((i) => ({
      id: String(i.id),
      qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
    }));
    const { status, body } = await createOrder(sanitizedItems);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create order" }, { status: 400 });
  }
}
