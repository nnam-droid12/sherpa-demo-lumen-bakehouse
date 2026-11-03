import { products } from "@/lib/products";
import { getBaseOrigin } from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = getBaseOrigin(req);
  const items = products.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    price: {
      currency_code: "USD",
      value: p.price,
    },
    availability: p.leadTimeDays > 0 ? "preorder" : "in_stock",
    image_url: `${origin}${p.image}`,
    url: `${origin}/cakes/${p.id}`,
    variants: [],
    serves: p.serves,
    lead_time_days: p.leadTimeDays,
    leadTimeDays: p.leadTimeDays,
    rating: p.rating,
    reviews: p.reviews,
    badge: p.badge ?? null,
    flavours: p.flavours,
  }));

  return Response.json(
    { items },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    }
  );
}
