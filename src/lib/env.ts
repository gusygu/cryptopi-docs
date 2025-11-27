// src/lib/env.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  // Exchange credentials (optional for local dev; required when jobs run)
  EXCHANGE_API_KEY: z.string().optional(),
  EXCHANGE_API_SECRET: z.string().optional(),
});

type Env = z.infer<typeof EnvSchema>;

function readEnv(): Env {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    BASE_URL: process.env.BASE_URL,
    EXCHANGE_API_KEY: process.env.EXCHANGE_API_KEY,
    EXCHANGE_API_SECRET: process.env.EXCHANGE_API_SECRET,
  });

  if (!parsed.success) {
    // Print a friendly message and fail fast
     
    console.error('❌ Invalid environment:\n', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment. Check your .env.local / deployment secrets.');
  }
  return parsed.data;
}

export const ENV = readEnv();

export const isProd = ENV.NODE_ENV === 'production';
export const isDev  = ENV.NODE_ENV === 'development';
