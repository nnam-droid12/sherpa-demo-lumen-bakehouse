import { NextResponse } from "next/server";
import { products } from "@/lib/products";
import { getOrigin } from "@/lib/merchant-cart";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = getOrigin(req);

  const items = products.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    price: {
      currency_code: "USD",
      value: p.price,
    },
    availability: p.leadTimeDays > 0 ? "preorder" : "in_stock",
    image_url: `${origin}${p.image.startsWith("/") ? "" : "/"}${p.image}`,
    url: `${origin}/cakes/${p.id}`,
    variants: [],
    serves: p.serves,
    lead_time: p.leadTimeDays,
    lead_time_days: p.leadTimeDays,
    leadTimeDays: p.leadTimeDays,
    rating: p.rating,
    reviews: p.reviews,
    flavours: p.flavours,
    ...(p.badge ? { badge: p.badge } : {}),
  }));

  return NextResponse.json({ items }, { status: 200 });
}
