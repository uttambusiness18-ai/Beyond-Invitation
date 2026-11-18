import type { Metadata } from "next";
import PaymentResult from "@/components/checkout/PaymentResult";

export const metadata: Metadata = {
  title: "Payment not completed",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface PageProps {
  searchParams: Promise<{ payment_id?: string; order_id?: string }>;
}

export default async function CheckoutFailedPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <PaymentResult outcome="failed" orderId={params.order_id} paymentId={params.payment_id} />;
}
