import { getGraphAccessToken } from "./graphAuth.js";
import { config } from "../config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  eTag?: string;
  cTag?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  parentReference?: {
    path?: string;
    driveId?: string;
    id?: string;
  };
  folder?: {
    childCount?: number;
  };
  file?: {
    mimeType?: string;
    hashes?: Record<string, string>;
  };
};

export type TarifFileRecord = {
  itemId: string;
  name: string;
  path: string;
  webUrl?: string;
  size?: number;
  lastModifiedDateTime?: string;
  mimeType?: string;
  union?: string | null;
  tariffType?: string | null;
  tariffwerk?: string | null;
  funktionsgruppe?: string | null;
  stand?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

async function graphGet<T>(url: string): Promise<T> {
  const token = await getGraphAccessToken();

  const res = await fetch(`${GRAPH_BASE}${url}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph GET ${url} fehlgeschlagen: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

function encodeGraphPath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function getMe() {
  return graphGet<{
    id: string;
    displayName: string;
    userPrincipalName?: string;
  }>("/me");
}

export async function getTarifportalRoot() {
  const normalized = config.TARIFPORTAL_ROOT_PATH.startsWith("/")
    ? config.TARIFPORTAL_ROOT_PATH
    : `/${config.TARIFPORTAL_ROOT_PATH}`;

  const encodedPath = encodeGraphPath(normalized);
  return graphGet<GraphDriveItem>(`/me/drive/root:${encodedPath}`);
}

export async function listChildren(itemId: string): Promise<GraphDriveItem[]> {
  const all: GraphDriveItem[] = [];
  let url = `/me/drive/items/${itemId}/children?$top=200`;

  while (url) {
    const page = await graphGet<{
      value: GraphDriveItem[];
      "@odata.nextLink"?: string;
    }>(url);

    all.push(...(page.value ?? []));

    const nextLink = page["@odata.nextLink"];
    if (!nextLink) {
      url = "";
    } else {
      url = nextLink.replace(GRAPH_BASE, "");
    }
  }

  return all;
}

export async function listTarifportalChildren() {
  const root = await getTarifportalRoot();
  return listChildren(root.id);
}

function isPdf(item: GraphDriveItem) {
  const name = item.name?.toLowerCase() ?? "";
  const mime = item.file?.mimeType?.toLowerCase() ?? "";
  return name.endsWith(".pdf") || mime.includes("pdf");
}

function inferMetadata(fullPath: string, fileName: string) {
  const upperPath = fullPath.toUpperCase();
  const upperName = fileName.toUpperCase();

  const union =
    upperPath.includes("/GDL/") || upperName.includes("GDL")
      ? "GDL"
      : upperPath.includes("/EVG/") || upperName.includes("EVG")
        ? "EVG"
        : null;

  let tariffType: string | null = null;

  if (
    upperName.includes("RAHMENTARIF") ||
    upperName.includes("RAHMENTV") ||
    upperPath.includes("RAHMENTARIF") ||
    upperName.includes("BURAZUGTV") ||
    upperName.includes("BURAEVU") ||
    upperName.includes("FZITV")
  ) {
    tariffType = "Rahmentarif";
  } else if (
    upperName.includes("BASISTV") ||
    upperName.includes("ZUBTV") ||
    upperName.includes("DISPOTV") ||
    upperName.includes("LFTV") ||
    upperName.includes("LRFTV") ||
    upperName.includes("TV_") ||
    upperName.includes("TARIFVERTRAG")
  ) {
    tariffType = "Tarifvertrag";
  } else if (
    upperName.includes("ENTGELT") ||
    upperPath.includes("ENTGELT")
  ) {
    tariffType = "Entgelt";
  } else if (
    upperName.includes("ARBEITSZEIT") ||
    upperPath.includes("ARBEITSZEIT")
  ) {
    tariffType = "Arbeitszeit";
  } else if (
    upperName.includes("ZULAGE") ||
    upperPath.includes("ZULAGE")
  ) {
    tariffType = "Zulagen";
  }

  let tariffwerk: string | null = null;

  if (upperName.includes("BASISTV")) tariffwerk = "BasisTV";
  else if (upperName.includes("ZUBTV")) tariffwerk = "ZubTV";
  else if (upperName.includes("DISPOTV")) tariffwerk = "DispoTV";
  else if (upperName.includes("LFTV")) tariffwerk = "LfTV";
  else if (upperName.includes("LRFTV")) tariffwerk = "LrfTV";
  else if (upperName.includes("FZITV")) tariffwerk = "FZITV";
  else if (upperName.includes("BURAZUGTV")) tariffwerk = "BuRaZugTV";

  let funktionsgruppe: string | null = null;
  const fgrMatch = fileName.match(/FGR[\s_-]?(\d+)/i);
  if (fgrMatch) {
    funktionsgruppe = `FGr${fgrMatch[1]}`;
  }

  let stand: string | null = null;

  const standIsoMatch = fileName.match(/STAND[_\s-]?(\d{4}-\d{2}-\d{2})/i);
  if (standIsoMatch) {
    stand = standIsoMatch[1];
  } else {
    const standMonthMatch = fileName.match(/STAND[_\s-]?(\d{2})[_\s-](\d{4})/i);
    if (standMonthMatch) {
      stand = `${standMonthMatch[2]}-${standMonthMatch[1]}`;
    } else {
      const standDotMatch = fileName.match(/STAND[_\s-]?(\d{2}\.\d{2}\.\d{4})/i);
      if (standDotMatch) {
        stand = standDotMatch[1];
      }
    }
  }

  let validFrom: string | null = null;
  let validTo: string | null = null;

  const gueltigAbMatch = fileName.match(/GUELTIGAB[_\s-]?(\d{4})[_\s-](\d{2})[_\s-](\d{2})/i);
  if (gueltigAbMatch) {
    validFrom = `${gueltigAbMatch[1]}-${gueltigAbMatch[2]}-${gueltigAbMatch[3]}`;
  }

  const gueltigBisMatch = fileName.match(/GUELTIGBIS[_\s-]?(\d{4})[_\s-](\d{2})[_\s-](\d{2})/i);
  if (gueltigBisMatch) {
    validTo = `${gueltigBisMatch[1]}-${gueltigBisMatch[2]}-${gueltigBisMatch[3]}`;
  }

  if (!validFrom || !validTo) {
    const allIsoDates = fileName.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    if (!validFrom && allIsoDates[0]) validFrom = allIsoDates[0];
    if (!validTo && allIsoDates[1]) validTo = allIsoDates[1];
  }

  return {
    union,
    tariffType,
    tariffwerk,
    funktionsgruppe,
    stand,
    validFrom,
    validTo
  };
}
async function walkFolderRecursive(
  item: GraphDriveItem,
  currentPath: string,
  result: TarifFileRecord[]
): Promise<void> {
  const children = await listChildren(item.id);

  for (const child of children) {
    const childPath = `${currentPath}/${child.name}`.replace(/\/+/g, "/");

    if (child.folder) {
      await walkFolderRecursive(child, childPath, result);
      continue;
    }

    if (!isPdf(child)) {
      continue;
    }

    const meta = inferMetadata(childPath, child.name);

    result.push({
      itemId: child.id,
      name: child.name,
      path: childPath,
      webUrl: child.webUrl,
      size: child.size,
      lastModifiedDateTime: child.lastModifiedDateTime,
      mimeType: child.file?.mimeType,
      union: meta.union,
      tariffType: meta.tariffType,
      tariffwerk: meta.tariffwerk,
      funktionsgruppe: meta.funktionsgruppe,
      stand: meta.stand,
      validFrom: meta.validFrom,
      validTo: meta.validTo
    });
  }
}

export async function scanTarifportal(): Promise<{
  root: GraphDriveItem;
  pdfCount: number;
  files: TarifFileRecord[];
}> {
  const root = await getTarifportalRoot();
  const files: TarifFileRecord[] = [];

  const rootPath = config.TARIFPORTAL_ROOT_PATH.startsWith("/")
    ? config.TARIFPORTAL_ROOT_PATH
    : `/${config.TARIFPORTAL_ROOT_PATH}`;

  await walkFolderRecursive(root, rootPath, files);

  files.sort((a, b) => a.path.localeCompare(b.path, "de"));

  return {
    root,
    pdfCount: files.length,
    files
  };
}