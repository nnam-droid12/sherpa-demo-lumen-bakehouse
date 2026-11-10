import { NextResponse } from "next/server";
import { cartError, getOrigin, processCart } from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return cartError("INVALID_REQUEST", "Invalid JSON body", 400);
  }

  if (body && typeof body !== "object") {
    return cartError("INVALID_REQUEST", "Request body must be an object", 400);
  }

  const origin = getOrigin(req);
  const cartId = "cart_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);

  try {
    const cart = await processCart(cartId, body, origin, true);
    return NextResponse.json(cart, { status: 201 });
  } catch (err: any) {
    console.error("Error creating merchant cart:", err);
    return cartError("INTERNAL_SERVER_ERROR", err?.message || "Failed to create cart", 500);
  }
}
