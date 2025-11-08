CREATE OR REPLACE FUNCTION public.ensure_app_session(p_app_session_id text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO app_sessions(app_session_id) VALUES (p_app_session_id)
  ON CONFLICT (app_session_id) DO NOTHING;
$$;
  

  CREATE OR REPLACE FUNCTION public.upsert_app_session_settings(
  p_app_session_id text,
  p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_app_session(p_app_session_id);

  INSERT INTO public.app_session_settings(app_session_id, payload)
  VALUES (p_app_session_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (app_session_id) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = now();
END$$;
