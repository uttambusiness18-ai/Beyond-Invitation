-- Apply as the database owner. Files stay private and never change payment or print approval.
BEGIN;

CREATE TABLE public.website_order_printing_files (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.website_orders(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  content_type text NOT NULL CHECK (content_type IN (
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png'
  )),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'cancelled', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '2 hours 5 minutes'),
  CHECK ((state = 'ready') = (completed_at IS NOT NULL)),
  CHECK (storage_path LIKE order_id::text || '/' || id::text || '.%')
);
CREATE INDEX website_order_printing_files_order_idx ON public.website_order_printing_files(order_id, created_at DESC);
CREATE INDEX website_order_printing_files_expiry_idx ON public.website_order_printing_files(expires_at) WHERE state <> 'ready';
ALTER TABLE public.website_order_printing_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_order_printing_files FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_order_printing_files TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('website_order_printing', 'website_order_printing', false, 20971520, ARRAY[
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'
]) ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A restrictive guard also protects this bucket if other app buckets have broad policies.
CREATE POLICY website_order_printing_private ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (bucket_id <> 'website_order_printing')
  WITH CHECK (bucket_id <> 'website_order_printing');

CREATE FUNCTION public.reserve_website_order_printing_file(
  p_order_id uuid, p_file_id uuid, p_storage_path text, p_file_name text,
  p_size_bytes integer, p_content_type text, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved public.website_order_printing_files;
BEGIN
  -- All quota-changing functions take the same order lock, including completion.
  PERFORM 1 FROM public.website_orders WHERE id = p_order_id AND payment_status = 'paid' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_PAID' USING ERRCODE = 'P0001'; END IF;
  -- Cancelled/rejected URLs remain usable until expiry: keep their reservation too.
  IF (SELECT count(*) FROM public.website_order_printing_files
      WHERE order_id = p_order_id AND (state = 'ready' OR expires_at > clock_timestamp())) >= 10 THEN
    RAISE EXCEPTION 'PRINTING_FILE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.website_order_printing_files (id, order_id, storage_path, file_name, size_bytes, content_type, notes)
  VALUES (p_file_id, p_order_id, p_storage_path, p_file_name, p_size_bytes, p_content_type, p_notes)
  RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;

CREATE FUNCTION public.complete_website_order_printing_file(p_order_id uuid, p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved public.website_order_printing_files;
BEGIN
  PERFORM 1 FROM public.website_orders WHERE id = p_order_id AND payment_status = 'paid' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_PAID' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO saved FROM public.website_order_printing_files
    WHERE id = p_file_id AND order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRINTING_FILE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF saved.state = 'ready' THEN RETURN to_jsonb(saved); END IF;
  IF saved.state <> 'pending' OR saved.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'PRINTING_UPLOAD_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.website_order_printing_files SET state = 'ready', completed_at = clock_timestamp()
    WHERE id = p_file_id RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_website_order_printing_file(uuid, uuid, text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_website_order_printing_file(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_website_order_printing_file(uuid, uuid, text, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_website_order_printing_file(uuid, uuid) TO service_role;
COMMENT ON TABLE public.website_order_printing_files IS 'Private customer artwork, accepted only after content checks. Ready files are immutable upload history, not print approvals. Pending URL reservations remain counted through signed-upload expiry.';
NOTIFY pgrst, 'reload schema';
COMMIT;
