// src/core/pipeline/client.ts
import { buildLatestPayload, type BuildLatestPayloadOptions, type MatricesLatestPayload } from "lab/legacy/matricesLatest";

export async function getLatestMatrices(options: BuildLatestPayloadOptions): Promise<MatricesLatestPayload> {
  return buildLatestPayload(options);
}
