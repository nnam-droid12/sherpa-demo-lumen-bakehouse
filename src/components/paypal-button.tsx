"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { type CartItem, cartTotal, writeCart } from "@/lib/cart";

export function PayPalButton({ clientId, items }: { clientId: string; items: CartItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>("");
  const [eligible, setEligible] = useState<{ paypal: boolean; venmo: boolean }>({
    paypal: true,
    venmo: true,
  });

  const paypalBtnRef = useRef<HTMLElement>(null);
  const venmoBtnRef = useRef<HTMLElement>(null);
  const paypalSessionRef = useRef<any>(null);
  const venmoSessionRef = useRef<any>(null);
  const isStartingRef = useRef(false);

  const total = cartTotal(items);

  const createOrder = useCallback(async (): Promise<{ orderId: string }> => {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.map((i) => ({ id: i.id, qty: i.qty })) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || "Failed to create order");
    }
    const order = await res.json();
    return { orderId: order.id || order.orderId };
  }, [items]);

  const handleApprove = useCallback(
    async (data: { orderId: string }) => {
      try {
        const res = await fetch(`/api/orders/${data.orderId}/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const capture = await res.json();
        if (res.ok && (capture.status === "COMPLETED" || capture.status === "APPROVED")) {
          writeCart([]);
          router.push(`/thank-you?order=${capture.id || data.orderId}`);
        } else {
          const detail = capture?.details?.[0]?.issue || capture?.name;
          if (detail === "INSTRUMENT_DECLINED" || capture?.message?.includes("INSTRUMENT_DECLINED")) {
            setError(
              "Your payment method was declined (INSTRUMENT_DECLINED). Please choose a different payment method and try again."
            );
          } else {
            setError(capture?.message || capture?.error || "Payment could not be completed. Please try again.");
          }
        }
      } catch (err: any) {
        setError(err?.message || "Payment could not be completed. Please try again.");
      }
    },
    [router]
  );

  const handleError = useCallback((err: any) => {
    console.error("Payment error:", err);
    const msg = err?.message || err?.code || "";
    if (err?.code === "INSTRUMENT_DECLINED" || msg.includes("INSTRUMENT_DECLINED")) {
      setError(
        "Your payment method was declined (INSTRUMENT_DECLINED). Please choose a different payment method and try again."
      );
    } else {
      setError(msg || "Payment could not be completed. Please try again.");
    }
  }, []);

  const handleStartPayPal = useCallback(async () => {
    if (isStartingRef.current) return;
    if (!paypalSessionRef.current) return;
    isStartingRef.current = true;
    setError("");
    try {
      await paypalSessionRef.current.start(
        { presentationMode: "auto" },
        createOrder()
      );
    } catch (err: any) {
      handleError(err);
    } finally {
      isStartingRef.current = false;
    }
  }, [createOrder, handleError]);

  const handleStartVenmo = useCallback(async () => {
    if (isStartingRef.current) return;
    if (!venmoSessionRef.current) return;
    isStartingRef.current = true;
    setError("");
    try {
      await venmoSessionRef.current.start(
        { presentationMode: "auto" },
        createOrder()
      );
    } catch (err: any) {
      handleError(err);
    } finally {
      isStartingRef.current = false;
    }
  }, [createOrder, handleError]);

  useEffect(() => {
    let mounted = true;

    async function initSDK() {
      try {
        if (typeof window === "undefined") return;

        if (typeof (window as any).paypal?.createInstance !== "function") {
          let script = document.querySelector<HTMLScriptElement>(
            'script[src="https://www.sandbox.paypal.com/web-sdk/v6/core"]'
          );
          if (!script) {
            script = document.createElement("script");
            script.async = true;
            script.src = "https://www.sandbox.paypal.com/web-sdk/v6/core";
            document.head.appendChild(script);
          }
          await new Promise<void>((resolve, reject) => {
            const check = () => {
              if (typeof (window as any).paypal?.createInstance === "function") return resolve();
              return false;
            };
            if (check()) return;
            const timer = setInterval(() => {
              if (check()) {
                clearInterval(timer);
              }
            }, 50);
            script!.addEventListener("load", () => {
              clearInterval(timer);
              resolve();
            });
            script!.addEventListener("error", (e) => {
              clearInterval(timer);
              reject(e);
            });
            setTimeout(() => {
              clearInterval(timer);
              if (typeof (window as any).paypal?.createInstance === "function") resolve();
              else reject(new Error("PayPal SDK load timed out"));
            }, 10000);
          });
        }

        if (!mounted || !window.paypal?.createInstance) return;

        const sdkInstance = await window.paypal.createInstance({
          clientId,
          components: ["paypal-payments", "venmo-payments", "paypal-messages"],
          pageType: "checkout",
        });

        if (!mounted) return;

        if (sdkInstance.createPayPalMessages) {
          sdkInstance.createPayPalMessages();
        }

        const methods = await sdkInstance.findEligibleMethods({ currencyCode: "USD" });
        if (!mounted) return;

        const isPayPalEligible = methods?.isEligible ? methods.isEligible("paypal") : true;
        const isVenmoEligible = methods?.isEligible ? methods.isEligible("venmo") : true;

        setEligible({ paypal: isPayPalEligible, venmo: isVenmoEligible });

        if (sdkInstance.createPayPalOneTimePaymentSession) {
          paypalSessionRef.current = sdkInstance.createPayPalOneTimePaymentSession({
            onApprove: handleApprove,
            onCancel: () => console.log("PayPal payment canceled"),
            onError: handleError,
          });
        }

        if (sdkInstance.createVenmoOneTimePaymentSession) {
          venmoSessionRef.current = sdkInstance.createVenmoOneTimePaymentSession({
            onApprove: handleApprove,
            onCancel: () => console.log("Venmo payment canceled"),
            onError: handleError,
          });
        }
      } catch (err: any) {
        console.error("SDK initialization error:", err);
      }
    }

    initSDK();

    return () => {
      mounted = false;
    };
  }, [clientId, handleApprove, handleError]);

  // Wire click events to web component buttons
  useEffect(() => {
    const pBtn = paypalBtnRef.current;
    const vBtn = venmoBtnRef.current;

    const onPClick = () => handleStartPayPal();
    const onVClick = () => handleStartVenmo();

    if (pBtn) pBtn.addEventListener("click", onPClick);
    if (vBtn) vBtn.addEventListener("click", onVClick);

    return () => {
      if (pBtn) pBtn.removeEventListener("click", onPClick);
      if (vBtn) vBtn.removeEventListener("click", onVClick);
    };
  }, [handleStartPayPal, handleStartVenmo, eligible]);

  return (
    <div className="paypal-checkout-container" style={{ width: "100%", maxWidth: 360, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <paypal-message auto-bootstrap amount={total} currency-code="USD" />
      </div>

      {eligible.paypal && (
        <paypal-button
          ref={paypalBtnRef}
          type="pay"
          class="paypal-gold"
          style={{ display: "block", width: "100%", minHeight: 45, marginBottom: 10, cursor: "pointer" }}
        />
      )}

      {eligible.venmo && (
        <venmo-button
          ref={venmoBtnRef}
          type="pay"
          class="venmo-blue"
          style={{ display: "block", width: "100%", minHeight: 45, marginBottom: 10, cursor: "pointer" }}
        />
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #f87171",
            borderRadius: 12,
            color: "#991b1b",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: "0.92rem", fontWeight: 500 }}>{error}</p>
          <button
            type="button"
            className="button ghost"
            style={{ padding: "6px 14px", fontSize: "0.85rem" }}
            onClick={() => setError("")}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
