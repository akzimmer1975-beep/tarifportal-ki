import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import adminRouter from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import documentsRouter from "./routes/documents.js";
import searchRouter from "./routes/search.js";
import { chatRouter } from "./routes/chat.js";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", searchRouter);
app.use("/api/chat", chatRouter);

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "tarifportal-api",
    timestamp: new Date().toISOString()
  });
});

app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    name: "Tarifportal API",
    endpoints: {
      health: "/health",
      auth: "/api/auth",
      admin: "/api/admin",
      documents: "/api/documents",
      chat: "/api/chat"
    }
  });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/documents", documentsRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: "not_found"
  });
});

app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);

    const message =
      err instanceof Error ? err.message : "Internal server error";

    res.status(500).json({
      ok: false,
      error: message
    });
  }
);

const port = Number(process.env.PORT || 3005);

app.listen(port, () => {
  console.log(`Tarifportal API listening on http://localhost:${port}`);
});