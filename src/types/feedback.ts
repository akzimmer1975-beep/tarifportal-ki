export type FeedbackTargetType = "source" | "answer" | "custom_source";

export type FeedbackType =
  | "relevant"
  | "preferred"
  | "not_relevant"
  | "answer_good"
  | "answer_bad"
  | "sources_good"
  | "sources_bad"
  | "custom_source";

export interface FeedbackSourceInput {
  documentName?: string;
  unionName?: string;
  tarifType?: string;
  tariffwerk?: string;
  funktionsgruppe?: string;
  pageNumber?: number | null;
  paragraphIndex?: number | null;

  text?: string;
  fullText?: string | null;
  sectionIndex?: number | null;

  similarity?: number | null;
}

export interface FeedbackCustomSourceInput {
  documentName?: string;
  unionName?: string;
  tarifType?: string;
  tariffwerk?: string;
  funktionsgruppe?: string;
  pageNumber?: number | null;
  paragraphIndex?: number | null;
  text?: string;
  comment?: string;
}

export interface CreateFeedbackBody {
  queryText: string;
  normalizedQuery?: string;
  topicKey?: string;
  sectionKey?: string;

  targetType: FeedbackTargetType;
  feedbackType: FeedbackType;

  source?: FeedbackSourceInput;
  customSource?: FeedbackCustomSourceInput;

  answerText?: string;
  userComment?: string;
}

export interface FeedbackRow {
  id: number;
  query_text: string;
  normalized_query: string;
  topic_key: string | null;
  section_key: string | null;
  target_type: FeedbackTargetType;
  feedback_type: FeedbackType;

  source_document_name: string | null;
  source_union_name: string | null;
  source_tarif_type: string | null;
  source_tariffwerk: string | null;
  source_funktionsgruppe: string | null;
  source_page_number: number | null;
  source_paragraph_index: number | null;
  source_text: string | null;
  source_full_text: string | null;
  source_section_index: number | null;
  source_similarity: number | null;

  custom_document_name: string | null;
  custom_union_name: string | null;
  custom_tarif_type: string | null;
  custom_tariffwerk: string | null;
  custom_funktionsgruppe: string | null;
  custom_page_number: number | null;
  custom_paragraph_index: number | null;
  custom_text: string | null;
  custom_comment: string | null;

  answer_text: string | null;
  user_comment: string | null;
  created_at: string;
}