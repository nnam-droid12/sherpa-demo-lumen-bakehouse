import { findProduct } from "./products";

const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";

export type CartLine = { id: string; qty: number };

const globalForPayPal = globalThis as unknown as { processedEvents: Set<string> };
if (!globalForPayPal.processedEvents) {
  globalForPayPal.processedEvents = new Set<string>();
}
export const processedEvents: Set<string> = globalForPayPal.processedEvents;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) {
    return cachedToken.token;
  }
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  const token = data.access_token as string;
  const expiresIn = Number(data.expires_in) || 3600;
  cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

export function priceCart(lines: CartLine[]) {
  let total = 0;
  for (const line of lines) {
    const product = findProduct(line.id);
    if (!product) throw new Error(`unknown product ${line.id}`);
    total += Number(product.price) * Math.max(1, Math.floor(line.qty));
  }
  return total.toFixed(2);
}

export async function createOrder(lines: CartLine[]) {
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
      purchase_units: [{ amount: { currency_code: "USD", value: priceCart(lines) } }],
    }),
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

export async function createMerchantCartOrder(total: string, origin: string) {
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
          amount: {
            currency_code: "USD",
            value: total,
          },
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

export async function getOrder(orderId: string) {
  const token = await accessToken();
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

export async function captureOrder(orderId: string, expectedAmount?: string) {
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
  const body = await res.json();
  const status = res.status;

  // Check for INSTRUMENT_DECLINED in details or root error
  const isDeclined =
    body.details?.some((d: any) => d.issue === "INSTRUMENT_DECLINED") ||
    body.name === "INSTRUMENT_DECLINED" ||
    body.issue === "INSTRUMENT_DECLINED";

  if (isDeclined) {
    return {
      status: 422,
      body: {
        error: "INSTRUMENT_DECLINED",
        issue: "INSTRUMENT_DECLINED",
        message: "Your payment method was declined. Please try another payment method.",
        details: body.details || [{ issue: "INSTRUMENT_DECLINED" }],
        ...body,
      },
    };
  }

  if (!res.ok) {
    return { status, body };
  }

  // Extract captured amount and capture status
  const captureItem = body.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedAmount = captureItem?.amount?.value;
  const captureStatus = captureItem?.status || body.status;

  // Verify captured amount matches
  let expected = expectedAmount;
  if (!expected) {
    try {
      const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        expected = orderData.purchase_units?.[0]?.amount?.value;
      }
    } catch {
      // ignore
    }
  }

  if (expected && capturedAmount && capturedAmount !== expected) {
    return {
      status: 400,
      body: {
        error: "AMOUNT_MISMATCH",
        message: `Captured amount (${capturedAmount}) does not match expected amount (${expected})`,
      },
    };
  }

  // Check if capture status is PENDING
  if (captureStatus === "PENDING") {
    return {
      status: 200,
      body: {
        ...body,
        status: "PENDING",
        message: "Your payment is currently being reviewed. We will confirm your order once payment clears.",
      },
    };
  }

  return { status: 200, body };
}

export type WebhookVerificationParams = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  rawEventBody: string;
  event: any;
};

export async function verifyWebhookSignature(params: WebhookVerificationParams): Promise<boolean> {
  const token = await accessToken();

  let requestBody: string;
  try {
    const wrapper = {
      auth_algo: params.authAlgo,
      cert_url: params.certUrl,
      transmission_id: params.transmissionId,
      transmission_sig: params.transmissionSig,
      transmission_time: params.transmissionTime,
      webhook_id: params.webhookId,
    };
    const wrapperStr = JSON.stringify(wrapper);
    requestBody = wrapperStr.slice(0, -1) + ',"webhook_event":' + params.rawEventBody.trim() + "}";
  } catch {
    requestBody = JSON.stringify({
      auth_algo: params.authAlgo,
      cert_url: params.certUrl,
      transmission_id: params.transmissionId,
      transmission_sig: params.transmissionSig,
      transmission_time: params.transmissionTime,
      webhook_id: params.webhookId,
      webhook_event: params.event,
    });
  }

  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
    cache: "no-store",
  });

  if (!res.ok) {
    return false;
  }
  const data = await res.json();
  return data.verification_status === "SUCCESS";
}
