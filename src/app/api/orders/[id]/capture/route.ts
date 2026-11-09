import { NextResponse } from "next/server";
import { captureOrder, priceCart, type CartLine } from "@/lib/paypal";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let expectedAmount: string | undefined;

  try {
    const text = await req.text();
    if (text) {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        const sanitized: CartLine[] = parsed.items.map((i: any) => ({
          id: String(i.id),
          qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
        }));
        expectedAmount = priceCart(sanitized);
      }
    }
  } catch {
    // ignore
  }

  const { status, body } = await captureOrder(id, expectedAmount);
  return NextResponse.json(body, { status });
}
