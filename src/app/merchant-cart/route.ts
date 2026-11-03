import {
  createCart,
  createErrorResponse,
  getBaseOrigin,
} from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
    const cart = await createCart(body, origin);
    return Response.json(cart, { status: 201 });
  } catch (err: any) {
    console.error("Error creating merchant cart:", err);
    return createErrorResponse(
      "INTERNAL_SERVER_ERROR",
      err?.message || "Failed to create cart",
      500
    );
  }
}
