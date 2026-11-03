"use client";

import { useEffect, useRef } from "react";

export function PayPalMessage({
  clientId,
  amount,
  pageType = "product-details",
}: {
  clientId: string;
  amount: string;
  pageType?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let mounted = true;

    async function initMessages() {
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
          await new Promise<void>((resolve) => {
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
            setTimeout(() => {
              clearInterval(timer);
              resolve();
            }, 5000);
          });
        }

        if (!mounted || !window.paypal?.createInstance) return;

        let instance = window.__paypalMessageInstance;
        if (!instance) {
          instance = await window.paypal.createInstance({
            clientId,
            components: ["paypal-messages"],
            pageType,
          });
          window.__paypalMessageInstance = instance;
        }

        if (instance?.createPayPalMessages) {
          instance.createPayPalMessages();
        }

        if (ref.current && (ref.current as any).amount !== amount) {
          (ref.current as any).amount = amount;
        }
      } catch (err) {
        console.error("PayPalMessage init error:", err);
      }
    }

    initMessages();

    return () => {
      mounted = false;
    };
  }, [clientId, amount, pageType]);

  return (
    <div style={{ margin: "10px 0" }}>
      <paypal-message
        ref={ref}
        auto-bootstrap
        amount={amount}
        currency-code="USD"
      />
    </div>
  );
}
