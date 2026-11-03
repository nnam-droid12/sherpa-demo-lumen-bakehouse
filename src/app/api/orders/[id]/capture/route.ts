import { NextResponse } from "next/server";
import { captureOrder } from "@/lib/paypal";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let items;
  try {
    const body = await req.json();
    items = body?.items;
  } catch {
    // Body is optional
  }
  const { status, body } = await captureOrder(id, items);
  return NextResponse.json(body, { status });
}
