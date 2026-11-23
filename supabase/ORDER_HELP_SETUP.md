# Order help requests

Apply `migrations/20261117_website_order_help_requests.sql` once in the Supabase SQL Editor for the project configured by `NEXT_PUBLIC_SUPABASE_URL`. It creates a private support table and indexes; it does not modify orders, payments, or shipping addresses.

The existing `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is used only on the server. A public Supabase API key or service key cannot create the table through the REST API; database-owner SQL access or a connected Supabase management integration is needed to apply the migration.

Customers use **Need help with an order?** on the account orders page. They choose one of their orders, a topic, and enter a message. The server checks the signed-in user and order ownership, then saves the request. A success receipt is shown only after Supabase confirms the write. Repeating the same submission after a network failure returns the existing ticket.

Open **Order help** in the admin sidebar at `/admin/order-help`. The inbox shows the customer contact details saved on the order, its reference, topic, message, timestamps, and status. Requests can be marked Open, In progress, or Resolved. Search and status filters apply to loaded requests; **Load more** retrieves older tickets.

The admin inbox and status-update API do not require staff sign-in. Anyone who can reach these routes can view requests and customer contact details and change request statuses. Updates still require a same-origin request, a valid status, and the current `updated_at` value to prevent overwriting a newer change. Since edits have no authenticated staff identity, `updated_by` is cleared to `null`. All ticket endpoints disable caching, and direct anonymous/authenticated Supabase table access remains revoked; the backend uses the service role. Customer submissions still require sign-in and order ownership. Shipping actions retain their separate staff access checks.

No additional database migration is needed to remove the admin sign-in requirement: `updated_by` is already nullable. The original migration's table comment describes the access policy at creation time; the current backend access policy is documented here.

No email is sent automatically. Contact details are shown in the inbox for follow-up; a cancellation topic does not cancel the order itself.

Verification after applying the migration:

1. Sign in as a customer with an order, open the help form, and submit a real help request.
2. While signed out, open `/admin/order-help` and verify the order, topic, and message.
3. Change its status and refresh to confirm the saved status.
4. Check that a non-staff account can also load the inbox, an unsigned customer cannot submit a ticket, and a customer cannot submit a ticket for another customer's order.

If the migration is missing, the form retains the draft and shows a retryable error instead of claiming it saved.
