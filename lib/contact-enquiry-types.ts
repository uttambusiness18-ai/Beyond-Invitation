export type ContactEnquiry = {
  id: string;
  name: string;
  mobile: string;
  email: string;
  source: string;
  requirement: string;
  subRequirement: string;
  quantity: number | null;
  eventDate: string;
  budgetPerUnit: number | null;
  totalBudget: number | null;
  message: string;
  createdAt: string;
};

export type ContactEnquiryPage = {
  enquiries: ContactEnquiry[];
  nextCursor: string | null;
};
