// src/pages/api/poller/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerPoller } from "@/core/poller";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const poller = await getServerPoller();     // boots singleton if needed
  // @ts-expect-error: Next's res is compatible with Node's ServerResponse
  return poller.sseHandler(req, res);
}

export const config = {
  api: { bodyParser: false }, // SSE
};
