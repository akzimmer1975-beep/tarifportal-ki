import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { chatRouter } from "./routes/chat.js";
import { logger } from "./logger.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120
    })
  );

  app.use(
    pinoHttp({
      logger
    })
  );

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      name: "Tarif_KI Backend",
      endpoints: [
        "/health",
        "/api/auth/status",
        "/api/admin/scan",
        "/api/admin/ingest",
        "/api/chat"
      ]
    });
  });

  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/chat", chatRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(err);
    res.status(500).json({
      ok: false,
      error: "internal_server_error",
      message: err?.message ?? "Unknown error"
    });
  });

  return app;
}