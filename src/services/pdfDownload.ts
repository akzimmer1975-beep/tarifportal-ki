import fs from "fs/promises";
import path from "path";
import { getGraphAccessToken } from "./graphAuth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export async function downloadPdf(itemId: string, fileName: string) {

  const token = await getGraphAccessToken();

  const url = `${GRAPH_BASE}/me/drive/items/${itemId}/content`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PDF Download failed ${res.status} ${text}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  const dir = path.resolve(process.cwd(), "data/pdf-cache");
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${itemId}_${fileName}`);

  await fs.writeFile(filePath, buffer);

  return filePath;
}