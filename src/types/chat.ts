export type UnionName = "GDL" | "EVG";

export interface ChatRequestBody {
  query: string;
  union?: UnionName;
  compareUnions?: boolean;
}

export interface SourceItem {
  document: string;
  union: string | null;
  tarif?: string | null;
  tarifType?: string | null;
  funktionsgruppe?: string | null;
  page?: number | null;
  paragraph?: number | null;
  text: string;
  similarity?: number | null;
}

export interface StructuredCompareSection {
  key: string;
  title: string;
  summary?: string;

  gdlText: string;
  evgText: string;

  gdlDifferences: string[];
  evgDifferences: string[];

  gdlSources: SourceItem[];
  evgSources: SourceItem[];
}

export interface StructuredCompareAnswer {
  topicKey?: string;
  kurzfazit: string;
  gdl: string;
  evg: string;
  unterschiede: string[];
  gemeinsamkeiten: string[];
  sections?: StructuredCompareSection[];
}

export interface ChatResponseBody {
  answer: string;
  sources: SourceItem[];
  mode?: "single" | "compare";
  structured?: StructuredCompareAnswer;
  sections?: StructuredCompareSection[];
  sourcesByUnion?: {
    GDL: SourceItem[];
    EVG: SourceItem[];
  };
}