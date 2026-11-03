import {
  cartStore,
  createErrorResponse,
  getBaseOrigin,
  updateCart,
} from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cart = cartStore.get(id);

  if (!cart) {
    return createErrorResponse(
      "CART_NOT_FOUND",
      `Cart '${id}' not found`,
      404
    );
  }

  return Response.json(cart, { status: 200 });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!cartStore.has(id)) {
    return createErrorResponse(
      "CART_NOT_FOUND",
      `Cart '${id}' not found`,
      404
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return createErrorResponse("INVALID_REQUEST", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object") {
    return createErrorResponse(
      "INVALID_REQUEST",
      "Request body must be a JSON object",
      400
    );
  }

  try {
    const origin = getBaseOrigin(req);
    const updatedCart = await updateCart(id, body, origin);

    if (!updatedCart) {
      return createErrorResponse(
        "CART_NOT_FOUND",
        `Cart '${id}' not found`,
        404
      );
    }

    return Response.json(updatedCart, { status: 200 });
  } catch (err: any) {
    console.error(`Error updating merchant cart '${id}':`, err);
    return createErrorResponse(
      "INTERNAL_SERVER_ERROR",
      err?.message || "Failed to update cart",
      500
    );
  }
}
