import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3005),
  NODE_ENV: z.string().default("development"),
  ADMIN_API_KEY: z.string().default("change-me"),
  CLIENT_ID: z.string().default(""),
  TENANT_ID: z.string().default("common"),
  DATABASE_URL: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  TARIFPORTAL_ROOT_PATH: z.string().default("/Tarifportal"),
  MSAL_CACHE_PATH: z.string().default(".msal-cache.json")
});

export const config = envSchema.parse(process.env);