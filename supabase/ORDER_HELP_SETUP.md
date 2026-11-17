# Order help requests

Apply `migrations/20261117_website_order_help_requests.sql` once in the Supabase SQL Editor for the project configured by `NEXT_PUBLIC_SUPABASE_URL`. It creates a private support table and indexes; it does not modify orders, payments, or shipping addresses.

The existing `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is used only on the server. A public Supabase API key or service key cannot create the table through the REST API; database-owner SQL access or a connected Supabase management integration is needed to apply the migration.

Customers use **Need help with an order?** on the account orders page. They choose one of their orders, a topic, and enter a message. The server checks the signed-in user and order ownership, then saves the request. A success receipt is shown only after Supabase confirms the write. Repeating the same submission after a network failure returns the existing ticket.

Staff access **Order help** in the admin sidebar at `/admin/order-help`. The inbox shows the customer contact details saved on the order, its reference, topic, message, timestamps, and status. Staff can mark a request Open, In progress, or Resolved. Search and status filters apply to loaded requests; **Load more** retrieves older tickets.

Staff must sign in with either trusted `app_metadata.role = 'admin'` or a user UUID listed in the server-only `ADMIN_USER_IDS` environment variable, matching the shipping admin access rules. Customer-editable profile metadata never grants access. All ticket endpoints disable caching and direct anonymous/authenticated table access is revoked. The new inbox is private even if existing admin catalogue/order pages are public.

No email is sent automatically. Contact details are shown to staff for follow-up; a cancellation topic does not cancel the order itself.

Verification after applying the migration:

1. Sign in as a customer with an order, open the help form, and submit a real help request.
2. Sign in as staff, open `/admin/order-help`, and verify the order, topic, and message.
3. Change its status and refresh to confirm the saved status.
4. Check that a non-staff account cannot load the inbox and an unsigned request cannot submit a ticket.

If the migration is missing, the form retains the draft and shows a retryable error instead of claiming it saved.
