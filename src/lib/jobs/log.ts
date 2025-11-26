import { sql } from "@/core/db/db";

export type JobRunOpts = {
  jobName: string;
  jobType?: string;
  meta?: Record<string, unknown>;
};

export async function startJobRun(opts: JobRunOpts) {
  const startedAt = new Date();
  const [row] = await sql`
    INSERT INTO ops.job_run (job_name, job_type, status, started_at, meta)
    VALUES (${opts.jobName}, ${opts.jobType ?? null}, 'running', ${startedAt}, ${opts.meta ?? {}})
    RETURNING run_id, started_at
  `;

  return {
    runId: row.run_id as string,
    startedAt: new Date(row.started_at),
  };
}

export async function finishJobRun(
  runId: string,
  status: "success" | "error" | "skipped",
  error?: unknown
) {
  const finishedAt = new Date();
  let message: string | null = null;
  let stack: string | null = null;

  if (error instanceof Error) {
    message = error.message;
    stack = error.stack ?? null;
  } else if (error != null) {
    message = String(error);
  }

  await sql`
    UPDATE ops.job_run
    SET
      status = ${status}::ops.job_status,
      finished_at = ${finishedAt},
      duration_ms = CASE
        WHEN started_at IS NOT NULL THEN
          EXTRACT(EPOCH FROM (${finishedAt} - started_at)) * 1000
        ELSE NULL
      END,
      error_message = COALESCE(${message}, error_message),
      error_stack = COALESCE(${stack}, error_stack)
    WHERE run_id = ${runId}
  `;
}

/**
 * Convenience wrapper for jobs: runs fn and logs start/finish.
 */
export async function withJobRun<T>(
  opts: JobRunOpts,
  fn: () => Promise<T>
): Promise<T> {
  const { runId } = await startJobRun(opts);
  try {
    const result = await fn();
    await finishJobRun(runId, "success");
    return result;
  } catch (err) {
    await finishJobRun(runId, "error", err);
    throw err;
  }
}
