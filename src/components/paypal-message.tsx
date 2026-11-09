"use client";

import { useEffect, useRef } from "react";
import { getPayPalSdkInstance } from "@/lib/paypal-sdk";

export function PayPalMessage({
  amount,
  clientId,
}: {
  amount: string | number;
  clientId: string;
}) {
  const messageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sdkInstance = await getPayPalSdkInstance(clientId);
        if (!mounted) return;
        if (typeof sdkInstance.createPayPalMessages === "function") {
          sdkInstance.createPayPalMessages();
        }
      } catch (err) {
        console.error("Failed to initialize PayPal messages:", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [clientId]);

  useEffect(() => {
    if (messageRef.current) {
      messageRef.current.setAttribute("auto-bootstrap", "");
      (messageRef.current as any).amount = String(amount);
    }
  }, [amount]);

  return (
    <div className="paypal-message-wrapper" style={{ margin: "8px 0" }}>
      <paypal-message
        ref={messageRef}
        {...({ "auto-bootstrap": true } as any)}
        amount={String(amount)}
        currency-code="USD"
      />
    </div>
  );
}
