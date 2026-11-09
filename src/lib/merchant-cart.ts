import { NextResponse } from "next/server";
import { findProduct } from "./products";
import { createMerchantCartOrder } from "./paypal";

export type CartItem = {
  item_id: string;
  quantity: number;
  name: string;
  price: {
    currency_code: string;
    value: string;
  };
  variant_id?: string | null;
};

export type ValidationIssue = {
  code: string;
  type: string;
  message: string;
  user_message?: string;
  field: string;
  context?: Record<string, any>;
  resolution_options?: Array<{ action: string; [key: string]: any }>;
};

export type CartTotals = {
  subtotal: { currency_code: string; value: string };
  shipping: { currency_code: string; value: string };
  tax: { currency_code: string; value: string };
  total: { currency_code: string; value: string };
};

export type Cart = {
  id: string;
  status: "CREATED" | "INCOMPLETE" | "COMPLETED";
  validation_status: "VALID" | "INVALID";
  validation_issues: ValidationIssue[];
  items: CartItem[];
  totals: CartTotals;
  customer?: any;
  shipping_address?: any;
  checkout_fields?: Array<{ type: string; value: string; [key: string]: any }>;
  payment_method: {
    type: string;
    token?: string;
  };
  payment_confirmation?: {
    merchant_order_number: string;
    order_review_page: string;
  };
};

const globalForCarts = globalThis as unknown as { merchantCarts: Map<string, Cart> };
export const carts: Map<string, Cart> = globalForCarts.merchantCarts || new Map<string, Cart>();
if (process.env.NODE_ENV !== "production") {
  globalForCarts.merchantCarts = carts;
}

export function getOrigin(req: Request): string {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (host) {
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

export function cartError(name: string, message: string, status: number, debug_id?: string) {
  return NextResponse.json(
    {
      name,
      message,
      debug_id: debug_id || crypto.randomUUID(),
    },
    { status }
  );
}

function parseDateOnly(str: string): number | null {
  if (!str) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str.trim());
  if (match) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const timestamp = Date.parse(str);
  if (!isNaN(timestamp)) {
    const d = new Date(timestamp);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return null;
}

export async function processCart(
  cartId: string,
  body: any,
  origin: string,
  isCreate: boolean
): Promise<Cart> {
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const validation_issues: ValidationIssue[] = [];
  const items: CartItem[] = [];
  let subtotalNum = 0;
  let maxLeadTime = 0;
  let hasPreorderItems = false;

  if (rawItems.length === 0) {
    validation_issues.push({
      code: "INVENTORY_ISSUE",
      type: "MISSING_FIELD",
      message: "Cart must contain at least one item.",
      user_message: "Your cart is empty.",
      field: "items",
      context: { specific_issue: "EMPTY_CART" },
    });
  }

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const itemId = String(raw?.item_id || "");
    const qty = Math.max(1, Math.floor(Number(raw?.quantity) || 1));
    const product = findProduct(itemId);

    if (!product) {
      validation_issues.push({
        code: "INVENTORY_ISSUE",
        type: "INVALID_DATA",
        message: `Item '${itemId}' not found in catalog.`,
        user_message: "One or more items in your cart is unavailable.",
        field: "items.item_id",
        context: { specific_issue: "UNKNOWN_ITEM_ID" },
        resolution_options: [{ action: "REMOVE_ITEM" }],
      });
      items.push({
        item_id: itemId,
        quantity: qty,
        name: raw?.name || "Unknown Item",
        price: { currency_code: "USD", value: "0.00" },
        ...(raw?.variant_id !== undefined ? { variant_id: raw.variant_id } : {}),
      });
    } else {
      const itemTotal = Number(product.price) * qty;
      subtotalNum += itemTotal;
      if (product.leadTimeDays > 0) {
        hasPreorderItems = true;
        if (product.leadTimeDays > maxLeadTime) {
          maxLeadTime = product.leadTimeDays;
        }
      }
      items.push({
        item_id: product.id,
        quantity: qty,
        name: product.title,
        price: { currency_code: "USD", value: product.price },
        ...(raw?.variant_id !== undefined ? { variant_id: raw.variant_id } : {}),
      });
    }
  }

  const shipping = body?.shipping_address;
  if (!shipping || typeof shipping !== "object" || !shipping.address_line_1) {
    validation_issues.push({
      code: "SHIPPING_ERROR",
      type: "MISSING_FIELD",
      message: "A shipping address is required.",
      user_message: "Please provide a shipping address.",
      field: "shipping_address",
      context: { specific_issue: "MISSING_SHIPPING_ADDRESS" },
      resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
    });
  }

  if (hasPreorderItems) {
    const fields = Array.isArray(body?.checkout_fields) ? body.checkout_fields : [];
    const deliveryField = fields.find(
      (f: any) => f && (f.type === "DELIVERY_DATE_PREFERENCE" || f.name === "DELIVERY_DATE_PREFERENCE")
    );

    if (
      !deliveryField ||
      !deliveryField.value ||
      typeof deliveryField.value !== "string" ||
      !deliveryField.value.trim()
    ) {
      validation_issues.push({
        code: "DATA_ERROR",
        type: "MISSING_FIELD",
        message: "A delivery date is required for preorder cakes.",
        user_message: "Which day should we deliver your cake?",
        field: "checkout_fields.DELIVERY_DATE_PREFERENCE",
        context: { specific_issue: "MISSING_CHECKOUT_FIELDS" },
        resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
      });
    } else {
      const targetUTC = parseDateOnly(deliveryField.value);
      const now = new Date();
      const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const minAllowedUTC = todayUTC + maxLeadTime * 24 * 60 * 60 * 1000;

      if (targetUTC === null || targetUTC < minAllowedUTC) {
        validation_issues.push({
          code: "DATA_ERROR",
          type: "MISSING_FIELD",
          message: `A delivery date at least ${maxLeadTime} day${maxLeadTime > 1 ? "s" : ""} in advance is required for preorder cakes.`,
          user_message: "Which day should we deliver your cake?",
          field: "checkout_fields.DELIVERY_DATE_PREFERENCE",
          context: { specific_issue: "MISSING_CHECKOUT_FIELDS" },
          resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
        });
      }
    }
  }

  const subtotalStr = subtotalNum.toFixed(2);
  const totals: CartTotals = {
    subtotal: { currency_code: "USD", value: subtotalStr },
    shipping: { currency_code: "USD", value: "0.00" },
    tax: { currency_code: "USD", value: "0.00" },
    total: { currency_code: "USD", value: subtotalStr },
  };

  const validation_status = validation_issues.length === 0 ? "VALID" : "INVALID";
  let status: "CREATED" | "INCOMPLETE" | "COMPLETED";
  if (isCreate) {
    status = "CREATED";
  } else {
    status = validation_status === "VALID" ? "CREATED" : "INCOMPLETE";
  }

  const payment_method: { type: string; token?: string } = {
    type: body?.payment_method?.type || "paypal",
  };

  if (items.length > 0 && subtotalNum > 0) {
    const orderRes = await createMerchantCartOrder(subtotalStr, origin);
    if (orderRes.status === 201 || orderRes.status === 200) {
      payment_method.token = orderRes.body.id;
    } else {
      console.error("Failed to create PayPal order for merchant cart:", orderRes);
    }
  }

  const cart: Cart = {
    id: cartId,
    status,
    validation_status,
    validation_issues,
    items,
    totals,
    ...(body?.customer ? { customer: body.customer } : {}),
    ...(body?.shipping_address ? { shipping_address: body.shipping_address } : {}),
    ...(body?.checkout_fields ? { checkout_fields: body.checkout_fields } : {}),
    payment_method,
  };

  carts.set(cartId, cart);
  return cart;
}
