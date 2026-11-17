export const ORDER_HELP_TOPICS = [
  { value: "delivery", label: "Delivery or tracking" },
  { value: "payment", label: "Payment or refund" },
  { value: "changes", label: "Change my order" },
  { value: "cancellation", label: "Cancel my order" },
  { value: "other", label: "Something else" },
] as const;

export type OrderHelpTopic = (typeof ORDER_HELP_TOPICS)[number]["value"];

export const ORDER_HELP_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
] as const;

export type OrderHelpStatus = (typeof ORDER_HELP_STATUSES)[number]["value"];

export type OrderHelpRequest = {
  id: string;
  orderId: string;
  topic: OrderHelpTopic;
  message: string;
  status: OrderHelpStatus;
  createdAt: string;
  updatedAt: string;
};

export type OrderHelpAdminRequest = OrderHelpRequest & {
  orderReference: string;
  customer: { name: string; email: string; phone: string };
};
