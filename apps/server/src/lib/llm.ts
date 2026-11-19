/**
 * The language model behind the AI profiles, spoken over plain HTTPS — no SDK.
 *
 * Any OpenAI-compatible gateway works, which is nearly all of them:
 *   POST <base>/chat/completions   Authorization: Bearer <key>
 *   { model, messages: [{role, content}], stream: false, temperature, max_tokens }
 *   → { choices: [{ message: { role: 'assistant', content: '…' } }], usage: {…} }
 *
 * The default base is llmka.dev's gateway (https://api.llmka.dev/v1): one key for many providers'
 * models. Point LLM_BASE_URL somewhere else — another gateway, a vendor's own API, an Ollama
 * server's /v1 — and nothing here changes. The key lives only in the server's env (LLM_API_KEY).
 * Model ids come from the account itself (GET <base>/models), so none are hard-coded.
 */
import { env } from '../config.js';

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const hasLlmKey = () => !!env.LLM_API_KEY;
/** Where requests go, for the panel to show (no key in it). */
export const llmBase = () => env.LLM_BASE_URL.replace(/\/+$/, '');

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  if (!env.LLM_API_KEY) throw new LlmError('LLM_API_KEY is not set', 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${llmBase()}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${env.LLM_API_KEY}`, 'content-type': 'application/json', ...init.headers },
    });
    const text = await res.text();
    if (!res.ok) {
      // the body usually explains it (unknown model, no balance, rate limit); keep it short for the log
      throw new LlmError(`llm ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return text ? (JSON.parse(text) as unknown) : {};
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new LlmError('llm request timed out', 504);
    throw new LlmError(e instanceof Error ? e.message : 'llm request failed', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** One non-streaming chat turn. Returns the assistant's text, trimmed. */
export async function chat(
  messages: ChatMessage[],
  opts: { model: string; temperature?: number; maxTokens?: number; timeoutMs?: number } = { model: '' },
): Promise<string> {
  if (!opts.model) throw new LlmError('no model chosen (set one in the panel)', 0);
  const body = {
    model: opts.model,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 220,
  };
  const data = (await call('/chat/completions', { method: 'POST', body: JSON.stringify(body), timeoutMs: opts.timeoutMs })) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new LlmError(`llm: ${data.error.message.slice(0, 300)}`, 502);
  const reply = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!reply) throw new LlmError('the model returned an empty reply', 502);
  return reply;
}

/** The model ids this key may use, for the panel's dropdown. */
export async function listModels(): Promise<string[]> {
  const data = (await call('/models', { method: 'GET', timeoutMs: 20_000 })) as
    | { data?: { id?: string; name?: string }[] }
    | { id?: string; name?: string }[];
  const rows = Array.isArray(data) ? data : (data.data ?? []);
  const ids = rows.map((m) => m.id ?? m.name ?? '').filter(Boolean);
  return [...new Set(ids)].sort();
}
