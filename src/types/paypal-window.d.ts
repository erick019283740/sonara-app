export {};

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: {
        style?: { layout?: string; shape?: string; label?: string };
        createOrder?: () => Promise<string>;
        onApprove?: (data: { orderID: string }) => Promise<void>;
        onCancel?: () => void;
        onError?: (err: unknown) => void;
      }) => {
        render: (target: HTMLElement | string) => Promise<void>;
      };
    };
  }
}
