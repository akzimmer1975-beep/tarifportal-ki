export type SourceItem = {
  document: string;
  union?: string | null;
  tarif?: string | null;
  tarifType?: string | null;
  funktionsgruppe?: string | null;
  page?: number | null;
  paragraph?: number | null;
  text: string;
  similarity?: number;
};

export type StructuredCompareAnswer = {
  kurzfazit: string;
  gdl: string;
  evg: string;
  unterschiede: string[];
  gemeinsamkeiten: string[];
};

export type ChatResponseBody = {
  mode: "single" | "compare";
  answer: string;
  structured?: StructuredCompareAnswer;
  sources: SourceItem[];
  sourcesByUnion?: {
    GDL: SourceItem[];
    EVG: SourceItem[];
  };
};

export type UnionName = "GDL" | "EVG";