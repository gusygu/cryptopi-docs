-- job_matrices_synthetic_cycle.sql
BEGIN;
WITH r AS (
  INSERT INTO cin_aux.mat_registry(mat_id, session_id, name, window_label, bins)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'id_pct', '1h', 48)
  RETURNING mat_id
)
INSERT INTO cin_aux.mat_cell(mat_id, i, j, v)
SELECT mat_id, i, j, v
FROM r, (VALUES (1,1,0.0),(1,2,0.1),(2,1,-0.1),(2,2,0.0)) x(i,j,v);
COMMIT;
