import OpenAI from "openai";
import type {
  ChatResponseBody,
  SourceItem,
  StructuredCompareAnswer,
  StructuredCompareSection,
  UnionName
} from "../types/chat.js";
import {
  hybridSearch,
  type SearchDocumentRow
} from "./search.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

type AnswerWithRagOptions = {
  union?: UnionName;
  compareUnions?: boolean;
};

type TopicKey = "ruhezeiten" | "arbeitszeit" | "entgelt" | "urlaub" | "unknown";

type TopicSection = {
  key: string;
  title: string;
  searchQueries: string[];
};

type StructuredSectionModelResponse = {
  summary?: string;
  gdl: string;
  evg: string;
  gdl_unterschiede: string[];
  evg_unterschiede: string[];
  gemeinsamkeiten: string[];
};

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
    ].join("::");

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

function normalizeRows(
  rows: SearchDocumentRow[],
  minSimilarity = 0.35,
  limit = 8
): SearchDocumentRow[] {
  return dedupeRows(rows)
    .filter((row) => row.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
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
    paragraphFrom: row.paragraph_index_from,
    paragraphTo: row.paragraph_index_to,
    text: row.chunk_text,
    previousText: row.previous_text,
    nextText: row.next_text,
    fullText: row.full_source_text,
    similarity: row.similarity
  })) as SourceItem[];
}

function formatParagraphLabel(row: SearchDocumentRow): string {
  const from = row.paragraph_index_from;
  const to = row.paragraph_index_to;

  if (from == null && to == null) return "unbekannt";
  if (from === to) return `${from}`;
  return `${from}-${to}`;
}

function formatContext(rows: SearchDocumentRow[]): string {
  if (!rows.length) {
    return "Keine passenden Quellen gefunden.";
  }

  return rows
    .map((row, index) => {
      const meta = [
        `Quelle ${index + 1}`,
        `Dokument: ${row.document_name}`,
        `Gewerkschaft: ${row.union_name ?? "unbekannt"}`,
        row.tariffwerk ? `Tarifwerk: ${row.tariffwerk}` : null,
        row.tarif_type ? `Tariftyp: ${row.tarif_type}` : null,
        row.funktionsgruppe ? `Funktionsgruppe: ${row.funktionsgruppe}` : null,
        row.page_number != null ? `Seite: ${row.page_number}` : null,
        `Absatz: ${formatParagraphLabel(row)}`,
        `Score: ${row.similarity.toFixed(4)}`
      ]
        .filter(Boolean)
        .join(" | ");

      return `${meta}\n${row.full_source_text}`;
    })
    .join("\n\n---\n\n");
}

async function getBestRows(
  query: string,
  options: {
    union?: UnionName;
    vectorLimit?: number;
    finalLimit?: number;
    minSimilarity?: number;
    topicKey?: string;
    sectionKey?: string;
  } = {}
): Promise<SearchDocumentRow[]> {
  const vectorLimit = options.vectorLimit ?? 12;
  const finalLimit = options.finalLimit ?? 8;
  const minSimilarity = options.minSimilarity ?? 0.35;

  const rows = await hybridSearch(query, {
    union: options.union,
    limit: vectorLimit,
    topicKey: options.topicKey,
    sectionKey: options.sectionKey
  });

  return normalizeRows(rows, minSimilarity, finalLimit);
}

function detectMainTopic(query: string): TopicKey {
  const q = query.toLowerCase();

  if (q.includes("ruhezeit") || q.includes("ruhetag") || q.includes("ruhepause")) {
    return "ruhezeiten";
  }

  if (q.includes("arbeitszeit") || q.includes("dienstzeit") || q.includes("schicht")) {
    return "arbeitszeit";
  }

  if (
    q.includes("entgelt") ||
    q.includes("vergütung") ||
    q.includes("tabellenentgelt") ||
    q.includes("monatsentgelt")
  ) {
    return "entgelt";
  }

  if (q.includes("urlaub")) {
    return "urlaub";
  }

  return "unknown";
}

function getSectionsForTopic(topic: TopicKey): TopicSection[] {
  switch (topic) {
    case "ruhezeiten":
      return [
        {
          key: "dienstort",
          title: "Ruhezeiten am Dienstort / zu Hause",
          searchQueries: [
            "Ruhezeit am Dienstort",
            "Ruhezeit zu Hause",
            "regelmäßige Ruhezeit am Dienstort",
            "Ruhezeiten Dienstort"
          ]
        },
        {
          key: "auswaerts",
          title: "Auswärtige Ruhezeiten",
          searchQueries: [
            "auswärtige Ruhezeit",
            "Ruhezeit außerhalb des Dienstortes",
            "Ruhezeit auswärts",
            "Ruhezeiten auswärtig"
          ]
        },
        {
          key: "ruhetage",
          title: "Ruhetage / Anzahl der Ruhetage",
          searchQueries: [
            "Ruhetage",
            "Anzahl der Ruhetage",
            "Jahresruhezeitplan",
            "Mindestruhetage"
          ]
        },
        {
          key: "pause_anrechnung",
          title: "Ruhepausen / Anrechnung / Sonderregeln",
          searchQueries: [
            "Ruhepause",
            "Anrechnung der Ruhezeit",
            "soziale Rahmenbedingungen während der Ruhepause",
            "Abweichung Ruhezeit"
          ]
        }
      ];

    case "arbeitszeit":
      return [
        {
          key: "regelarbeitszeit",
          title: "Regelmäßige Arbeitszeit",
          searchQueries: [
            "regelmäßige Arbeitszeit",
            "Jahresarbeitszeit",
            "tarifvertragliche regelmäßige Arbeitszeit"
          ]
        },
        {
          key: "schicht_dienstzeit",
          title: "Schichtzeit / Dienstzeit",
          searchQueries: ["Schichtzeit", "Dienstzeit", "Arbeitszeit Schicht"]
        },
        {
          key: "pause_mehrarbeit",
          title: "Pausen / Mehrarbeit / Zuschläge",
          searchQueries: ["Mehrarbeit", "Überstunden", "Arbeitszeitzuschlag", "Ruhepause"]
        }
      ];

    case "entgelt":
      return [
        {
          key: "tabellen",
          title: "Entgelttabellen / Tabellenentgelt",
          searchQueries: [
            "Entgelttabelle",
            "Tabellenentgelt",
            "Monatsentgelt",
            "Vergütungstabelle"
          ]
        },
        {
          key: "eingruppierung",
          title: "Eingruppierung / Funktionsgruppen",
          searchQueries: [
            "Eingruppierung",
            "Funktionsgruppe",
            "Entgeltgruppe",
            "Tätigkeitsmerkmale"
          ]
        },
        {
          key: "zulagen",
          title: "Zulagen / Zuschläge / weitere Entgeltbestandteile",
          searchQueries: [
            "Zulage",
            "Zuschlag",
            "Entgeltbestandteil",
            "Erschwerniszulage"
          ]
        }
      ];

    case "urlaub":
      return [
        {
          key: "urlaubsanspruch",
          title: "Urlaubsanspruch",
          searchQueries: ["Urlaubsanspruch", "Erholungsurlaub", "Urlaubstage"]
        },
        {
          key: "lage",
          title: "Lage / Planung / Gewährung",
          searchQueries: ["Urlaubsplanung", "Gewährung von Urlaub", "Hauptjahresurlaub"]
        },
        {
          key: "sonderregeln",
          title: "Sonderregeln / Übertragung / Verfall",
          searchQueries: ["Übertragung Urlaub", "Verfall Urlaub", "Zusatzurlaub"]
        }
      ];

    default:
      return [];
  }
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith("```json")) {
    return trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  return trimmed;
}

async function generateAnswer(params: {
  question: string;
  context: string;
  union?: UnionName;
}): Promise<string> {
  const prompt = `
Beantworte die tarifliche Frage ausschließlich anhand des bereitgestellten Kontexts.
Erfinde nichts.
Wenn etwas nicht sicher aus den Quellen hervorgeht, dann sage das klar.

Wichtig:
- Zahlen, Zeiten, Dauerangaben und Grenzwerte nur nennen, wenn sie im Kontext eindeutig stehen.
- Wenn sich eine Regelung über mehrere aufeinanderfolgende Absätze erstreckt, berücksichtige den vollständigen zusammengeführten Quelltext.

Frage:
${params.question}

${params.union ? `Gewünschte Gewerkschaft: ${params.union}` : ""}

Kontext:
${params.context}
  `.trim();

  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: prompt
  });

  return response.output_text?.trim() || "Es konnte keine Antwort erzeugt werden.";
}

async function generateStructuredComparisonAnswer(params: {
  question: string;
  gdlContext: string;
  evgContext: string;
}): Promise<StructuredSectionModelResponse> {
  const prompt = `
Vergleiche GDL und EVG ausschließlich anhand der bereitgestellten Kontexte.
Erfinde nichts.
Wenn Unterschiede oder Gemeinsamkeiten nicht sicher aus den Quellen belegbar sind, dann lasse sie weg.

Wichtig:
- Zahlen, Zeiten, Dauerangaben und Grenzwerte nur nennen, wenn sie im Kontext eindeutig stehen.
- Wenn sich eine Regelung über mehrere aufeinanderfolgende Absätze erstreckt, berücksichtige den vollständigen zusammengeführten Quelltext.

Gib ausschließlich JSON zurück mit genau dieser Struktur:
{
  "summary": "string",
  "gdl": "string",
  "evg": "string",
  "gdl_unterschiede": ["string"],
  "evg_unterschiede": ["string"],
  "gemeinsamkeiten": ["string"]
}

Frage:
${params.question}

GDL-Kontext:
${params.gdlContext}

EVG-Kontext:
${params.evgContext}
  `.trim();

  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: prompt
  });

  const raw = stripJsonFences(response.output_text?.trim() || "");

  try {
    const parsed = JSON.parse(raw) as Partial<StructuredSectionModelResponse>;

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      gdl: typeof parsed.gdl === "string" ? parsed.gdl : "",
      evg: typeof parsed.evg === "string" ? parsed.evg : "",
      gdl_unterschiede: Array.isArray(parsed.gdl_unterschiede)
        ? parsed.gdl_unterschiede.filter((item): item is string => typeof item === "string")
        : [],
      evg_unterschiede: Array.isArray(parsed.evg_unterschiede)
        ? parsed.evg_unterschiede.filter((item): item is string => typeof item === "string")
        : [],
      gemeinsamkeiten: Array.isArray(parsed.gemeinsamkeiten)
        ? parsed.gemeinsamkeiten.filter((item): item is string => typeof item === "string")
        : []
    };
  } catch {
    return {
      summary: "",
      gdl: "Für GDL liegen passende Quellen im Suchergebnis vor.",
      evg: "Für EVG liegen passende Quellen im Suchergebnis vor.",
      gdl_unterschiede: [],
      evg_unterschiede: [],
      gemeinsamkeiten: []
    };
  }
}

async function getRowsForSection(
  baseQuery: string,
  section: TopicSection,
  union: UnionName,
  topic: TopicKey
): Promise<SearchDocumentRow[]> {
  const rows: SearchDocumentRow[] = [];

  for (const searchQuery of section.searchQueries) {
    const combinedQuery = `${baseQuery} ${searchQuery}`;

    const result = await getBestRows(combinedQuery, {
      union,
      vectorLimit: 12,
      finalLimit: 6,
      minSimilarity: 0.35,
      topicKey: topic,
      sectionKey: section.key
    });

    rows.push(...result);
  }

  return normalizeRows(rows, 0.35, 6);
}

async function buildSectionCompare(
  baseQuery: string,
  section: TopicSection,
  topic: TopicKey
): Promise<StructuredCompareSection> {
  const [gdlRows, evgRows] = await Promise.all([
    getRowsForSection(baseQuery, section, "GDL", topic),
    getRowsForSection(baseQuery, section, "EVG", topic)
  ]);

  const gdlSources = rowsToSources(gdlRows);
  const evgSources = rowsToSources(evgRows);

  const gdlContext = formatContext(gdlRows);
  const evgContext = formatContext(evgRows);

  if (!gdlRows.length && !evgRows.length) {
    return {
      key: section.key,
      title: section.title,
      summary: "",
      gdlText:
        "Für GDL wurden in dieser Unterrubrik keine ausreichend passenden Textstellen gefunden.",
      evgText:
        "Für EVG wurden in dieser Unterrubrik keine ausreichend passenden Textstellen gefunden.",
      gdlDifferences: [],
      evgDifferences: [],
      gdlSources: [],
      evgSources: []
    };
  }

  try {
    const structured = await generateStructuredComparisonAnswer({
      question: `${baseQuery}\nUnterrubrik: ${section.title}`,
      gdlContext,
      evgContext
    });

    return {
      key: section.key,
      title: section.title,
      summary: structured.summary || "",
      gdlText: structured.gdl,
      evgText: structured.evg,
      gdlDifferences: dedupeStrings(structured.gdl_unterschiede),
      evgDifferences: dedupeStrings(structured.evg_unterschiede),
      gdlSources,
      evgSources
    };
  } catch (error) {
    console.warn(`[RAG] Strukturierte Teilantwort fehlgeschlagen (${section.title}):`, error);

    return {
      key: section.key,
      title: section.title,
      summary: "",
      gdlText: gdlRows.length
        ? "Für GDL liegen passende Treffer zu dieser Unterrubrik vor."
        : "Für GDL liegen keine ausreichend passenden Textstellen zu dieser Unterrubrik vor.",
      evgText: evgRows.length
        ? "Für EVG liegen passende Treffer zu dieser Unterrubrik vor."
        : "Für EVG liegen keine ausreichend passenden Textstellen zu dieser Unterrubrik vor.",
      gdlDifferences: [],
      evgDifferences: [],
      gdlSources,
      evgSources
    };
  }
}

function summarizeSectionResults(
  topic: TopicKey,
  sections: StructuredCompareSection[]
): StructuredCompareAnswer {
  const allDifferences = sections.flatMap((section) => [
    ...section.gdlDifferences,
    ...section.evgDifferences
  ]);

  const allSimilarities: string[] = [];

  const kurzfazit =
    sections.length > 0
      ? `Die Frage wurde thematisch in ${sections.length} Unterrubriken zum Oberthema "${topic}" aufgeteilt und getrennt für GDL und EVG ausgewertet.`
      : "Es konnten keine thematisch passenden Unterrubriken ausgewertet werden.";

  const gdl = sections
    .map((section) => `- ${section.title}: ${section.gdlText}`)
    .join("\n");

  const evg = sections
    .map((section) => `- ${section.title}: ${section.evgText}`)
    .join("\n");

  sections.forEach((section) => {
    const sameHint = section.summary?.trim();
    if (sameHint) {
      allSimilarities.push(`${section.title}: ${sameHint}`);
    }
  });

  return {
    topicKey: topic,
    kurzfazit,
    gdl,
    evg,
    unterschiede: dedupeStrings(allDifferences),
    gemeinsamkeiten: dedupeStrings(allSimilarities),
    sections
  };
}

function formatHierarchicalAnswer(
  structured: StructuredCompareAnswer,
  sections: StructuredCompareSection[]
): string {
  const parts: string[] = [];

  parts.push(`1. Kurzfazit\n${structured.kurzfazit}`);

  sections.forEach((section, index) => {
    parts.push(
      `${index + 2}. ${section.title}\nGDL:\n${section.gdlText}\n\nEVG:\n${section.evgText}\n\nBesonderheiten GDL:\n${
        section.gdlDifferences.length
          ? section.gdlDifferences.map((item) => `- ${item}`).join("\n")
          : "Keine klar belegbaren Besonderheiten im gefundenen Kontext."
      }\n\nBesonderheiten EVG:\n${
        section.evgDifferences.length
          ? section.evgDifferences.map((item) => `- ${item}`).join("\n")
          : "Keine klar belegbaren Besonderheiten im gefundenen Kontext."
      }`
    );
  });

  if (structured.unterschiede.length) {
    parts.push(
      `${sections.length + 2}. Gesamtunterschiede\n${structured.unterschiede
        .map((item) => `- ${item}`)
        .join("\n")}`
    );
  }

  if (structured.gemeinsamkeiten.length) {
    parts.push(
      `${sections.length + 3}. Gesamtgemeinsamkeiten\n${structured.gemeinsamkeiten
        .map((item) => `- ${item}`)
        .join("\n")}`
    );
  }

  return parts.join("\n\n");
}

export async function answerWithRag(
  query: string,
  options: AnswerWithRagOptions = {}
): Promise<ChatResponseBody> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("query fehlt");
  }

  if (options.compareUnions) {
    const topic = detectMainTopic(trimmedQuery);
    const topicSections = getSectionsForTopic(topic);
    const shouldBuildSections = topic !== "unknown" && topicSections.length > 0;

    if (shouldBuildSections) {
      const sections = await Promise.all(
        topicSections.map((section) => buildSectionCompare(trimmedQuery, section, topic))
      );

      const structured = summarizeSectionResults(topic, sections);

      const allSources = sections.flatMap((section) => [
        ...section.gdlSources,
        ...section.evgSources
      ]);

      const gdlSources = sections.flatMap((section) => section.gdlSources);
      const evgSources = sections.flatMap((section) => section.evgSources);

      return {
        mode: "compare",
        answer: formatHierarchicalAnswer(structured, sections),
        structured,
        sections,
        sources: allSources,
        sourcesByUnion: {
          GDL: gdlSources,
          EVG: evgSources
        }
      };
    }

    const [gdlRows, evgRows] = await Promise.all([
      getBestRows(trimmedQuery, {
        union: "GDL",
        vectorLimit: 12,
        finalLimit: 8,
        minSimilarity: 0.35,
        topicKey: topic
      }),
      getBestRows(trimmedQuery, {
        union: "EVG",
        vectorLimit: 12,
        finalLimit: 8,
        minSimilarity: 0.35,
        topicKey: topic
      })
    ]);

    const gdlSources = rowsToSources(gdlRows);
    const evgSources = rowsToSources(evgRows);

    const compare = await generateStructuredComparisonAnswer({
      question: trimmedQuery,
      gdlContext: formatContext(gdlRows),
      evgContext: formatContext(evgRows)
    });

    const structured: StructuredCompareAnswer = {
      topicKey: topic,
      kurzfazit:
        compare.summary ||
        "Es wurde ein direkter Vergleich zwischen GDL und EVG auf Basis der gefundenen Quellen erstellt.",
      gdl: compare.gdl,
      evg: compare.evg,
      unterschiede: dedupeStrings([
        ...compare.gdl_unterschiede,
        ...compare.evg_unterschiede
      ]),
      gemeinsamkeiten: dedupeStrings(compare.gemeinsamkeiten),
      sections: []
    };

    return {
      mode: "compare",
      answer: [
        `Kurzfazit:\n${structured.kurzfazit}`,
        `GDL:\n${structured.gdl}`,
        `EVG:\n${structured.evg}`,
        `Unterschiede:\n${
          structured.unterschiede.length
            ? structured.unterschiede.map((item) => `- ${item}`).join("\n")
            : "Keine klar belegbaren Unterschiede."
        }`,
        `Gemeinsamkeiten:\n${
          structured.gemeinsamkeiten.length
            ? structured.gemeinsamkeiten.map((item) => `- ${item}`).join("\n")
            : "Keine klar belegbaren Gemeinsamkeiten."
        }`
      ].join("\n\n"),
      structured,
      sources: [...gdlSources, ...evgSources],
      sourcesByUnion: {
        GDL: gdlSources,
        EVG: evgSources
      }
    };
  }

  const topic = detectMainTopic(trimmedQuery);

  const rows = await getBestRows(trimmedQuery, {
    union: options.union,
    vectorLimit: 12,
    finalLimit: 8,
    minSimilarity: 0.35,
    topicKey: topic
  });

  const sources = rowsToSources(rows);

  const answer = await generateAnswer({
    question: trimmedQuery,
    context: formatContext(rows),
    union: options.union
  });

  return {
    mode: "single",
    answer,
    sources
  };
}