import fs from "fs/promises";
import path from "path";
import { PublicClientApplication, type AccountInfo } from "@azure/msal-node";
import { config } from "../config.js";

const cachePath = path.resolve(process.cwd(), config.MSAL_CACHE_PATH);

const pca = new PublicClientApplication({
  auth: {
    clientId: config.CLIENT_ID,
    authority: `https://login.microsoftonline.com/${config.TENANT_ID}`
  }
});

let initialized = false;
let pendingLoginPromise: Promise<any> | null = null;

type LastDeviceCode = {
  userCode: string;
  verificationUri: string;
  expiresOn?: string;
  message: string;
};

let lastDeviceCode: LastDeviceCode | null = null;

async function ensureCacheLoaded() {
  if (initialized) return;

  try {
    const raw = await fs.readFile(cachePath, "utf8");
    pca.getTokenCache().deserialize(raw);
  } catch {
    // ok
  }

  initialized = true;
}

async function persistCache() {
  const serialized = pca.getTokenCache().serialize();
  await fs.writeFile(cachePath, serialized, "utf8");
}

export async function getCachedAccounts(): Promise<AccountInfo[]> {
  await ensureCacheLoaded();
  return pca.getTokenCache().getAllAccounts();
}

export async function getPrimaryAccount(): Promise<AccountInfo | null> {
  const accounts = await getCachedAccounts();
  return accounts[0] ?? null;
}

export async function beginDeviceCodeLogin() {
  await ensureCacheLoaded();

  if (!config.CLIENT_ID) {
    throw new Error("CLIENT_ID fehlt in .env");
  }

  if (pendingLoginPromise) {
    if (lastDeviceCode) {
      const deviceCode = lastDeviceCode;

      return {
        alreadyRunning: true,
        userCode: deviceCode.userCode,
        verificationUri: deviceCode.verificationUri,
        expiresOn: deviceCode.expiresOn,
        message: deviceCode.message
      };
    }

    return {
      alreadyRunning: true
    };
  }

  lastDeviceCode = null;

  pendingLoginPromise = pca
    .acquireTokenByDeviceCode({
      scopes: ["User.Read", "Files.Read.All"],
      deviceCodeCallback: (response) => {
        lastDeviceCode = {
          userCode: response.userCode,
          verificationUri: response.verificationUri,
          expiresOn: new Date(
            Date.now() + response.expiresIn * 1000
          ).toISOString(),
          message: response.message
        };

        console.log("\n=== MICROSOFT DEVICE LOGIN ===");
        console.log(response.message);
        console.log("================================\n");
      }
    })
    .then(async (result) => {
      if (!result?.account) {
        throw new Error("Login fehlgeschlagen: kein Account zurückgegeben.");
      }

      await persistCache();

      return {
        username: result.account.username,
        homeAccountId: result.account.homeAccountId
      };
    });

  for (let i = 0; i < 20; i++) {
    if (lastDeviceCode) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!lastDeviceCode) {
    pendingLoginPromise = null;
    throw new Error("Device-Code konnte nicht erzeugt werden.");
  }

  const deviceCode = lastDeviceCode;

  return {
    alreadyRunning: false,
    userCode: deviceCode.userCode,
    verificationUri: deviceCode.verificationUri,
    expiresOn: deviceCode.expiresOn,
    message: deviceCode.message
  };
}

export async function finishDeviceCodeLogin() {
  if (!pendingLoginPromise) {
    throw new Error("Kein laufender Device-Login vorhanden.");
  }

  try {
    const result = await pendingLoginPromise;
    return result;
  } finally {
    pendingLoginPromise = null;
    lastDeviceCode = null;
  }
}

export async function getGraphAccessToken(): Promise<string> {
  await ensureCacheLoaded();

  const account = await getPrimaryAccount();
  if (!account) {
    throw new Error(
      "Kein Microsoft-Login vorhanden. Bitte zuerst /api/auth/device/start aufrufen."
    );
  }

  const silentResult = await pca.acquireTokenSilent({
    account,
    scopes: ["User.Read", "Files.Read.All"]
  });

  if (!silentResult?.accessToken) {
    throw new Error("Konnte kein Graph Access Token abrufen.");
  }

  await persistCache();
  return silentResult.accessToken;
}

export async function clearAuthCache() {
  initialized = true;
  pendingLoginPromise = null;
  lastDeviceCode = null;
  await fs.writeFile(cachePath, "{}", "utf8");
}

export async function getAuthStatus() {
  await ensureCacheLoaded();
  const account = await getPrimaryAccount();

  return {
    configured: Boolean(config.CLIENT_ID),
    signedIn: Boolean(account),
    account: account
      ? {
          username: account.username,
          homeAccountId: account.homeAccountId,
          environment: account.environment,
          tenantId: account.tenantId
        }
      : null,
    pendingDeviceLogin: Boolean(pendingLoginPromise),
    lastDeviceCode
  };
}