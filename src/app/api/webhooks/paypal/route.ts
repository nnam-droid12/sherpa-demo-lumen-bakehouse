import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/paypal";

export async function POST(req: Request) {
  const authAlgo = req.headers.get("paypal-auth-algo") || req.headers.get("PAYPAL-AUTH-ALGO");
  const certUrl = req.headers.get("paypal-cert-url") || req.headers.get("PAYPAL-CERT-URL");
  const transmissionId = req.headers.get("paypal-transmission-id") || req.headers.get("PAYPAL-TRANSMISSION-ID");
  const transmissionSig = req.headers.get("paypal-transmission-sig") || req.headers.get("PAYPAL-TRANSMISSION-SIG");
  const transmissionTime = req.headers.get("paypal-transmission-time") || req.headers.get("PAYPAL-TRANSMISSION-TIME");
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId || !authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return NextResponse.json(
      { error: "Missing required webhook verification headers or PAYPAL_WEBHOOK_ID" },
      { status: 400 }
    );
  }

  let event: any;
  try {
    const rawBody = await req.text();
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { valid } = await verifyWebhookSignature({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      webhookId,
      event,
    });

    if (!valid) {
      return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Verification error" }, { status: 400 });
  }

  // Handle required event types
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const captureId = event.resource?.id;
      const amount = event.resource?.amount?.value;
      console.log(`[Webhook] PAYMENT.CAPTURE.COMPLETED: id=${captureId}, amount=${amount}`);
      break;
    }
    case "PAYMENT.CAPTURE.DENIED": {
      const captureId = event.resource?.id;
      console.log(`[Webhook] PAYMENT.CAPTURE.DENIED: id=${captureId}`);
      break;
    }
    case "CHECKOUT.ORDER.APPROVED": {
      const orderId = event.resource?.id;
      console.log(`[Webhook] CHECKOUT.ORDER.APPROVED: id=${orderId}`);
      break;
    }
    default:
      console.log(`[Webhook] Unhandled event type: ${event.event_type}`);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
