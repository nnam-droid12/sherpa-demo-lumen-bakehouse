import { NextResponse } from "next/server";
import { processedEvents, verifyWebhookSignature } from "@/lib/paypal";

export async function POST(req: Request) {
  const rawBody = await req.text();
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!event || !event.id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  // Deduplicate webhooks: return 200 if already processed
  if (processedEvents.has(event.id)) {
    return NextResponse.json({ status: "already processed" }, { status: 200 });
  }

  // Verify headers
  const authAlgo = req.headers.get("paypal-auth-algo");
  const certUrl = req.headers.get("paypal-cert-url");
  const transmissionId = req.headers.get("paypal-transmission-id");
  const transmissionSig = req.headers.get("paypal-transmission-sig");
  const transmissionTime = req.headers.get("paypal-transmission-time");
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime || !webhookId) {
    return NextResponse.json(
      { error: "Missing required PayPal signature headers or PAYPAL_WEBHOOK_ID" },
      { status: 400 }
    );
  }

  const isValid = await verifyWebhookSignature({
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime,
    webhookId,
    rawEventBody: rawBody,
    event,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
  }

  // Mark event as processed
  processedEvents.add(event.id);

  // Handle specific event types
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const capture = event.resource;
      console.log(`[Webhook] PAYMENT.CAPTURE.COMPLETED: captureId=${capture?.id}, orderId=${capture?.custom_id || capture?.supplementary_data?.related_ids?.order_id}`);
      break;
    }
    case "PAYMENT.CAPTURE.DENIED": {
      const capture = event.resource;
      console.log(`[Webhook] PAYMENT.CAPTURE.DENIED: captureId=${capture?.id}`);
      break;
    }
    case "CHECKOUT.ORDER.APPROVED": {
      const order = event.resource;
      console.log(`[Webhook] CHECKOUT.ORDER.APPROVED: orderId=${order?.id}`);
      break;
    }
    default:
      console.log(`[Webhook] Unhandled event type: ${event.event_type}`);
      break;
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
