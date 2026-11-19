/** Customer-facing order details; internal payment and fulfillment metadata is excluded. */
export interface PaymentReceipt {
  id: string;
  createdAt: string;
  paidAt: string | null;
  paymentStatus: "pending" | "paid";
  paymentId: string | null;
  gatewayOrderId: string | null;
  currency: string;
  amountPaise: number;
  subtotalPaise: number;
  shippingPaise: number | null;
  items: Array<{
    itemCode: string;
    name: string;
    quantity: number;
    unitPricePaise: number;
    totalPaise: number;
  }>;
  customer: { name: string; email: string; phone: string };
  address: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  notes: string;
  shipping: { service: string; courierName: string | null; estimatedDeliveryDays: number | null };
  testMode: boolean;
}
