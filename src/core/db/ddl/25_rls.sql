BEGIN;

-- Utility guard to avoid repeated statements in case tables move
DO $$
DECLARE dummy int;
BEGIN
  PERFORM 1;
END$$;

-- Audit tables RLS
ALTER TABLE audit.user_cycle_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_user_cycle_owner ON audit.user_cycle_log;
CREATE POLICY audit_user_cycle_owner ON audit.user_cycle_log
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_user_cycle_admin ON audit.user_cycle_log;
CREATE POLICY audit_user_cycle_admin ON audit.user_cycle_log
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.str_sampling_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_sampling_owner ON audit.str_sampling_log;
CREATE POLICY audit_sampling_owner ON audit.str_sampling_log
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_sampling_admin ON audit.str_sampling_log;
CREATE POLICY audit_sampling_admin ON audit.str_sampling_log
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.user_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_reports_owner ON audit.user_reports;
CREATE POLICY audit_reports_owner ON audit.user_reports
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_reports_admin ON audit.user_reports;
CREATE POLICY audit_reports_admin ON audit.user_reports
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.error_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_errors_owner ON audit.error_queue;
CREATE POLICY audit_errors_owner ON audit.error_queue
  FOR SELECT USING (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_errors_admin ON audit.error_queue;
CREATE POLICY audit_errors_admin ON audit.error_queue
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.vitals_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_vitals_admin ON audit.vitals_log;
CREATE POLICY audit_vitals_admin ON audit.vitals_log
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- Cin-aux session RLS
ALTER TABLE cin_aux.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_sessions_owner ON cin_aux.sessions;
CREATE POLICY cin_sessions_owner ON cin_aux.sessions
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_sessions_admin ON cin_aux.sessions;
CREATE POLICY cin_sessions_admin ON cin_aux.sessions
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_session_owner ON cin_aux.rt_session;
CREATE POLICY cin_rt_session_owner ON cin_aux.rt_session
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_session_admin ON cin_aux.rt_session;
CREATE POLICY cin_rt_session_admin ON cin_aux.rt_session
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- Helper condition referencing rt_session ownership
CREATE OR REPLACE FUNCTION cin_aux._owns_rt_session(p_session_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cin_aux.rt_session s
    WHERE s.session_id = p_session_id
      AND (s.owner_user_id = auth.current_user_id() OR auth.current_is_admin())
  );
$$;

ALTER TABLE cin_aux.rt_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_balance_owner ON cin_aux.rt_balance;
CREATE POLICY cin_rt_balance_owner ON cin_aux.rt_balance
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_reference_owner ON cin_aux.rt_reference;
CREATE POLICY cin_rt_reference_owner ON cin_aux.rt_reference
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_lot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_lot_owner ON cin_aux.rt_lot;
CREATE POLICY cin_rt_lot_owner ON cin_aux.rt_lot
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_move ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_move_owner ON cin_aux.rt_move;
CREATE POLICY cin_rt_move_owner ON cin_aux.rt_move
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_move_lotlink ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_move_lotlink_owner ON cin_aux.rt_move_lotlink;
CREATE POLICY cin_rt_move_lotlink_owner ON cin_aux.rt_move_lotlink
  FOR ALL
  USING (
    cin_aux._owns_rt_session(
      (SELECT m.session_id FROM cin_aux.rt_move m WHERE m.move_id = cin_aux.rt_move_lotlink.move_id)
    )
  )
  WITH CHECK (
    cin_aux._owns_rt_session(
      (SELECT m.session_id FROM cin_aux.rt_move m WHERE m.move_id = cin_aux.rt_move_lotlink.move_id)
    )
  );

ALTER TABLE cin_aux.rt_mark ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_mark_owner ON cin_aux.rt_mark;
CREATE POLICY cin_rt_mark_owner ON cin_aux.rt_mark
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_imprint_luggage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_imprint_owner ON cin_aux.rt_imprint_luggage;
CREATE POLICY cin_rt_imprint_owner ON cin_aux.rt_imprint_luggage
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

COMMIT;
