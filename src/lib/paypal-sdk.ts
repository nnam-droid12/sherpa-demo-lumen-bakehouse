export function loadPayPalSdkScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  if (window.paypal) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.sandbox.paypal.com/web-sdk/v6/core"]'
    );
    if (!script) {
      script = document.createElement("script");
      script.async = true;
      script.src = "https://www.sandbox.paypal.com/web-sdk/v6/core";
      document.head.appendChild(script);
    }

    if (window.paypal) {
      resolve();
      return;
    }

    script.addEventListener("load", () => resolve());
    script.addEventListener("error", reject);
  });
}

let cachedInstancePromise: Promise<any> | null = null;
let cachedClientId: string | null = null;

export async function getPayPalSdkInstance(clientId: string) {
  if (cachedInstancePromise && cachedClientId === clientId) {
    return cachedInstancePromise;
  }
  cachedClientId = clientId;
  cachedInstancePromise = (async () => {
    await loadPayPalSdkScript();
    if (!window.paypal?.createInstance) {
      throw new Error("PayPal JS SDK v6 not available on window.paypal");
    }
    const instance = await window.paypal.createInstance({
      clientId,
      components: ["paypal-payments", "venmo-payments", "paypal-messages"],
      pageType: "checkout",
    });
    return instance;
  })();
  return cachedInstancePromise;
}
