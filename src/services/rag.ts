type TopicKey = "ruhezeiten" | "arbeitszeit" | "entgelt" | "urlaub" | "unknown";

type TopicSection = {
  key: string;
  title: string;
  searchQueries: string[];
};

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
          searchQueries: [
            "Schichtzeit",
            "Dienstzeit",
            "Arbeitszeit Schicht"
          ]
        },
        {
          key: "pause_mehrarbeit",
          title: "Pausen / Mehrarbeit / Zuschläge",
          searchQueries: [
            "Mehrarbeit",
            "Überstunden",
            "Arbeitszeitzuschlag",
            "Ruhepause"
          ]
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
          searchQueries: [
            "Urlaubsanspruch",
            "Erholungsurlaub",
            "Urlaubstage"
          ]
        },
        {
          key: "lage",
          title: "Lage / Planung / Gewährung",
          searchQueries: [
            "Urlaubsplanung",
            "Gewährung von Urlaub",
            "Hauptjahresurlaub"
          ]
        },
        {
          key: "sonderregeln",
          title: "Sonderregeln / Übertragung / Verfall",
          searchQueries: [
            "Urlaubsübertragung",
            "Urlaubsverfall",
            "Sonderregelung Urlaub"
          ]
        }
      ];

    default:
      return [];
  }
}

async function getRowsForSection(
  baseQuery: string,
  section: TopicSection,
  union: UnionName
): Promise<SearchDocumentRow[]> {
  const rows: SearchDocumentRow[] = [];

  for (const searchQuery of section.searchQueries) {
    const combinedQuery = `${baseQuery} ${searchQuery}`;

    const result = await getBestRows(combinedQuery, {
      union,
      vectorLimit: 12,
      finalLimit: 6,
      minSimilarity: 0.35
    });

    rows.push(...result);
  }

  return normalizeRows(rows, `${baseQuery} ${section.title}`, 0.35, 6);
}

async function buildSectionCompare(
  baseQuery: string,
  section: TopicSection
): Promise<{
  key: string;
  title: string;
  gdl: string;
  evg: string;
  unterschiede: string[];
  gemeinsamkeiten: string[];
  sourcesByUnion: {
    GDL: SourceItem[];
    EVG: SourceItem[];
  };
}> {
  const [gdlRows, evgRows] = await Promise.all([
    getRowsForSection(baseQuery, section, "GDL"),
    getRowsForSection(baseQuery, section, "EVG")
  ]);

  const gdlSources = rowsToSources(gdlRows);
  const evgSources = rowsToSources(evgRows);

  const gdlContext = formatContext(gdlRows);
  const evgContext = formatContext(evgRows);

  if (!gdlRows.length && !evgRows.length) {
    return {
      key: section.key,
      title: section.title,
      gdl: "Für GDL wurden in dieser Unterrubrik keine ausreichend passenden Textstellen gefunden.",
      evg: "Für EVG wurden in dieser Unterrubrik keine ausreichend passenden Textstellen gefunden.",
      unterschiede: [],
      gemeinsamkeiten: [],
      sourcesByUnion: {
        GDL: [],
        EVG: []
      }
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
      gdl: structured.gdl,
      evg: structured.evg,
      unterschiede: structured.unterschiede,
      gemeinsamkeiten: structured.gemeinsamkeiten,
      sourcesByUnion: {
        GDL: gdlSources,
        EVG: evgSources
      }
    };
  } catch (error) {
    console.warn(`[RAG] Strukturierte Teilantwort fehlgeschlagen (${section.title}):`, error);

    return {
      key: section.key,
      title: section.title,
      gdl: gdlRows.length
        ? "Für GDL liegen passende Treffer zu dieser Unterrubrik vor."
        : "Für GDL liegen keine ausreichend passenden Textstellen zu dieser Unterrubrik vor.",
      evg: evgRows.length
        ? "Für EVG liegen passende Treffer zu dieser Unterrubrik vor."
        : "Für EVG liegen keine ausreichend passenden Textstellen zu dieser Unterrubrik vor.",
      unterschiede: [],
      gemeinsamkeiten: [],
      sourcesByUnion: {
        GDL: gdlSources,
        EVG: evgSources
      }
    };
  }
}

function summarizeSectionResults(
  topic: TopicKey,
  sections: Array<{
    title: string;
    gdl: string;
    evg: string;
    unterschiede: string[];
    gemeinsamkeiten: string[];
  }>
): StructuredCompareAnswer {
  const allDifferences = sections.flatMap((s) => s.unterschiede);
  const allSimilarities = sections.flatMap((s) => s.gemeinsamkeiten);

  const kurzfazit =
    sections.length > 0
      ? `Die Frage wurde thematisch in ${sections.length} Unterrubriken zum Oberthema "${topic}" aufgeteilt und getrennt für GDL und EVG ausgewertet.`
      : "Es konnten keine thematisch passenden Unterrubriken ausgewertet werden.";

  const gdl = sections
    .map((section) => `- ${section.title}: ${section.gdl}`)
    .join("\n");

  const evg = sections
    .map((section) => `- ${section.title}: ${section.evg}`)
    .join("\n");

  return {
    kurzfazit,
    gdl,
    evg,
    unterschiede: dedupeStrings(allDifferences),
    gemeinsamkeiten: dedupeStrings(allSimilarities)
  };
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function formatHierarchicalAnswer(
  structured: StructuredCompareAnswer,
  sections: Array<{
    title: string;
    gdl: string;
    evg: string;
    unterschiede: string[];
    gemeinsamkeiten: string[];
  }>
): string {
  const parts: string[] = [];

  parts.push(`1. Kurzfazit\n${structured.kurzfazit}`);

  sections.forEach((section, index) => {
    parts.push(
      `${index + 2}. ${section.title}\nGDL:\n${section.gdl}\n\nEVG:\n${section.evg}\n\nUnterschiede:\n${
        section.unterschiede.length
          ? section.unterschiede.map((item) => `- ${item}`).join("\n")
          : "Keine klar belegbaren Unterschiede im gefundenen Kontext."
      }\n\nGemeinsamkeiten:\n${
        section.gemeinsamkeiten.length
          ? section.gemeinsamkeiten.map((item) => `- ${item}`).join("\n")
          : "Keine klar belegbaren Gemeinsamkeiten im gefundenen Kontext."
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