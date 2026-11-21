# Contact enquiries

Apply `migrations/20261121_website_contact_enquiries.sql` once in the Supabase SQL Editor before deploying this feature. The server uses the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`).

The contact form saves its complete submission in `website_contact_enquiries`: name, mobile, email, website source, requirement, card type, quantity, event date, budget per piece, total budget, message (including any selected design details), and submission timestamp. A request UUID makes retries return the original receipt. Blank optional fields remain blank or null, and an entered zero budget remains zero.

Open **Contact enquiries** in the admin sidebar at `/admin/contact-enquiries` without signing in. The inbox lists newest submissions first and loads older entries in pages. `GET /api/admin/contact-enquiries` does not require a session or staff role, matching the item dashboard's deferred authentication. Anyone with the page or API URL can read the complete submitted details. Direct Supabase access remains restricted to the server key; no public RLS policies are created.

ERPNext is optional. When `ERPNEXT_URL`, `ERPNEXT_API_KEY`, and `ERPNEXT_API_SECRET` are configured, newly saved submissions are forwarded once using the existing `ERPNEXT_LEAD_*` field mappings. ERP errors or timeouts never discard the saved enquiry or return a false failure to the customer. Forwarding is best effort, with a five-second timeout and no automatic retry; the admin inbox remains the durable record.

Older submissions previously stored only in ERPNext are not copied automatically. The previous integration did not persist the website source, so importing history requires identifying the correct website records before inserting them into this table. This feature starts capturing submissions after the migration and application changes are deployed.

## Verification

1. Submit a contact enquiry with optional details and verify the success state.
2. Open `/admin/contact-enquiries` while signed out; verify every submitted field and the timestamp without a sign-in prompt.
3. Retry the same request UUID and body; verify only one row exists.
4. Verify that `GET /api/admin/contact-enquiries` returns submissions without session cookies and retains its no-store headers.
