export type UnionName = "GDL" | "EVG";

export interface ChatRequestBody {
  query: string;
  union?: UnionName;
  compareUnions?: boolean;
}

export interface SourceItem {
  document: string;
  union: string | null;
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

export interface ChatResponseBody {
  answer: string;
  sources: SourceItem[];
  mode?: "single" | "compare";
  structured?: StructuredCompareAnswer;
  sourcesByUnion?: {
    GDL: SourceItem[];
    EVG: SourceItem[];
  };
}