import {
  generateComparisonAnswer,
  generateRagAnswer,
  generateStructuredComparisonAnswer
} from "./openai.js";
import {
  searchDocuments,
  keywordSearch,
  type SearchDocumentRow
} from "./search.js";
import type {
  ChatResponseBody,
  SourceItem,
  UnionName
} from "../types/chat.js";

function expandQuery(query: string): string[] {
  const variants = new Set<string>([query]);
  const q = query.toLowerCase();

  if (q.includes("ruhezeit")) {
    variants.add("Ruhezeiten");
    variants.add("Ruhezeiten am Dienstort");
    variants.add("auswärtige Ruhezeit");
    variants.add("Ruhezeit außerhalb des Dienstortes");
    variants.add("Ruhetag");
    variants.add("Ruhetage");
  }

  if (q.includes("auswärts")) {
    variants.add("auswärtig");
    variants.add("außerhalb des Dienstortes");
    variants.add("am auswärtigen Einsatzort");
  }

  if (q.includes("lokführer")) {
    variants.add("Lokomotivführer");
    variants.add("Triebfahrzeugführer");
    variants.add("Tf");
    variants.add("Lokführer Eingruppierung");
    variants.add("Lokführer Funktionsgruppe");
    variants.add("Lokführer Entgelt");
  }

  if (q.includes("entgelt")) {
    variants.add("Tabellenentgelt");
    variants.add("Monatsentgelt");
    variants.add("Vergütung");
    variants.add("Entgeltgruppe");
    variants.add("Funktionsgruppe");
    variants.add("Eingruppierung");
  }

  if (q.includes("eingruppierung")) {
    variants.add("Funktionsgruppe");
    variants.add("Entgeltgruppe");
    variants.add("Zuordnung");
  }

  if (q.includes("arbeitszeit")) {
    variants.add("Arbeitszeiten");
    variants.add("Dienstzeit");
    variants.add("Schichtzeit");
  }

  return [...variants];
}

function dedupeRows(rows: SearchDocumentRow[]): SearchDocumentRow[] {
  const seen = new Set<string>();
  const result: SearchDocumentRow[] = [];

  for (const row of rows) {
    const key = [
      row.document_name,
      row.union_name ?? "",
      row.page_number ?? "",
      row.paragraph_index ?? "",
      row.chunk_text.trim()
    ].join("||");

    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }

  return result;
}

function scoreRow(row: SearchDocumentRow, query: string): number {
  const text = [
    row.document_name,
    row.union_name ?? "",
    row.tarif_type ?? "",
    row.tariffwerk ?? "",
    row.funktionsgruppe ?? "",
    row.chunk_text
  ]
    .join(" ")
    .toLowerCase();

  let score = row.similarity;

  if (query.includes("entgelt")) {
    if (text.includes("entgelt")) score += 0.25;
    if (text.includes("tabellenentgelt")) score += 0.35;
    if (text.includes("vergütung")) score += 0.2;
    if (text.includes("entgeltgruppe")) score += 0.3;
    if (text.includes("funktionsgruppe")) score += 0.3;
  }

  if (query.includes("lokführer")) {
    if (text.includes("lokführer")) score += 0.3;
    if (text.includes("lokomotivführer")) score += 0.35;
    if (text.includes("triebfahrzeugführer")) score += 0.35;
    if (text.includes(" tf ")) score += 0.05;
  }

  if (query.includes("ruhezeit")) {
    if (text.includes("ruhezeit")) score += 0.25;
    if (text.includes("ruhezeiten")) score += 0.25;
    if (text.includes("ruhetag")) score += 0.15;
    if (text.includes("dienstort")) score += 0.2;
    if (text.includes("auswärt")) score += 0.2;
  }

  if (query.includes("arbeitszeit")) {
    if (text.includes("arbeitszeit")) score += 0.25;
    if (text.includes("dienstzeit")) score += 0.2;
    if (text.includes("schicht")) score += 0.15;
  }

  return score;
}

function rerankRows(rows: SearchDocumentRow[], query: string): SearchDocumentRow[] {
  const q = query.toLowerCase();

  return [...rows].sort((a, b) => {
    const scoreA = scoreRow(a, q);
    const scoreB = scoreRow(b, q);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return b.similarity - a.similarity;
  });
}

function filterRows(
  rows: SearchDocumentRow[],
  minSimilarity = 0.4
): SearchDocumentRow[] {
  return rows.filter((row) => row.similarity >= minSimilarity);
}

function normalizeRows(
  rows: SearchDocumentRow[],
  query: string,
  minSimilarity = 0.4,
  limit = 8
): SearchDocumentRow[] {
  const deduped = dedupeRows(rows);
  const filtered = filterRows(deduped, minSimilarity);
  const reranked = rerankRows(filtered, query);
  return reranked.slice(0, limit);
}

function rowsToSources(rows: SearchDocumentRow[]): SourceItem[] {
  return rows.map((row) => ({
    document: row.document_name,
    union: row.union_name,
    tarif: row.tariffwerk,
    tarifType: row.tarif_type,
    funktionsgruppe: row.funktionsgruppe,
    page: row.page_number,
    paragraph: row.paragraph_index,
    text: row.chunk_text,
    similarity: Number(row.similarity.toFixed(4))
  }));
}

function formatContext(rows: SearchDocumentRow[]): string {
  if (!rows.length) {
    return "Keine ausreichend passenden Treffer gefunden.";
  }

  return rows
    .map(
      (row, index) => `
Quelle ${index + 1}
Dokument: ${row.document_name}
Gewerkschaft: ${row.union_name ?? "-"}
Tarifwerk: ${row.tariffwerk ?? "-"}
Tariftyp: ${row.tarif_type ?? "-"}
Funktionsgruppe: ${row.funktionsgruppe ?? "-"}
Seite: ${row.page_number ?? "-"}
Abschnitt: ${row.paragraph_index ?? "-"}

Text:
${row.chunk_text}
`.trim()
    )
    .join("\n\n---------------------\n\n");
}

function groupSourcesByUnion(sources: SourceItem[]) {
  return {
    GDL: sources.filter((s) => s.union === "GDL"),
    EVG: sources.filter((s) => s.union === "EVG")
  };
}

async function runExpandedVectorSearch(
  query: string,
  options?: {
    union?: UnionName;
    limit?: number;
  }
): Promise<SearchDocumentRow[]> {
  const queries = expandQuery(query);
  let rawResults: SearchDocumentRow[] = [];

  console.log("[RAG] Original query:", query);
  console.log("[RAG] Expanded queries:", queries);

  for (const expandedQuery of queries) {
    const result = await searchDocuments(expandedQuery, {
      limit: options?.limit ?? 10,
      union: options?.union
    });

    console.log(`[RAG] Vector results for "${expandedQuery}":`, result.length);

    for (const row of result.slice(0, 5)) {
      console.log({
        query: expandedQuery,
        similarity: row.similarity,
        document: row.document_name,
        union: row.union_name,
        tarif_type: row.tarif_type,
        tariffwerk: row.tariffwerk,
        funktionsgruppe: row.funktionsgruppe,
        page_number: row.page_number,
        paragraph_index: row.paragraph_index,
        text: row.chunk_text.slice(0, 160)
      });
    }

    rawResults = rawResults.concat(result);
  }

  return rawResults;
}

async function runKeywordFallback(
  query: string,
  options?: {
    union?: UnionName;
    limit?: number;
  }
): Promise<SearchDocumentRow[]> {
  const queries = expandQuery(query);
  let fallbackRows: SearchDocumentRow[] = [];

  console.log("[RAG] Starting keyword fallback for:", query);

  for (const expandedQuery of queries) {
    const result = await keywordSearch(expandedQuery, {
      limit: options?.limit ?? 10,
      union: options?.union
    });

    console.log(`[RAG] Keyword results for "${expandedQuery}":`, result.length);

    for (const row of result.slice(0, 5)) {
      console.log({
        query: expandedQuery,
        similarity: row.similarity,
        document: row.document_name,
        union: row.union_name,
        tarif_type: row.tarif_type,
        tariffwerk: row.tariffwerk,
        funktionsgruppe: row.funktionsgruppe,
        page_number: row.page_number,
        paragraph_index: row.paragraph_index,
        text: row.chunk_text.slice(0, 160)
      });
    }

    fallbackRows = fallbackRows.concat(result);
  }

  return dedupeRows(fallbackRows);
}

async function getBestRows(
  query: string,
  options?: {
    union?: UnionName;
    vectorLimit?: number;
    finalLimit?: number;
    minSimilarity?: number;
  }
): Promise<SearchDocumentRow[]> {
  const rawVectorResults = await runExpandedVectorSearch(query, {
    union: options?.union,
    limit: options?.vectorLimit ?? 20
  });

  let rows = normalizeRows(
    rawVectorResults,
    query,
    options?.minSimilarity ?? 0.4,
    options?.finalLimit ?? 10
  );

  console.log("[RAG] Normalized vector rows:", rows.length);

  if (!rows.length) {
    console.log("[RAG] Vector search empty -> keyword fallback");

    const fallbackRows = await runKeywordFallback(query, {
      union: options?.union,
      limit: options?.vectorLimit ?? 20
    });

    rows = rerankRows(dedupeRows(fallbackRows), query).slice(
      0,
      options?.finalLimit ?? 10
    );

    console.log("[RAG] Keyword fallback rows:", rows.length);
  }

  return rows;
}

export async function answerWithRag(
  query: string,
  options?: {
    union?: UnionName;
    compareUnions?: boolean;
  }
): Promise<ChatResponseBody> {
  const compareUnions = options?.compareUnions === true;

  if (compareUnions) {
    const [gdlRows, evgRows] = await Promise.all([
      getBestRows(query, {
        union: "GDL",
        vectorLimit: 20,
        finalLimit: 10,
        minSimilarity: 0.4
      }),
      getBestRows(query, {
        union: "EVG",
        vectorLimit: 20,
        finalLimit: 10,
        minSimilarity: 0.4
      })
    ]);

    console.log("[RAG] Compare mode GDL rows:", gdlRows.length);
    console.log("[RAG] Compare mode EVG rows:", evgRows.length);

    if (!gdlRows.length && !evgRows.length) {
      return {
        mode: "compare",
        answer:
          "Ich konnte weder für GDL noch für EVG ausreichend passende Textstellen im gefundenen Tarifkontext finden.",
        structured: {
          kurzfazit:
            "Weder für GDL noch für EVG wurden ausreichend passende Textstellen gefunden.",
          gdl: "Für GDL liegen im gefundenen Kontext keine ausreichend passenden Textstellen vor.",
          evg: "Für EVG liegen im gefundenen Kontext keine ausreichend passenden Textstellen vor.",
          unterschiede: [],
          gemeinsamkeiten: []
        },
        sources: [],
        sourcesByUnion: {
          GDL: [],
          EVG: []
        }
      };
    }

    const gdlContext = formatContext(gdlRows);
    const evgContext = formatContext(evgRows);

    let structured;
    let answer;

    try {
      structured = await generateStructuredComparisonAnswer({
        question: query,
        gdlContext,
        evgContext
      });

      answer = [
        `1. Kurzfazit\n${structured.kurzfazit}`,
        `2. GDL\n${structured.gdl}`,
        `3. EVG\n${structured.evg}`,
        `4. Unterschiede\n${
          structured.unterschiede.length
            ? structured.unterschiede.map((item) => `- ${item}`).join("\n")
            : "Keine klar belegbaren Unterschiede im gefundenen Kontext."
        }`,
        `5. Gemeinsamkeiten\n${
          structured.gemeinsamkeiten.length
            ? structured.gemeinsamkeiten.map((item) => `- ${item}`).join("\n")
            : "Keine klar belegbaren Gemeinsamkeiten im gefundenen Kontext."
        }`
      ].join("\n\n");
    } catch (error) {
      console.warn("[RAG] Strukturierte Vergleichsantwort fehlgeschlagen:", error);

      answer = await generateComparisonAnswer({
        question: query,
        gdlContext,
        evgContext
      });

      structured = {
        kurzfazit: answer,
        gdl: gdlRows.length
          ? "Für GDL liegen Treffer vor, die im Freitext beantwortet wurden."
          : "Für GDL liegen keine ausreichend passenden Textstellen vor.",
        evg: evgRows.length
          ? "Für EVG liegen Treffer vor, die im Freitext beantwortet wurden."
          : "Für EVG liegen keine ausreichend passenden Textstellen vor.",
        unterschiede: [],
        gemeinsamkeiten: []
      };
    }

    const sources = [...rowsToSources(gdlRows), ...rowsToSources(evgRows)];

    return {
      mode: "compare",
      answer,
      structured,
      sources,
      sourcesByUnion: groupSourcesByUnion(sources)
    };
  }

  const rows = await getBestRows(query, {
    union: options?.union,
    vectorLimit: 20,
    finalLimit: 10,
    minSimilarity: 0.4
  });

  if (!rows.length) {
    const target = options?.union ? ` für ${options.union}` : "";

    return {
      mode: "single",
      answer: `Ich konnte im gefundenen Tarifkontext${target} keine ausreichend passenden Textstellen zur Frage finden.`,
      sources: [],
      sourcesByUnion: {
        GDL: [],
        EVG: []
      }
    };
  }

  const sources = rowsToSources(rows);

  const answer = await generateRagAnswer({
    question: options?.union ? `${query} (nur ${options.union})` : query,
    context: formatContext(rows)
  });

  return {
    mode: "single",
    answer,
    sources,
    sourcesByUnion: groupSourcesByUnion(sources)
  };
}