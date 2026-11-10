import { NextResponse } from "next/server";
import { carts, cartError, getOrigin, processCart } from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cartId = decodeURIComponent(id);
  const cart = carts.get(id) || carts.get(cartId);
  if (!cart) {
    return cartError("CART_NOT_FOUND", `Cart '${id}' not found`, 404);
  }
  return NextResponse.json(cart, { status: 200 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cartId = decodeURIComponent(id);
  const existing = carts.get(id) || carts.get(cartId);
  if (!existing) {
    return cartError("CART_NOT_FOUND", `Cart '${id}' not found`, 404);
  }

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

  try {
    const updated = await processCart(existing.id, body, origin, false);
    return NextResponse.json(updated, { status: 200 });
  } catch (err: any) {
    console.error(`Error updating merchant cart '${id}':`, err);
    return cartError("INTERNAL_SERVER_ERROR", err?.message || "Failed to update cart", 500);
  }
}
