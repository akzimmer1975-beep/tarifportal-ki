import OpenAI from "openai";
import { z } from "zod";
import type { StructuredCompareAnswer } from "../types/chat.js";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const structuredCompareSchema = z.object({
  kurzfazit: z.string(),
  gdl: z.string(),
  evg: z.string(),
  unterschiede: z.array(z.string()),
  gemeinsamkeiten: z.array(z.string())
});

function stripMarkdownCodeFences(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  return trimmed;
}

export async function generateRagAnswer(params: {
  question: string;
  context: string;
}): Promise<string> {
  const response = await openai.responses.create({
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
    instructions: `
Du bist ein Assistent für ein deutsches Tarifvergleichsportal.

Regeln:
- Beantworte die Frage ausschließlich auf Basis des bereitgestellten Kontexts.
- Wenn der Kontext nur teilweise passt, sage das ausdrücklich.
- Wenn keine klare Regelung aus dem Kontext hervorgeht, sage das klar.
- Erfinde keine Tarifregelungen, Paragraphen oder Quellen.
- Nutze Verweise wie [Quelle 1], [Quelle 2].
- Antworte auf Deutsch, präzise und sachlich.
    `.trim(),
    input: `Frage:\n${params.question}\n\nKontext:\n${params.context}`
  });

  return response.output_text?.trim() || "Keine Antwort erzeugt.";
}

export async function generateComparisonAnswer(params: {
  question: string;
  gdlContext: string;
  evgContext: string;
}): Promise<string> {
  const response = await openai.responses.create({
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
    instructions: `
Du bist ein Assistent für ein deutsches Tarifvergleichsportal.

Aufgabe:
- Vergleiche GDL und EVG ausschließlich anhand des bereitgestellten Kontexts.
- Trenne sauber zwischen GDL und EVG.
- Nenne Gemeinsamkeiten und Unterschiede nur, wenn sie aus dem Kontext hervorgehen.
- Wenn für eine Seite keine verlässlichen Informationen vorliegen, sage das ausdrücklich.
- Erfinde keine Tarifregelungen, Paragraphen oder Quellen.
- Nutze Verweise wie [GDL Quelle 1] oder [EVG Quelle 1].
- Antworte auf Deutsch.
- Struktur:
  1. Kurzfazit
  2. GDL
  3. EVG
  4. Unterschiede/Gemeinsamkeiten
    `.trim(),
    input: `
Frage:
${params.question}

Kontext GDL:
${params.gdlContext}

Kontext EVG:
${params.evgContext}
    `
  });

  return response.output_text?.trim() || "Keine Vergleichsantwort erzeugt.";
}

export async function generateStructuredComparisonAnswer(params: {
  question: string;
  gdlContext: string;
  evgContext: string;
}): Promise<StructuredCompareAnswer> {
  const response = await openai.responses.create({
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
    instructions: `
Du bist ein Assistent für ein deutsches Tarifvergleichsportal.

Aufgabe:
- Vergleiche GDL und EVG ausschließlich anhand des bereitgestellten Kontexts.
- Verwende nur Informationen, die sich klar aus dem Kontext ergeben.
- Wenn für GDL oder EVG keine verlässliche Aussage möglich ist, schreibe das ausdrücklich.
- Erfinde keine Tarifregelungen, Paragraphen oder Quellen.
- Alle Texte auf Deutsch.
- Gib ausschließlich gültiges JSON zurück.
- Keine Markdown-Codeblöcke.
- Keine Einleitung, keine Erklärungen außerhalb des JSON.

Das JSON muss exakt diese Struktur haben:
{
  "kurzfazit": "string",
  "gdl": "string",
  "evg": "string",
  "unterschiede": ["string"],
  "gemeinsamkeiten": ["string"]
}

Regeln für Inhalte:
- "kurzfazit": 1 bis 3 Sätze
- "gdl": kurzer Absatz nur zu GDL
- "evg": kurzer Absatz nur zu EVG
- "unterschiede": Liste der klar belegbaren Unterschiede
- "gemeinsamkeiten": Liste der klar belegbaren Gemeinsamkeiten
- Wenn keine Gemeinsamkeiten oder Unterschiede sicher ableitbar sind, gib ein leeres Array zurück
    `.trim(),
    input: `
Frage:
${params.question}

Kontext GDL:
${params.gdlContext}

Kontext EVG:
${params.evgContext}
    `
  });

  const raw = response.output_text?.trim();

  if (!raw) {
    throw new Error("Keine strukturierte Vergleichsantwort erzeugt.");
  }

  const parsed = JSON.parse(stripMarkdownCodeFences(raw));
  return structuredCompareSchema.parse(parsed);
}