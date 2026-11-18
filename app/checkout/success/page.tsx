import type { Metadata } from "next";
import PaymentResult from "@/components/checkout/PaymentResult";

export const metadata: Metadata = {
  title: "Payment status",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface PageProps {
  searchParams: Promise<{ payment_id?: string; order_id?: string; pending?: string }>;
}

export default async function CheckoutSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <PaymentResult outcome="success" orderId={params.order_id} paymentId={params.payment_id} />;
}
