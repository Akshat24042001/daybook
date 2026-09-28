/** Shapes shared by the assistant's server code and its UI. No server imports here. */

export type ChartKind = "bar" | "line" | "area" | "pie" | "stacked";

export interface StatItem {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "warn" | "neutral";
}

export type Block =
  | { type: "stats"; items: StatItem[] }
  | { type: "chart"; chart: ChartKind; title: string; x: string; y: string[]; rows: Record<string, unknown>[]; unit?: string }
  | { type: "table"; title: string; columns: string[]; rows: Record<string, unknown>[]; total?: number }
  | { type: "followups"; items: string[] };

export interface Step {
  name: string;
  why?: string;
  sql: string;
  rows?: number;
  ms?: number;
  error?: string;
}

export interface MessageView {
  id: number;
  role: "user" | "assistant";
  content: string;
  blocks: Block[];
  steps: Step[];
  model: string | null;
  createdAt: string;
}

export interface ChatSummary {
  id: number;
  title: string;
  pinned: boolean;
  /** chosen OpenRouter model id, or null for automatic */
  model: string | null;
  updatedAt: string;
}

/** A free model on OpenRouter, from its live catalogue. */
export interface FreeModel {
  id: string;
  name: string;
  provider: string;
  /** context window in tokens */
  context: number;
  maxOutput: number | null;
  /** release date, YYYY-MM-DD */
  created: string | null;
  tools: boolean;
  reasoning: boolean;
  structured: boolean;
  description: string;
  /** in the app's default fallback list */
  recommended: boolean;
}

export interface MemoryFact {
  id: number;
  fact: string;
  createdAt: string;
}

/** Streamed from /api/assistant, one JSON object per line. */
export type StreamEvent =
  | { t: "chat"; chatId: number; title: string }
  | { t: "status"; text: string }
  | { t: "query"; step: Step }
  | { t: "done"; message: MessageView; title?: string; memoryChanged?: boolean }
  | { t: "error"; error: string };
