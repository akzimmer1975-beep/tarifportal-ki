import { upsertDocuments } from "../db.js";
import {
  scanTarifportal as scanTarifportalFromGraph,
  type TarifFileRecord
} from "./graphDrive.js";

export type ScannedPdf = TarifFileRecord;

export type ScanResult = {
  ok: true;
  root: {
    id: string;
    name: string;
  };
  pdfCount: number;
  files: ScannedPdf[];
};

export async function scanTarifportal(): Promise<ScanResult> {
  const result = await scanTarifportalFromGraph();

  return {
    ok: true,
    root: {
      id: result.root.id,
      name: result.root.name
    },
    pdfCount: result.pdfCount,
    files: result.files
  };
}

export async function ingestTarifportalToDb() {
  const scan = await scanTarifportal();

  const docs = scan.files.map((file) => ({
    itemId: file.itemId,
    name: file.name,
    path: file.path,
    union: file.union ?? null,
    tariffType: file.tariffType ?? null,
    tariffwerk: file.tariffwerk ?? null,
    funktionsgruppe: file.funktionsgruppe ?? null,
    stand: file.stand ?? null,
    validFrom: file.validFrom ?? null,
    validTo: file.validTo ?? null,
    lastModified: file.lastModifiedDateTime ?? null,
    size: file.size ?? null,
    webUrl: file.webUrl ?? null
  }));

  const dbResult = await upsertDocuments(docs);

  return {
    ok: true,
    root: scan.root,
    scanned: scan.pdfCount,
    written: dbResult.count,
    files: scan.files
  };
}

import { downloadPdf } from "./pdfDownload.js";
import { extractPdf, saveParagraphs } from "./pdfExtract.js";
import { pool } from "../db.js";

export async function extractAllDocuments() {

  const result = await pool.query(`
    SELECT id,item_id,name
    FROM documents
    WHERE text_extracted_at IS NULL
  `);

  const results = [];

  for (const doc of result.rows) {

    try {

      const filePath = await downloadPdf(doc.item_id, doc.name);

      const pages = await extractPdf(filePath);

      const paragraphs = await saveParagraphs(
        doc.id,
        doc.item_id,
        pages
      );

      await pool.query(`
        UPDATE documents
        SET text_extracted_at = NOW()
        WHERE id=$1
      `,[doc.id]);

      results.push({
        itemId: doc.item_id,
        paragraphs
      });

    } catch (err:any) {

      results.push({
        itemId: doc.item_id,
        error: err.message
      });

    }
  }

  return {
    ok: true,
    processed: results.length,
    results
  };
}

