import type React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: string;
          class?: string;
          hidden?: boolean;
        },
        HTMLElement
      >;
      "venmo-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: string;
          class?: string;
          hidden?: boolean;
        },
        HTMLElement
      >;
      "paypal-message": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "auto-bootstrap"?: boolean;
          amount?: string | number;
          "currency-code"?: string;
        },
        HTMLElement
      >;
    }
  }

  namespace React.JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: string;
          class?: string;
          hidden?: boolean;
        },
        HTMLElement
      >;
      "venmo-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          type?: string;
          class?: string;
          hidden?: boolean;
        },
        HTMLElement
      >;
      "paypal-message": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "auto-bootstrap"?: boolean;
          amount?: string | number;
          "currency-code"?: string;
        },
        HTMLElement
      >;
    }
  }

  interface Window {
    paypal?: any;
    __paypalSdkInstance?: any;
    __paypalMessageInstance?: any;
  }
}

export {};
