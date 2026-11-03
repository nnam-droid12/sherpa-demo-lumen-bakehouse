import { findProduct } from "./products";
import {
  createPayPalOrderForCart,
  getPayPalOrder,
  capturePayPalOrder,
} from "./paypal";

export type CartIssueCode =
  | "INVENTORY_ISSUE"
  | "PRICING_ERROR"
  | "SHIPPING_ERROR"
  | "DATA_ERROR"
  | "BUSINESS_RULE_ERROR"
  | "PAYMENT_ERROR";

export type CartIssueType =
  | "MISSING_FIELD"
  | "INVALID_DATA"
  | "BUSINESS_RULE"
  | "SYSTEM_ERROR";

export type ValidationIssue = {
  code: CartIssueCode;
  type: CartIssueType;
  message: string;
  user_message?: string;
  field?: string;
  context?: Record<string, any>;
  resolution_options?: Array<{ action: string }>;
};

export type CartItemInput = {
  item_id: string;
  variant_id?: string | null;
  quantity: number;
  [key: string]: any;
};

export type CartItemOutput = {
  item_id: string;
  quantity: number;
  name: string;
  price: {
    currency_code: string;
    value: string;
  };
  variant_id?: string | null;
  [key: string]: any;
};

export type CartCustomer = {
  email_address?: string;
  name?: {
    given_name?: string;
    surname?: string;
  };
  phone?: {
    phone_number?: {
      national_number?: string;
    };
  };
  [key: string]: any;
};

export type CartShippingAddress = {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_2?: string;
  admin_area_1?: string;
  postal_code?: string;
  country_code?: string;
  [key: string]: any;
};

export type CartCheckoutField = {
  type: string;
  value: string;
  [key: string]: any;
};

export type CartTotals = {
  subtotal: { currency_code: string; value: string };
  shipping: { currency_code: string; value: string };
  tax: { currency_code: string; value: string };
  total: { currency_code: string; value: string };
};

export type CartStatus = "CREATED" | "INCOMPLETE" | "COMPLETED";
export type ValidationStatus = "VALID" | "INVALID";

export type Cart = {
  id: string;
  status: CartStatus;
  validation_status: ValidationStatus;
  validation_issues: ValidationIssue[];
  items: CartItemOutput[];
  customer?: CartCustomer;
  shipping_address?: CartShippingAddress;
  checkout_fields?: CartCheckoutField[];
  totals: CartTotals;
  payment_method?: {
    type: string;
    token?: string;
    [key: string]: any;
  };
  payment_confirmation?: {
    merchant_order_number: string;
    order_review_page: string;
  };
  [key: string]: any;
};

const globalForCart = globalThis as unknown as {
  merchantCarts?: Map<string, Cart>;
};

export const cartStore: Map<string, Cart> =
  globalForCart.merchantCarts ?? (globalForCart.merchantCarts = new Map<string, Cart>());

export function getBaseOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }
  try {
    const url = new URL(req.url);
    return url.origin;
  } catch {
    const host = req.headers.get("host") || "localhost:3000";
    return `http://${host}`;
  }
}

export function createErrorResponse(
  name: string,
  message: string,
  status: number,
  debug_id?: string
) {
  return Response.json(
    {
      name,
      message,
      debug_id: debug_id || crypto.randomUUID(),
    },
    { status }
  );
}

export function priceAndFormatItems(itemsInput: any[] = []): {
  items: CartItemOutput[];
  totals: CartTotals;
} {
  let subtotalNum = 0;
  const items: CartItemOutput[] = [];

  for (const item of itemsInput) {
    const product = findProduct(item?.item_id);
    const qty = typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
    if (product) {
      subtotalNum += Number(product.price) * qty;
      items.push({
        item_id: item.item_id,
        quantity: item.quantity,
        name: product.title,
        price: {
          currency_code: "USD",
          value: product.price,
        },
        ...(item.variant_id !== undefined ? { variant_id: item.variant_id } : {}),
      });
    } else {
      items.push({
        item_id: item?.item_id || "unknown",
        quantity: item?.quantity || 1,
        name: item?.name || item?.item_id || "Unknown item",
        price: {
          currency_code: "USD",
          value: "0.00",
        },
        ...(item?.variant_id !== undefined ? { variant_id: item.variant_id } : {}),
      });
    }
  }

  const subtotalStr = subtotalNum.toFixed(2);
  const totals: CartTotals = {
    subtotal: { currency_code: "USD", value: subtotalStr },
    shipping: { currency_code: "USD", value: "0.00" },
    tax: { currency_code: "USD", value: "0.00" },
    total: { currency_code: "USD", value: subtotalStr },
  };

  return { items, totals };
}

export function validateCart(cart: Cart): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Items validation
  if (!cart.items || cart.items.length === 0) {
    issues.push({
      code: "INVENTORY_ISSUE",
      type: "MISSING_FIELD",
      message: "Cart must contain at least one item.",
      user_message: "Your cart is empty.",
      field: "items",
      context: { specific_issue: "EMPTY_CART" },
      resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
    });
  } else {
    cart.items.forEach((item, idx) => {
      const product = findProduct(item.item_id);
      if (!product) {
        issues.push({
          code: "INVENTORY_ISSUE",
          type: "INVALID_DATA",
          message: `Item '${item.item_id}' not found in catalog.`,
          user_message: `Item '${item.item_id}' is not available.`,
          field: `items[${idx}].item_id`,
          context: { specific_issue: "UNKNOWN_ITEM_ID", item_id: item.item_id },
          resolution_options: [{ action: "REMOVE_ITEM" }],
        });
      }
      if (!item.quantity || typeof item.quantity !== "number" || item.quantity <= 0) {
        issues.push({
          code: "DATA_ERROR",
          type: "INVALID_DATA",
          message: `Quantity for '${item.item_id}' must be greater than zero.`,
          user_message: "Please specify a quantity greater than zero.",
          field: `items[${idx}].quantity`,
          context: { specific_issue: "INVALID_QUANTITY" },
          resolution_options: [{ action: "UPDATE_QUANTITY" }],
        });
      }
    });
  }

  // 2. Shipping Address validation
  if (!cart.shipping_address || !cart.shipping_address.address_line_1) {
    issues.push({
      code: "SHIPPING_ERROR",
      type: "MISSING_FIELD",
      message: "A shipping address is required.",
      user_message: "Please enter your delivery address.",
      field: "shipping_address",
      context: { specific_issue: "MISSING_SHIPPING_ADDRESS" },
      resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
    });
  }

  // 3. Preorder delivery date preference validation
  const preorderItems = (cart.items || []).filter((i) => {
    const prod = findProduct(i.item_id);
    return prod && prod.leadTimeDays > 0;
  });

  if (preorderItems.length > 0) {
    const maxLeadDays = Math.max(
      ...preorderItems.map((i) => findProduct(i.item_id)!.leadTimeDays)
    );
    const deliveryField = cart.checkout_fields?.find(
      (f) => f.type === "DELIVERY_DATE_PREFERENCE"
    );

    if (!deliveryField || !deliveryField.value || !deliveryField.value.trim()) {
      issues.push({
        code: "DATA_ERROR",
        type: "MISSING_FIELD",
        message: "A delivery date is required for preorder cakes.",
        user_message: "Which day should we deliver your cake?",
        field: "checkout_fields.DELIVERY_DATE_PREFERENCE",
        context: { specific_issue: "MISSING_CHECKOUT_FIELDS" },
        resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
      });
    } else {
      const val = deliveryField.value.trim();
      const parts = val.split("-").map(Number);
      let isTooEarly = false;
      if (parts.length !== 3 || parts.some(isNaN)) {
        isTooEarly = true;
      } else {
        const [year, month, day] = parts;
        const chosenUtc = Date.UTC(year, month - 1, day);
        const now = new Date();
        const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const diffDays = Math.round((chosenUtc - todayUtc) / (24 * 60 * 60 * 1000));
        if (diffDays < maxLeadDays) {
          isTooEarly = true;
        }
      }

      if (isTooEarly) {
        issues.push({
          code: "DATA_ERROR",
          type: "MISSING_FIELD",
          message: `Delivery date must be at least ${maxLeadDays} day(s) in advance for this order.`,
          user_message: `Which day should we deliver your cake? Preorder requires at least ${maxLeadDays} day(s) notice.`,
          field: "checkout_fields.DELIVERY_DATE_PREFERENCE",
          context: { specific_issue: "DELIVERY_DATE_TOO_EARLY", min_lead_time_days: maxLeadDays },
          resolution_options: [{ action: "PROVIDE_MISSING_FIELD" }],
        });
      }
    }
  }

  return issues;
}

export async function createCart(body: any, origin: string): Promise<Cart> {
  const id = `cart_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const { items, totals } = priceAndFormatItems(body.items);

  const cart: Cart = {
    id,
    status: "CREATED",
    validation_status: "VALID",
    validation_issues: [],
    items,
    totals,
  };

  if (body.customer) cart.customer = body.customer;
  if (body.shipping_address) cart.shipping_address = body.shipping_address;
  if (body.checkout_fields) cart.checkout_fields = body.checkout_fields;
  cart.payment_method = {
    type: "paypal",
    ...(body.payment_method || {}),
  };

  cart.validation_issues = validateCart(cart);
  cart.validation_status = cart.validation_issues.length === 0 ? "VALID" : "INVALID";
  cart.status = "CREATED";

  // Create PayPal order if cart has items and amount > 0
  if (cart.items.length > 0 && Number(totals.total.value) > 0) {
    try {
      const { status: orderStatus, body: orderBody } = await createPayPalOrderForCart({
        total: totals.total.value,
        origin,
        cartId: id,
      });
      if (orderBody?.id) {
        if (!cart.payment_method) {
          cart.payment_method = { type: "paypal" };
        }
        cart.payment_method.token = orderBody.id;
      }
    } catch (err) {
      console.error("Failed to create PayPal order for cart:", err);
    }
  }

  cartStore.set(id, cart);
  return cart;
}

export async function updateCart(
  id: string,
  body: any,
  origin: string
): Promise<Cart | null> {
  if (!cartStore.has(id)) {
    return null;
  }

  // Full replace: omitted fields are cleared!
  const { items, totals } = priceAndFormatItems(body.items);

  const cart: Cart = {
    id,
    status: "CREATED",
    validation_status: "VALID",
    validation_issues: [],
    items,
    totals,
  };

  if (body.customer) cart.customer = body.customer;
  if (body.shipping_address) cart.shipping_address = body.shipping_address;
  if (body.checkout_fields) cart.checkout_fields = body.checkout_fields;
  cart.payment_method = {
    type: "paypal",
    ...(body.payment_method || {}),
  };

  cart.validation_issues = validateCart(cart);
  cart.validation_status = cart.validation_issues.length === 0 ? "VALID" : "INVALID";
  cart.status = cart.validation_issues.length === 0 ? "CREATED" : "INCOMPLETE";

  // Recreate PayPal order if items exist and total > 0
  if (cart.items.length > 0 && Number(totals.total.value) > 0) {
    try {
      const { status: orderStatus, body: orderBody } = await createPayPalOrderForCart({
        total: totals.total.value,
        origin,
        cartId: id,
      });
      if (orderBody?.id) {
        if (!cart.payment_method) {
          cart.payment_method = { type: "paypal" };
        }
        cart.payment_method.token = orderBody.id;
      }
    } catch (err) {
      console.error("Failed to recreate PayPal order for cart:", err);
    }
  }

  cartStore.set(id, cart);
  return cart;
}

export async function checkoutCart(
  id: string,
  origin: string
): Promise<{ status: number; body: any }> {
  const cart = cartStore.get(id);
  if (!cart) {
    return {
      status: 404,
      body: {
        name: "CART_NOT_FOUND",
        message: `Cart '${id}' not found`,
        debug_id: crypto.randomUUID(),
      },
    };
  }

  // If already completed:
  if (cart.status === "COMPLETED") {
    return { status: 200, body: cart };
  }

  // 1. Re-validate cart. If INVALID, return 200 with cart and issues
  cart.validation_issues = validateCart(cart);
  cart.validation_status = cart.validation_issues.length === 0 ? "VALID" : "INVALID";
  if (cart.validation_status === "INVALID") {
    cartStore.set(id, cart);
    return { status: 200, body: cart };
  }

  // 2. Cart is VALID: check PayPal order
  const orderId = cart.payment_method?.token;
  if (!orderId) {
    return {
      status: 422,
      body: {
        name: "UNPROCESSABLE_ENTITY",
        message: "The buyer must approve the PayPal payment first.",
        debug_id: crypto.randomUUID(),
      },
    };
  }

  // 3. Fetch PayPal order
  const { status: fetchStatus, body: orderData } = await getPayPalOrder(orderId);
  if (fetchStatus >= 400 || !orderData) {
    return {
      status: 422,
      body: {
        name: "UNPROCESSABLE_ENTITY",
        message: "The buyer must approve the PayPal payment first.",
        debug_id: orderData?.debug_id || crypto.randomUUID(),
      },
    };
  }

  // 4. Check if APPROVED
  if (orderData.status !== "APPROVED") {
    return {
      status: 422,
      body: {
        name: "UNPROCESSABLE_ENTITY",
        message: "The buyer must approve the PayPal payment first.",
        debug_id: orderData.debug_id || crypto.randomUUID(),
      },
    };
  }

  // 5. Order is APPROVED: capture it
  const { status: captureStatus, body: captureBody } = await capturePayPalOrder(orderId);
  if (captureStatus >= 400) {
    return {
      status: 422,
      body: {
        name: "UNPROCESSABLE_ENTITY",
        message: captureBody?.message || "Failed to capture PayPal payment.",
        debug_id: captureBody?.debug_id || crypto.randomUUID(),
      },
    };
  }

  // 6. Verify captured amount equals cart total
  const capturedAmount =
    captureBody?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ||
    orderData?.purchase_units?.[0]?.amount?.value;

  if (capturedAmount && capturedAmount !== cart.totals.total.value) {
    return {
      status: 422,
      body: {
        name: "UNPROCESSABLE_ENTITY",
        message: `Captured amount '${capturedAmount}' does not match cart total '${cart.totals.total.value}'.`,
        debug_id: crypto.randomUUID(),
      },
    };
  }

  // 7. Mark COMPLETED and add payment_confirmation
  cart.status = "COMPLETED";
  const merchantOrderNumber = `LB-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
  cart.payment_confirmation = {
    merchant_order_number: merchantOrderNumber,
    order_review_page: `${origin}/thank-you?order=${orderId}`,
  };

  cartStore.set(id, cart);
  return { status: 200, body: cart };
}
