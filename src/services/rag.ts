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
  }

  if (q.includes("lokführer")) {
    variants.add("Lokomotivführer");
    variants.add("Triebfahrzeugführer");
    variants.add("Lokomotivführer Entgelt");
    variants.add("Triebfahrzeugführer Entgelt");
    variants.add("Lokführer Eingruppierung");
    variants.add("Lokführer Funktionsgruppe");
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

  return [...variants];
}

function dedupeRows(rows: SearchDocumentRow[]): SearchDocumentRow[] {
  const seen = new Set<string>();
  const result: SearchDocumentRow[] = [];

  for (const row of rows) {
    const key = [
      row.document_name,
      row.union_name ?? "",
      row.chunk_text.trim()
    ].join("||");

    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }

  return result;
}

function filterRows(
  rows: SearchDocumentRow[],
  minSimilarity = 0.45
): SearchDocumentRow[] {
  return rows.filter((row) => row.similarity >= minSimilarity);
}

function normalizeRows(
  rows: SearchDocumentRow[],
  minSimilarity = 0.45,
  limit = 5
): SearchDocumentRow[] {
  return filterRows(dedupeRows(rows), minSimilarity).slice(0, limit);
}

function rowsToSources(rows: SearchDocumentRow[]): SourceItem[] {
  return rows.map((row) => ({
    document: row.document_name,
    union: row.union_name,
    text: row.chunk_text,
    similarity: Number(row.similarity.toFixed(4))
  }));
}

function formatContext(
  rows: SearchDocumentRow[],
  labelPrefix = "Quelle"
): string {
  if (!rows.length) {
    return "Keine ausreichend passenden Treffer gefunden.";
  }

  return rows
    .map((row, index) =>
      [
        `[${labelPrefix} ${index + 1}]`,
        `Dokument: ${row.document_name}`,
        `Gewerkschaft: ${row.union_name ?? "-"}`,
        `Ähnlichkeit: ${row.similarity.toFixed(4)}`,
        `Text: ${row.chunk_text}`
      ].join("\n")
    )
    .join("\n\n---\n\n");
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
        text: row.chunk_text.slice(0, 140)
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

    fallbackRows = fallbackRows.concat(result);
  }

  return dedupeRows(fallbackRows).slice(0, options?.limit ?? 5);
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
    const [gdlRaw, evgRaw] = await Promise.all([
      runExpandedVectorSearch(query, { limit: 8, union: "GDL" }),
      runExpandedVectorSearch(query, { limit: 8, union: "EVG" })
    ]);

    let gdlRows = normalizeRows(gdlRaw, 0.45, 4);
    let evgRows = normalizeRows(evgRaw, 0.45, 4);

    if (!gdlRows.length) {
      const gdlFallback = await runKeywordFallback(query, {
        limit: 8,
        union: "GDL"
      });
      gdlRows = dedupeRows(gdlFallback).slice(0, 4);
    }

    if (!evgRows.length) {
      const evgFallback = await runKeywordFallback(query, {
        limit: 8,
        union: "EVG"
      });
      evgRows = dedupeRows(evgFallback).slice(0, 4);
    }

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

    const gdlContext = formatContext(gdlRows, "GDL Quelle");
    const evgContext = formatContext(evgRows, "EVG Quelle");

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

  const rawResults = await runExpandedVectorSearch(query, {
    limit: 10,
    union: options?.union
  });

  let rows = normalizeRows(rawResults, 0.45, 5);

  console.log("[RAG] Single mode normalized rows:", rows.length);

  if (!rows.length) {
    console.log("[RAG] Vector search empty -> keyword fallback");

    const fallbackRows = await runKeywordFallback(query, {
      limit: 10,
      union: options?.union
    });

    rows = dedupeRows(fallbackRows).slice(0, 5);

    console.log("[RAG] Keyword fallback rows:", rows.length);
  }

  if (!rows.length) {
    const target = options?.union
      ? ` für ${options.union}`
      : "";

    return {
      mode: "single",
      answer: `Ich konnte im gefundenen Tarifkontext${target} keine ausreichend passenden Textstellen zur Frage finden.`,
      sources: []
    };
  }

  const sources = rowsToSources(rows);

  const answer = await generateRagAnswer({
    question: options?.union
      ? `${query} (nur ${options.union})`
      : query,
    context: formatContext(rows, "Quelle")
  });

  return {
    mode: "single",
    answer,
    sources
  };
}