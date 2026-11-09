import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        type?: string;
        class?: string;
        ref?: any;
      };
      "venmo-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        type?: string;
        class?: string;
        ref?: any;
      };
      "paypal-message": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "auto-bootstrap"?: boolean | string;
        amount?: string | number;
        "currency-code"?: string;
        ref?: any;
      };
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        type?: string;
        class?: string;
        ref?: any;
      };
      "venmo-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        type?: string;
        class?: string;
        ref?: any;
      };
      "paypal-message": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "auto-bootstrap"?: boolean | string;
        amount?: string | number;
        "currency-code"?: string;
        ref?: any;
      };
    }
  }

  interface Window {
    paypal?: {
      createInstance: (config: {
        clientId?: string;
        clientToken?: string;
        components: string[];
        pageType?: string;
        locale?: string;
        merchantId?: string;
      }) => Promise<any>;
    };
  }
}
