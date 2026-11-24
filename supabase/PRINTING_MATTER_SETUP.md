# Printing matter uploads

Customers can attach printing matter to a **paid** website order from its confirmation page or My Account. This is an upload and review handoff; it does not approve artwork, purchase printing, change a payment, or start production.

## Setup

1. Apply `supabase/migrations/20261124_website_order_printing_files.sql` as the database owner in the same Supabase project as `website_orders`.
2. Keep the existing server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` configured. The browser never receives this key.
3. Staff use the existing admin role or `ADMIN_USER_IDS` allowlist. The new printing-file list and download endpoints always require staff access, even where the surrounding order dashboard currently permits viewing without sign-in.
4. Deploy the application and check the flows below. The feature shows a recoverable unavailable message until its database migration and private bucket are installed.

The migration creates `public.website_order_printing_files`, two service-role-only reservation/completion functions, and a **private** `website_order_printing` Storage bucket. It does not make other buckets private. A restrictive Storage policy prevents normal anonymous/authenticated clients from reading or writing this bucket even if older, broad policies exist.

## Files and access

- PDF, Word `.docx`, JPG/JPEG and PNG, up to **20 MB each**, with up to **10 submitted files or active upload reservations per order**. Export other design formats to PDF first.
- Each submission has optional instructions of up to 2,000 characters. Files are attached to the whole order; customers should identify the relevant design or insert in those instructions when needed.
- Existing submissions remain as history. A correction is a new upload, not an overwrite or automatic approval. Staff should confirm the final printing matter with the customer.
- Signed-in customers must own the order by `user_id`. Guest access requires the receipt capability from checkout. A courier tracking token, order ID, customer email or phone alone does not grant access.
- Staff and customers obtain attachment download URLs that expire after 60 seconds. Paths and raw storage metadata are never returned in file lists. Do not persist or share those URLs.
- Upload URLs are issued only after server authorization, point to a server-generated immutable path, and do not allow overwrites. They expire after two hours, as documented by [Supabase](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
- Files upload directly to Storage so they do not pass through the hosting platform's request-body limit. Only small JSON requests reach the Next.js API.
- Completion checks actual Storage size, MIME type and downloaded bytes. Word documents must have the expected bounded ZIP structure and document content type, without macro entries. These are file-type checks, not a malware-scanning service or print-quality assessment. Files are served as downloads rather than embedded previews.

## Reservation cleanup

An abandoned, cancelled or rejected upload remains a reservation until **two hours and five minutes after preparation**. A signed upload URL cannot be revoked, so immediately freeing the slot would let a client reuse that URL outside the quota. Completed files continue to count permanently.

Before preparing another upload for the same order, the server removes up to 50 expired non-completed objects through the Storage API, then removes their metadata rows only after successful Storage cleanup. Failed cleanup is retried during a later preparation. Never delete entries directly from `storage.objects`; that does not remove the underlying file.

Orders with no subsequent upload attempt may retain expired objects. For periodic maintenance, use an administrative server script that reads `website_order_printing_files` where `state <> 'ready' AND expires_at < now()`, removes the paths with `storage.from('website_order_printing').remove(paths)`, and only then deletes those same expired metadata rows. Apply the same procedure before permanently deleting an order; the foreign-key cascade does not remove Storage objects. No cleanup scheduler is installed by this feature.

## Verification

- On a paid order, upload a supported file from confirmation; reload and confirm its name, instructions and submitted time remain visible. Download it and compare its contents.
- Repeat through My Account. A guest receipt link should work without account creation.
- Confirm that a different account, a tracking-only token and an unpaid order cannot list, upload or download files.
- Staff can retrieve the same attachment from `/admin/orders`. An anonymous user or non-staff account cannot use either new admin endpoint.
- Reject files over 20 MB, empty files, renamed executables/ZIP archives, corrupted signatures and macro-enabled Word documents.
- Retry completion after a dropped response; it must return the original file instead of creating another submission. Cancellation must never delete a completed file.
- Submit concurrent preparations: the database serializes quota changes and permits at most 10 submitted/active reservations. Expired or cancelled uploads cannot later be completed.

No migration or real customer-file upload is performed by the automated tests. The migration can be exercised in an isolated PostgreSQL-compatible test database; the Node tests stub external services.
