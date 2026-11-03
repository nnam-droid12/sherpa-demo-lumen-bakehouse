import { findProduct } from "./products";

const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";

export type CartLine = { id: string; qty: number };

export async function accessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  return (await res.json()).access_token as string;
}

export function priceCart(lines: CartLine[]) {
  let total = 0;
  for (const line of lines) {
    const product = findProduct(line.id);
    if (!product) throw new Error(`unknown product ${line.id}`);
    const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    total += Number(product.price) * qty;
  }
  return total.toFixed(2);
}

export async function createOrder(lines: CartLine[]) {
  const token = await accessToken();
  const amount = priceCart(lines);
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: amount },
          custom_id: amount,
        },
      ],
    }),
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

export async function captureOrder(orderId: string, clientItems?: CartLine[]) {
  const token = await accessToken();

  // 1. Fetch order details from PayPal to check authorized/expected amount
  const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!orderRes.ok) {
    return { status: orderRes.status, body: await orderRes.json() };
  }

  const orderData = await orderRes.json();
  const expectedAmount =
    orderData.purchase_units?.[0]?.amount?.value ||
    orderData.purchase_units?.[0]?.custom_id;

  // Verify against catalog if clientItems were provided
  if (Array.isArray(clientItems) && clientItems.length > 0) {
    const catalogAmount = priceCart(clientItems);
    if (catalogAmount !== expectedAmount) {
      return {
        status: 400,
        body: { error: "Order amount mismatch with catalog" },
      };
    }
  }

  // 2. Capture the order
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    cache: "no-store",
  });

  const captureBody = await res.json();

  if (res.ok) {
    // 3. Verify captured amount matches
    const capturedAmount =
      captureBody.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;

    if (capturedAmount && expectedAmount && capturedAmount !== expectedAmount) {
      return {
        status: 422,
        body: {
          error: "Captured amount does not match expected amount",
          expected: expectedAmount,
          captured: capturedAmount,
        },
      };
    }
  }

  return { status: res.status, body: captureBody };
}

export async function verifyWebhookSignature({
  authAlgo,
  certUrl,
  transmissionId,
  transmissionSig,
  transmissionTime,
  webhookId,
  event,
}: {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  event: any;
}) {
  const token = await accessToken();
  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: event,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    return { status: res.status, valid: false };
  }

  const data = await res.json();
  return { status: res.status, valid: data.verification_status === "SUCCESS" };
}

export async function createPayPalOrderForCart({
  total,
  origin,
  cartId,
}: {
  total: string;
  origin: string;
  cartId: string;
}) {
  const token = await accessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: total },
          custom_id: total,
          description: `Lumen Bakehouse Cart ${cartId}`,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: `${origin}/thank-you`,
            cancel_url: `${origin}/cart`,
            user_action: "PAY_NOW",
          },
        },
      },
    }),
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

export async function getPayPalOrder(orderId: string) {
  const token = await accessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

export async function capturePayPalOrder(orderId: string) {
  const token = await accessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

