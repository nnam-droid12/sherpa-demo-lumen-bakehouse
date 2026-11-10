import { NextResponse } from "next/server";
import { carts, cartError, getOrigin } from "@/lib/merchant-cart";
import { getOrder, captureOrder } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cartId = decodeURIComponent(id);
  const cart = carts.get(id) || carts.get(cartId);
  if (!cart) {
    return cartError("CART_NOT_FOUND", `Cart '${id}' not found`, 404);
  }

  // If validation_status is INVALID return 200 with the cart and its issues
  if (cart.validation_status === "INVALID") {
    return NextResponse.json(cart, { status: 200 });
  }

  // If already completed, return 200 with the cart
  if (cart.status === "COMPLETED") {
    return NextResponse.json(cart, { status: 200 });
  }

  const token = cart.payment_method?.token;
  if (!token) {
    return cartError("UNPROCESSABLE_ENTITY", "Cart has no PayPal payment token", 422);
  }

  try {
    // Fetch PayPal order
    const { status: orderStatus, body: orderBody } = await getOrder(token);
    if (orderStatus !== 200) {
      return cartError(
        "UNPROCESSABLE_ENTITY",
        "Unable to retrieve PayPal order",
        422,
        orderBody?.debug_id
      );
    }

    // Verify buyer approval
    if (orderBody.status !== "APPROVED") {
      return cartError(
        "UNPROCESSABLE_ENTITY",
        "The buyer must approve the PayPal payment first before checkout can be completed.",
        422,
        orderBody?.debug_id
      );
    }

    // Capture PayPal order and verify amount
    const { status: captureStatus, body: captureBody } = await captureOrder(token, cart.totals.total.value);
    if (captureStatus !== 200) {
      return cartError(
        "UNPROCESSABLE_ENTITY",
        captureBody?.message || "Failed to capture PayPal payment",
        422,
        captureBody?.debug_id
      );
    }

    const captureItem = captureBody.purchase_units?.[0]?.payments?.captures?.[0];
    const capturedAmount = captureItem?.amount?.value;
    if (capturedAmount && capturedAmount !== cart.totals.total.value) {
      return cartError(
        "UNPROCESSABLE_ENTITY",
        `Captured amount (${capturedAmount}) does not match cart total (${cart.totals.total.value})`,
        422
      );
    }

    cart.status = "COMPLETED";
    const origin = getOrigin(req);
    cart.payment_confirmation = {
      merchant_order_number: `LB-${cart.id.replace(/^cart_/, "")}-${Date.now().toString(36).toUpperCase()}`,
      order_review_page: `${origin}/thank-you?order=${encodeURIComponent(token)}`,
    };
    carts.set(cart.id, cart);

    return NextResponse.json(cart, { status: 200 });
  } catch (err: any) {
    console.error(`Error completing checkout for cart '${id}':`, err);
    return cartError("INTERNAL_SERVER_ERROR", err?.message || "Failed to complete checkout", 500);
  }
}
