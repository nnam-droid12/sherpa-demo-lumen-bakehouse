"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { type CartItem, writeCart } from "@/lib/cart";
import { loadPayPalSdkScript } from "@/lib/paypal-sdk";

export function PayPalButton({ clientId, items }: { clientId: string; items: CartItem[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [isVenmoEligible, setIsVenmoEligible] = useState(false);
  const [isSdkReady, setIsSdkReady] = useState(false);

  const paypalBtnRef = useRef<HTMLElement>(null);
  const venmoBtnRef = useRef<HTMLElement>(null);
  const sdkInstanceRef = useRef<any>(null);

  const createOrder = useCallback(async (): Promise<{ orderId: string }> => {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.map((i) => ({ id: i.id, qty: i.qty })) }),
    });
    const order = await res.json();
    if (!res.ok) {
      throw new Error(order.error || "Failed to create order");
    }
    return { orderId: order.id };
  }, [items]);

  const handleCapture = useCallback(
    async (orderId: string) => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.map((i) => ({ id: i.id, qty: i.qty })) }),
        });
        const capture = await res.json();

        const isDeclined =
          capture.error === "INSTRUMENT_DECLINED" ||
          capture.issue === "INSTRUMENT_DECLINED" ||
          capture.details?.some((d: any) => d.issue === "INSTRUMENT_DECLINED") ||
          res.status === 422;

        if (isDeclined) {
          setError("Your payment method was declined. Please choose another payment method or try again.");
          initSessions();
          return;
        }

        if (!res.ok) {
          setError(capture.message || capture.error || "Payment could not be completed. Please try again.");
          initSessions();
          return;
        }

        if (capture.status === "COMPLETED") {
          writeCart([]);
          router.push(`/thank-you?order=${capture.id}`);
        } else if (capture.status === "PENDING") {
          setPendingMessage("Your payment is currently being reviewed. We will confirm your order once payment clears.");
        } else {
          setError("Payment could not be completed. Please try again.");
          initSessions();
        }
      } catch (err: any) {
        setError(err?.message || "An unexpected error occurred while capturing payment. Please try again.");
        initSessions();
      }
    },
    [items, router]
  );

  const initSessions = useCallback(() => {
    const sdkInstance = sdkInstanceRef.current;
    if (!sdkInstance) return;

    // Handle any session errors
    const handlePaymentError = (err: any) => {
      console.error("Payment error:", err);
      setError(err?.message || "Payment could not be completed. Please choose another payment method or try again.");
    };

    // PayPal session
    if (typeof sdkInstance.createPayPalOneTimePaymentSession === "function") {
      const paypalSession = sdkInstance.createPayPalOneTimePaymentSession({
        onApprove: async (data: { orderId: string }) => {
          await handleCapture(data.orderId);
        },
        onCancel: () => {
          console.log("PayPal payment cancelled by buyer");
        },
        onError: handlePaymentError,
      });

      const paypalBtn = paypalBtnRef.current;
      if (paypalBtn) {
        paypalBtn.onclick = async () => {
          setError("");
          setPendingMessage("");
          try {
            await paypalSession.start({ presentationMode: "auto" }, createOrder());
          } catch (err: any) {
            handlePaymentError(err);
          }
        };
      }
    }

    // Venmo session
    if (typeof sdkInstance.createVenmoOneTimePaymentSession === "function") {
      const venmoSession = sdkInstance.createVenmoOneTimePaymentSession({
        onApprove: async (data: { orderId: string }) => {
          await handleCapture(data.orderId);
        },
        onCancel: () => {
          console.log("Venmo payment cancelled by buyer");
        },
        onError: handlePaymentError,
      });

      const venmoBtn = venmoBtnRef.current;
      if (venmoBtn) {
        venmoBtn.onclick = async () => {
          setError("");
          setPendingMessage("");
          try {
            await venmoSession.start({ presentationMode: "auto" }, createOrder());
          } catch (err: any) {
            handlePaymentError(err);
          }
        };
      }
    }
  }, [createOrder, handleCapture]);

  useEffect(() => {
    let mounted = true;

    async function initSdk() {
      try {
        await loadPayPalSdkScript();
        if (!window.paypal?.createInstance) {
          console.error("window.paypal.createInstance not available");
          return;
        }

        const sdkInstance = await window.paypal.createInstance({
          clientId,
          components: ["paypal-payments", "venmo-payments", "paypal-messages"],
          pageType: "checkout",
        });

        if (!mounted) return;
        sdkInstanceRef.current = sdkInstance;

        // Pay Later promotional messaging
        if (typeof sdkInstance.createPayPalMessages === "function") {
          sdkInstance.createPayPalMessages();
        }

        // Eligibility check
        let venmoEligible = false;
        try {
          const methods = await sdkInstance.findEligibleMethods({ currencyCode: "USD" });
          if (methods?.isEligible && typeof methods.isEligible === "function") {
            venmoEligible = methods.isEligible("venmo");
          }
        } catch (e) {
          console.warn("Eligibility check failed:", e);
        }

        if (mounted) {
          setIsVenmoEligible(venmoEligible);
          setIsSdkReady(true);
        }
      } catch (err: any) {
        console.error("Failed to initialize PayPal SDK v6:", err);
        if (mounted) {
          setError("Failed to load payment options. Please try again.");
        }
      }
    }

    initSdk();

    return () => {
      mounted = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (isSdkReady) {
      initSessions();
    }
  }, [isSdkReady, initSessions]);

  const handleTryAgain = () => {
    setError("");
    setPendingMessage("");
    initSessions();
  };

  return (
    <div className="paypal-buttons-wrapper" style={{ width: "100%", maxWidth: 350 }}>
      <div id="paypal-button-container" style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <paypal-button
          ref={paypalBtnRef}
          type="pay"
          class="paypal-gold"
          style={{ display: "block", width: "100%", minHeight: 44 }}
        />
        <venmo-button
          ref={venmoBtnRef}
          type="pay"
          class="venmo-blue"
          style={{ display: isVenmoEligible ? "block" : "none", width: "100%", minHeight: 44 }}
        />
      </div>

      {pendingMessage && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: "12px 14px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "10px",
            color: "#92400e",
          }}
        >
          <p style={{ margin: 0, fontWeight: 500 }}>{pendingMessage}</p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "12px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            color: "var(--berry)",
          }}
        >
          <p style={{ margin: "0 0 8px 0", fontWeight: 500 }}>{error}</p>
          <button
            type="button"
            className="button ghost"
            style={{ padding: "6px 14px", fontSize: "0.85rem" }}
            onClick={handleTryAgain}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
