import { env } from "../config/env";
import { logger } from "../utils/logger";

export class AIServiceError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 502, details?: unknown) {
    super(message);
    this.name = "AIServiceError";
    this.status = status;
    this.details = details;
  }
}

export interface OllamaHealth {
  ok: boolean;
  model: string;
  modelAvailable: boolean;
  models: string[];
  error?: string;
  latencyMs: number;
}

export async function checkOllamaHealth(timeoutMs = 3000): Promise<OllamaHealth> {
  const started = Date.now();
  try {
    const response = await fetch(`${env.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        model: env.ollamaModel,
        modelAvailable: false,
        models: [],
        error: `HTTP ${response.status}`,
        latencyMs: Date.now() - started,
      };
    }
    const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
    const models = (body.models ?? [])
      .map((entry) => entry.name || entry.model || "")
      .filter((name): name is string => Boolean(name));
    const target = env.ollamaModel;
    const base = target.split(":")[0]!;
    const modelAvailable = models.some((name) => {
      const normalized = name.trim();
      return (
        normalized === target ||
        normalized === `${target}:latest` ||
        (normalized.split(":")[0] === base && target.includes(":")) ||
        (normalized.split(":")[0] === base && !target.includes(":"))
      );
    });
    return {
      ok: true,
      model: target,
      modelAvailable,
      models,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      model: env.ollamaModel,
      modelAvailable: false,
      models: [],
      error: error instanceof Error ? error.message : "Ollama unreachable",
      latencyMs: Date.now() - started,
    };
  }
}

export interface GenerateOptions {
  system: string;
  prompt: string;
  temperature?: number;
}

export interface GenerateResult {
  content: string;
  model: string;
  durationMs: number;
}

/**
 * Calls Ollama's JSON mode. The response is guaranteed to be JSON syntax by
 * Ollama, but callers must still validate it against a schema.
 */
export async function generateJson(options: GenerateOptions): Promise<GenerateResult> {
  const started = Date.now();
  const body = {
    model: env.ollamaModel,
    stream: false,
    format: "json",
    options: {
      temperature: options.temperature ?? 0.15,
      num_ctx: env.ollamaNumCtx,
      top_p: 0.9,
    },
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.prompt },
    ],
  };

  let response: Response;
  try {
    response = await fetch(`${env.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.ollamaTimeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    logger.warn(`Ollama request failed: ${message}`);
    throw new AIServiceError(
      `Ollama is not reachable at ${env.ollamaUrl}. Start Ollama and pull the configured model (${env.ollamaModel}).`,
      503,
      message,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AIServiceError(
      `Ollama returned HTTP ${response.status}. ${text.slice(0, 400)}`.trim(),
      502,
    );
  }

  const payload = (await response.json()) as {
    message?: { content?: string };
    model?: string;
  };
  const content = payload.message?.content?.trim() ?? "";
  if (!content) {
    throw new AIServiceError("Ollama returned an empty response. Is the model fully pulled?");
  }

  return {
    content,
    model: payload.model || env.ollamaModel,
    durationMs: Date.now() - started,
  };
}

/** Extracts the JSON object from a model response, tolerating markdown fences. */
export function extractJson(content: string): unknown {
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new AIServiceError("The model did not return a JSON object.");
  }
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch (error) {
    throw new AIServiceError(
      "The model returned malformed JSON.",
      502,
      error instanceof Error ? error.message : undefined,
    );
  }
}
