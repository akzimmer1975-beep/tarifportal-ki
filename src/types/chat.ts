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
  similarity: number;
}

export interface StructuredCompareAnswer {
  kurzfazit: string;
  gdl: string;
  evg: string;
  unterschiede: string[];
  gemeinsamkeiten: string[];
}

export interface StructuredCompareSection {
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