import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";

import { GET as getCatalog } from "../src/app/catalog.json/route.ts";
import { POST as createCartRoute } from "../src/app/merchant-cart/route.ts";
import {
  GET as getCartRoute,
  PUT as updateCartRoute,
} from "../src/app/merchant-cart/[id]/route.ts";
import { POST as checkoutRoute } from "../src/app/merchant-cart/[id]/checkout/route.ts";
import { cartStore } from "../src/lib/merchant-cart.ts";

describe("Contract Tests - Lumen Bakehouse", () => {
  let mockOrders = new Map();
  let createdPayPalOrders = [];

  beforeEach(() => {
    cartStore.clear();
    mockOrders.clear();
    createdPayPalOrders = [];

    // Mock global fetch for PayPal API - guarantees NO external network access
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      // Auth endpoint
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_paypal_token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Create Order endpoint
      if (urlStr.includes("/v2/checkout/orders") && options.method === "POST" && !urlStr.includes("/capture")) {
        const body = JSON.parse(options.body || "{}");
        const orderId = `MOCK_ORDER_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const orderData = {
          id: orderId,
          status: "CREATED",
          purchase_units: body.purchase_units || [],
          payment_source: body.payment_source,
        };
        mockOrders.set(orderId, orderData);
        createdPayPalOrders.push({ orderId, body });
        return new Response(JSON.stringify({ id: orderId, status: "CREATED" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Capture Order endpoint
      if (urlStr.includes("/capture") && options.method === "POST") {
        const match = urlStr.match(/\/orders\/([^/]+)\/capture/);
        const orderId = match ? decodeURIComponent(match[1]) : "";
        const order = mockOrders.get(orderId);
        const amountVal = order?.mockCaptureAmount || order?.purchase_units?.[0]?.amount?.value || "78.00";
        return new Response(
          JSON.stringify({
            id: `CAPTURE_${orderId}`,
            status: "COMPLETED",
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: `C_${orderId}`,
                      status: "COMPLETED",
                      amount: { currency_code: "USD", value: amountVal },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }

      // Get Order endpoint
      if (urlStr.includes("/v2/checkout/orders/")) {
        const match = urlStr.match(/\/orders\/([^/]+)$/);
        const orderId = match ? decodeURIComponent(match[1]) : "";
        const order = mockOrders.get(orderId);
        if (!order) {
          return new Response(
            JSON.stringify({ name: "RESOURCE_NOT_FOUND", message: "Order not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify(order), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected unmocked network call in contract tests: ${urlStr}`);
    };
  });

  // 1. Catalog Feed
  test("GET /catalog.json returns real product data in agent feed shape", async () => {
    const req = new Request("http://localhost:3000/catalog.json");
    const res = await getCatalog(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.items), "data.items should be an array");
    assert.equal(data.items.length, 6);

    const first = data.items[0];
    assert.ok(first.id, "item must have id");
    assert.ok(first.title, "item must have title");
    assert.ok(first.description, "item must have description");
    assert.ok(first.price?.currency_code, "item must have price.currency_code");
    assert.ok(first.price?.value, "item must have price.value");
    assert.ok(["in_stock", "preorder"].includes(first.availability), "availability must be in_stock or preorder");
    assert.ok(first.image_url.startsWith("http"), "image_url must be absolute");
    assert.ok(first.url.startsWith("http"), "url must be absolute");
    assert.ok(Array.isArray(first.variants), "variants must be an array");
    assert.ok(typeof first.serves === "number", "serves must be a number");
    assert.ok(typeof first.lead_time_days === "number", "lead_time_days must be a number");
    assert.ok(typeof first.leadTimeDays === "number", "leadTimeDays must be a number");
    assert.ok(Array.isArray(first.flavours), "flavours must be an array");
  });

  // 2. Create Cart
  test("POST /merchant-cart creates cart, validates, prices from catalog, and creates PayPal order", async () => {
    const validBody = {
      items: [{ item_id: "vanilla-bean-celebration", variant_id: null, quantity: 1, price: { value: "1.00" } }],
      customer: { email_address: "buyer@example.com", name: { given_name: "Alex", surname: "Rivera" } },
      shipping_address: {
        address_line_1: "500 Market St",
        admin_area_2: "San Francisco",
        admin_area_1: "CA",
        postal_code: "94105",
        country_code: "US",
      },
      checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      payment_method: { type: "paypal" },
    };

    const req = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const res = await createCartRoute(req);
    assert.equal(res.status, 201);

    const cart = await res.json();
    assert.ok(cart.id.startsWith("cart_"), "cart.id should start with cart_");
    assert.equal(cart.status, "CREATED");
    assert.equal(cart.validation_status, "VALID");
    assert.deepEqual(cart.validation_issues, []);
    assert.equal(cart.items[0].item_id, "vanilla-bean-celebration");
    assert.equal(cart.items[0].price.value, "78.00", "Must ignore client-sent price and price from catalog");
    assert.equal(cart.totals.total.value, "78.00");
    assert.ok(cart.payment_method?.token, "cart.payment_method.token should be populated with PayPal order ID");

    // Verify PayPal order creation payload
    assert.equal(createdPayPalOrders.length, 1);
    const orderReq = createdPayPalOrders[0].body;
    assert.equal(orderReq.intent, "CAPTURE");
    assert.equal(orderReq.purchase_units[0].amount.value, "78.00");
    const expContext = orderReq.payment_source.paypal.experience_context;
    assert.equal(expContext.user_action, "PAY_NOW");
    assert.equal(expContext.return_url, "http://localhost:3000/thank-you");
    assert.equal(expContext.cancel_url, "http://localhost:3000/cart");
  });

  // 3. Get Cart
  test("GET /merchant-cart/{id} reads stored cart", async () => {
    const postReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const postRes = await createCartRoute(postReq);
    const created = await postRes.json();

    const getReq = new Request(`http://localhost:3000/merchant-cart/${created.id}`);
    const getRes = await getCartRoute(getReq, { params: Promise.resolve({ id: created.id }) });
    assert.equal(getRes.status, 200);

    const fetched = await getRes.json();
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.totals.total.value, "78.00");
  });

  // 4. 404 CART_NOT_FOUND
  test("GET /merchant-cart/{id} returns 404 CART_NOT_FOUND for unknown cart", async () => {
    const getReq = new Request("http://localhost:3000/merchant-cart/cart_nonexistent");
    const getRes = await getCartRoute(getReq, { params: Promise.resolve({ id: "cart_nonexistent" }) });
    assert.equal(getRes.status, 404);

    const err = await getRes.json();
    assert.equal(err.name, "CART_NOT_FOUND");
    assert.ok(err.message.includes("cart_nonexistent"));
    assert.ok(err.debug_id);
  });

  // 5. Update (full replace)
  test("PUT /merchant-cart/{id} fully replaces cart, clears omitted fields, and recreates order", async () => {
    const postReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        customer: { email_address: "first@example.com" },
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const postRes = await createCartRoute(postReq);
    const created = await postRes.json();
    const firstToken = created.payment_method.token;

    // Full replace: new items, omitted shipping_address, customer, and checkout_fields
    const putReq = new Request(`http://localhost:3000/merchant-cart/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "lemon-elderflower", quantity: 2 }],
      }),
    });

    const putRes = await updateCartRoute(putReq, { params: Promise.resolve({ id: created.id }) });
    assert.equal(putRes.status, 200);

    const updated = await putRes.json();
    assert.equal(updated.id, created.id);
    assert.equal(updated.items.length, 1);
    assert.equal(updated.items[0].item_id, "lemon-elderflower");
    assert.equal(updated.items[0].quantity, 2);
    // 2 x 64.00 = 128.00
    assert.equal(updated.totals.total.value, "128.00");
    // customer, shipping_address, checkout_fields should be cleared
    assert.equal(updated.customer, undefined);
    assert.equal(updated.shipping_address, undefined);
    assert.equal(updated.checkout_fields, undefined);

    // Validation issues should be present because shipping and delivery date are omitted
    assert.equal(updated.validation_status, "INVALID");
    assert.equal(updated.status, "INCOMPLETE");
    assert.ok(updated.validation_issues.some((i) => i.code === "SHIPPING_ERROR"));
    assert.ok(updated.validation_issues.some((i) => i.code === "DATA_ERROR"));

    // Order should have been recreated
    assert.ok(updated.payment_method.token);
    assert.notEqual(updated.payment_method.token, firstToken);
  });

  // 6. PUT 404
  test("PUT /merchant-cart/{id} returns 404 for unknown cart", async () => {
    const putReq = new Request("http://localhost:3000/merchant-cart/cart_unknown", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }] }),
    });
    const putRes = await updateCartRoute(putReq, { params: Promise.resolve({ id: "cart_unknown" }) });
    assert.equal(putRes.status, 404);
    const err = await putRes.json();
    assert.equal(err.name, "CART_NOT_FOUND");
  });

  // 7. Validation Issues
  test("Validation issues for unknown item_id, missing shipping address, and delivery date", async () => {
    // A: Unknown item_id
    const badItemReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "unicorn-rainbow-cake", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const badItemRes = await createCartRoute(badItemReq);
    const badItemCart = await badItemRes.json();
    assert.equal(badItemCart.validation_status, "INVALID");
    const itemIssue = badItemCart.validation_issues.find((i) => i.code === "INVENTORY_ISSUE");
    assert.ok(itemIssue, "Should report INVENTORY_ISSUE for unknown item_id");
    assert.ok(itemIssue.field.includes("item_id"));

    // B: Missing shipping address
    const noShipReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const noShipRes = await createCartRoute(noShipReq);
    const noShipCart = await noShipRes.json();
    assert.equal(noShipCart.validation_status, "INVALID");
    const shipIssue = noShipCart.validation_issues.find((i) => i.code === "SHIPPING_ERROR");
    assert.ok(shipIssue, "Should report SHIPPING_ERROR for missing shipping_address");
    assert.equal(shipIssue.type, "MISSING_FIELD");
    assert.equal(shipIssue.field, "shipping_address");

    // C: Missing DELIVERY_DATE_PREFERENCE for preorder item
    const noDateReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
      }),
    });
    const noDateRes = await createCartRoute(noDateReq);
    const noDateCart = await noDateRes.json();
    assert.equal(noDateCart.validation_status, "INVALID");
    const dateIssue = noDateCart.validation_issues.find(
      (i) => i.field === "checkout_fields.DELIVERY_DATE_PREFERENCE"
    );
    assert.ok(dateIssue, "Should report issue for missing DELIVERY_DATE_PREFERENCE");
    assert.equal(dateIssue.code, "DATA_ERROR");
    assert.equal(dateIssue.type, "MISSING_FIELD");
    assert.deepEqual(dateIssue.resolution_options, [{ action: "PROVIDE_MISSING_FIELD" }]);

    // D: Too-early DELIVERY_DATE_PREFERENCE
    const tooEarlyReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2020-01-01" }],
      }),
    });
    const tooEarlyRes = await createCartRoute(tooEarlyReq);
    const tooEarlyCart = await tooEarlyRes.json();
    assert.equal(tooEarlyCart.validation_status, "INVALID");
    const earlyIssue = tooEarlyCart.validation_issues.find(
      (i) => i.field === "checkout_fields.DELIVERY_DATE_PREFERENCE"
    );
    assert.ok(earlyIssue, "Should report issue for too-early DELIVERY_DATE_PREFERENCE");
    assert.equal(earlyIssue.code, "DATA_ERROR");
    assert.equal(earlyIssue.type, "MISSING_FIELD");
    assert.deepEqual(earlyIssue.resolution_options, [{ action: "PROVIDE_MISSING_FIELD" }]);
  });

  // 8. Checkout before approval
  test("POST /merchant-cart/{id}/checkout returns 422 UNPROCESSABLE_ENTITY if PayPal order not approved", async () => {
    const postReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const postRes = await createCartRoute(postReq);
    const cart = await postRes.json();
    assert.equal(cart.validation_status, "VALID");

    // Checkout before buyer approves
    const checkoutReq = new Request(`http://localhost:3000/merchant-cart/${cart.id}/checkout`, {
      method: "POST",
    });
    const checkoutRes = await checkoutRoute(checkoutReq, { params: Promise.resolve({ id: cart.id }) });
    assert.equal(checkoutRes.status, 422);

    const err = await checkoutRes.json();
    assert.equal(err.name, "UNPROCESSABLE_ENTITY");
    assert.ok(err.message.includes("buyer must approve"));
    assert.ok(err.debug_id);
  });

  // 9. Checkout invalid cart returns 200 with cart and issues
  test("POST /merchant-cart/{id}/checkout returns 200 with cart if validation_status is INVALID", async () => {
    const postReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        // Missing shipping and delivery date
      }),
    });
    const postRes = await createCartRoute(postReq);
    const cart = await postRes.json();
    assert.equal(cart.validation_status, "INVALID");

    const checkoutReq = new Request(`http://localhost:3000/merchant-cart/${cart.id}/checkout`, {
      method: "POST",
    });
    const checkoutRes = await checkoutRoute(checkoutReq, { params: Promise.resolve({ id: cart.id }) });
    assert.equal(checkoutRes.status, 200);

    const resCart = await checkoutRes.json();
    assert.equal(resCart.validation_status, "INVALID");
    assert.ok(resCart.validation_issues.length > 0);
  });

  // 10. Checkout after approval completes cart
  test("POST /merchant-cart/{id}/checkout captures approved order and sets COMPLETED with payment_confirmation", async () => {
    const postReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const postRes = await createCartRoute(postReq);
    const cart = await postRes.json();
    assert.equal(cart.validation_status, "VALID");

    // Simulate buyer approving PayPal order
    const order = mockOrders.get(cart.payment_method.token);
    order.status = "APPROVED";

    const checkoutReq = new Request(`http://localhost:3000/merchant-cart/${cart.id}/checkout`, {
      method: "POST",
    });
    const checkoutRes = await checkoutRoute(checkoutReq, { params: Promise.resolve({ id: cart.id }) });
    assert.equal(checkoutRes.status, 200);

    const completed = await checkoutRes.json();
    assert.equal(completed.status, "COMPLETED");
    assert.ok(completed.payment_confirmation?.merchant_order_number);
    assert.ok(completed.payment_confirmation?.order_review_page.includes("/thank-you?order="));
  });

  // 11. Checkout 404
  test("POST /merchant-cart/{id}/checkout returns 404 for unknown cart", async () => {
    const checkoutReq = new Request("http://localhost:3000/merchant-cart/cart_unknown/checkout", {
      method: "POST",
    });
    const checkoutRes = await checkoutRoute(checkoutReq, { params: Promise.resolve({ id: "cart_unknown" }) });
    assert.equal(checkoutRes.status, 404);
    const err = await checkoutRes.json();
    assert.equal(err.name, "CART_NOT_FOUND");
  });

  // 12. Checkout amount mismatch
  test("POST /merchant-cart/{id}/checkout returns 422 if captured amount does not match", async () => {
    const postReq = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ item_id: "vanilla-bean-celebration", quantity: 1 }],
        shipping_address: { address_line_1: "500 Market St" },
        checkout_fields: [{ type: "DELIVERY_DATE_PREFERENCE", value: "2026-11-07" }],
      }),
    });
    const postRes = await createCartRoute(postReq);
    const cart = await postRes.json();

    const order = mockOrders.get(cart.payment_method.token);
    order.status = "APPROVED";
    order.mockCaptureAmount = "999.00"; // mismatch amount

    const checkoutReq = new Request(`http://localhost:3000/merchant-cart/${cart.id}/checkout`, {
      method: "POST",
    });
    const checkoutRes = await checkoutRoute(checkoutReq, { params: Promise.resolve({ id: cart.id }) });
    assert.equal(checkoutRes.status, 422);
    const err = await checkoutRes.json();
    assert.equal(err.name, "UNPROCESSABLE_ENTITY");
    assert.ok(err.message.includes("match"));
  });

  // 13. Invalid request body on POST
  test("POST /merchant-cart returns 400 INVALID_REQUEST on malformed JSON", async () => {
    const req = new Request("http://localhost:3000/merchant-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await createCartRoute(req);
    assert.equal(res.status, 400);
    const err = await res.json();
    assert.equal(err.name, "INVALID_REQUEST");
  });
});
