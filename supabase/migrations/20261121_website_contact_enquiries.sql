-- Run once as the database owner in the Supabase SQL Editor.
BEGIN;

CREATE TABLE public.website_contact_enquiries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    mobile text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
    source text NOT NULL DEFAULT 'Website' CHECK (source = 'Website'),
    requirement text NOT NULL CHECK (requirement IN ('Wedding Cards', 'Sagun Envelopes', 'Rakhi Packaging Item')),
    sub_requirement text NOT NULL DEFAULT '',
    quantity bigint CHECK (quantity BETWEEN 1 AND 1000000000),
    event_date date,
    budget_per_unit numeric(15,2) CHECK (budget_per_unit BETWEEN 0 AND 1000000000000),
    total_budget numeric(15,2) CHECK (total_budget BETWEEN 0 AND 1000000000000),
    message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT website_contact_enquiry_card_type CHECK (
      (requirement = 'Wedding Cards' AND sub_requirement IN ('None Of The Above', 'Hindu Wedding Cards', 'Muslim Wedding Cards', 'Christian Wedding Cards', 'General Wedding Cards'))
      OR (requirement <> 'Wedding Cards' AND sub_requirement = '')
    )
);

CREATE INDEX website_contact_enquiries_created_idx
    ON public.website_contact_enquiries (created_at DESC, id DESC);

COMMENT ON TABLE public.website_contact_enquiries IS
    'Server-managed contact-page submissions. Backend validates writes and serves the admin inbox without sign-in. Request UUIDs make retries idempotent.';

ALTER TABLE public.website_contact_enquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_contact_enquiries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.website_contact_enquiries TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
