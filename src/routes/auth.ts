import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  beginDeviceCodeLogin,
  finishDeviceCodeLogin,
  getAuthStatus,
  clearAuthCache
} from "../services/graphAuth.js";
import { getMe, getTarifportalRoot, listTarifportalChildren } from "../services/graphDrive.js";

const router = Router();

router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const status = await getAuthStatus();
    res.json({ ok: true, ...status });
  })
);

router.get(
  "/device/start",
  asyncHandler(async (_req, res) => {
    const device = await beginDeviceCodeLogin();
    res.json({
      ok: true,
      step: "open_verification_uri_and_enter_code",
      device
    });
  })
);

router.get(
  "/device/finish",
  asyncHandler(async (_req, res) => {
    const result = await finishDeviceCodeLogin();
    res.json({
      ok: true,
      message: "Microsoft-Login erfolgreich abgeschlossen.",
      account: result
    });
  })
);

router.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    await clearAuthCache();
    res.json({ ok: true, message: "Lokaler MSAL-Cache gelöscht." });
  })
);

router.get(
  "/me",
  asyncHandler(async (_req, res) => {
    const me = await getMe();
    res.json({ ok: true, me });
  })
);

router.get(
  "/tarifportal",
  asyncHandler(async (_req, res) => {
    const root = await getTarifportalRoot();
    const children = await listTarifportalChildren();

    res.json({
      ok: true,
      root,
      children
    });
  })
);

export default router;