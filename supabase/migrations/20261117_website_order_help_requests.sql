-- Run once as the database owner in the Supabase SQL Editor.
-- Separate from order snapshots and shipment state; never changes fulfilment.
BEGIN;

CREATE TABLE public.website_order_help_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.website_orders(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    topic text NOT NULL CHECK (topic IN ('delivery', 'payment', 'changes', 'cancellation', 'other')),
    message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 3000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX website_order_help_requests_created_idx
    ON public.website_order_help_requests (created_at DESC, id DESC);
CREATE INDEX website_order_help_requests_order_idx ON public.website_order_help_requests (order_id);
CREATE INDEX website_order_help_requests_user_idx ON public.website_order_help_requests (user_id);

COMMENT ON TABLE public.website_order_help_requests IS
    'Private customer order help tickets. Backend verifies order ownership on create and trusted staff access on read/update. UUIDs make submission retries idempotent.';

ALTER TABLE public.website_order_help_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_order_help_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.website_order_help_requests TO service_role;

-- A database timestamp prevents two staff members from overwriting each other's updates.
CREATE FUNCTION public.touch_website_order_help_request()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_website_order_help_request() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER website_order_help_request_updated
    BEFORE UPDATE ON public.website_order_help_requests
    FOR EACH ROW EXECUTE FUNCTION public.touch_website_order_help_request();

NOTIFY pgrst, 'reload schema';
COMMIT;
