import {
  checkoutCart,
  createErrorResponse,
  getBaseOrigin,
} from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const origin = getBaseOrigin(req);
    const { status, body } = await checkoutCart(id, origin);
    return Response.json(body, { status });
  } catch (err: any) {
    console.error(`Error checking out merchant cart '${id}':`, err);
    return createErrorResponse(
      "INTERNAL_SERVER_ERROR",
      err?.message || "Failed to complete checkout",
      500
    );
  }
}
