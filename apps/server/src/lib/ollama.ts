/**
 * Ollama's hosted API (ollama.com), spoken over plain HTTPS — no SDK.
 *
 *   POST https://ollama.com/api/chat   Authorization: Bearer <key>
 *   { model, messages: [{role, content}], stream: false, options: { temperature, num_predict } }
 *   → { message: { role: 'assistant', content: '…' }, done: true, … }
 *
 * The key is an account key from https://ollama.com/settings/keys and lives only on the server, in
 * OLLAMA_API_KEY. Model ids are whatever the account's `/api/tags` lists (for example
 * `gemma4:31b`), so the panel offers that list instead of hard-coding names.
 */
import { env } from '../config.js';

const BASE = 'https://ollama.com';

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const hasOllamaKey = () => !!env.OLLAMA_API_KEY;

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  if (!env.OLLAMA_API_KEY) throw new OllamaError('OLLAMA_API_KEY is not set', 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${env.OLLAMA_API_KEY}`, 'content-type': 'application/json', ...init.headers },
    });
    const text = await res.text();
    if (!res.ok) {
      // the body often explains it (bad model name, no credit left); keep it short for the log
      throw new OllamaError(`ollama ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return text ? (JSON.parse(text) as unknown) : {};
  } catch (e) {
    if (e instanceof OllamaError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new OllamaError('ollama timed out', 504);
    throw new OllamaError(e instanceof Error ? e.message : 'ollama request failed', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** One non-streaming chat turn. Returns the assistant's text, trimmed. */
export async function chat(
  messages: ChatMessage[],
  opts: { model: string; temperature?: number; maxTokens?: number; timeoutMs?: number } = { model: '' },
): Promise<string> {
  const body = {
    model: opts.model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.8,
      num_predict: opts.maxTokens ?? 220,
    },
  };
  const data = (await call('/api/chat', { method: 'POST', body: JSON.stringify(body), timeoutMs: opts.timeoutMs })) as {
    message?: { content?: string };
  };
  const reply = (data.message?.content ?? '').trim();
  if (!reply) throw new OllamaError('ollama returned an empty reply', 502);
  return reply;
}

/** The model ids this account may use, for the panel's dropdown. */
export async function listModels(): Promise<string[]> {
  const data = (await call('/api/tags', { method: 'GET', timeoutMs: 15_000 })) as { models?: { name?: string; model?: string }[] };
  const names = (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
  return [...new Set(names)].sort();
}
