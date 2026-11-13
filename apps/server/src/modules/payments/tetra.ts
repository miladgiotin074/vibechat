import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { env } from '../../config.js';

/**
 * Tetra98 (تتراپی) online gateway, API v1. https://tetra98.com/docs
 *
 *   POST /payments                 { amount, order_id, callback_url, webhook_url? } → { token, payment_url, ... }
 *   POST /payments/{token}/verify  → { status: created|pending|paid|expired, order_id, amount, method, ... }
 *
 * Amounts are numeric strings in RIAL. The status in the callback query is for display only:
 * only a verify response (status = paid AND order_id + amount match our order) settles a payment.
 */
const BASE = () => (env.TETRA_SANDBOX ? 'https://api.sandbox.tetra98.com/api/v1' : 'https://api.tetra98.com/api/v1');

let dispatcher: Dispatcher | undefined;
function proxy(): Dispatcher | undefined {
  if (!env.TETRA_PROXY_URL) return undefined;
  dispatcher ??= new ProxyAgent(env.TETRA_PROXY_URL);
  return dispatcher;
}

export class TetraError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

async function call(method: 'GET' | 'POST', path: string, body?: Json): Promise<Json> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.TETRA_API_KEY}`,
    accept: 'application/json',
  };
  if (body) headers['content-type'] = 'application/json';
  if (env.TETRA_SANDBOX) headers['x-tetrapay-sandbox'] = 'true';
  const res = await undiciFetch(BASE() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: proxy(),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    throw new TetraError(res.status, 'BAD_RESPONSE', `non-JSON response (${res.status})`);
  }
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: string; message?: string };
    throw new TetraError(res.status, err.code ?? 'HTTP_' + res.status, err.message ?? text.slice(0, 200));
  }
  // Responses may be flat or wrapped in { data: … }.
  return (json.data && typeof json.data === 'object' ? json.data : json) as Json;
}

const str = (v: unknown) => (v == null ? null : String(v));

export interface CreatedPayment {
  token: string;
  paymentUrl: string;
  botPaymentUrl: string | null;
}

export async function createPayment(input: {
  amountRial: number;
  orderId: string;
  callbackUrl: string;
  webhookUrl?: string;
}): Promise<CreatedPayment> {
  const data = await call('POST', '/payments', {
    amount: String(input.amountRial),
    order_id: input.orderId,
    callback_url: input.callbackUrl,
    ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
  });
  const token = str(data.token);
  const paymentUrl = str(data.payment_url);
  if (!token || !paymentUrl) throw new TetraError(502, 'BAD_RESPONSE', 'token or payment_url missing');
  return { token, paymentUrl, botPaymentUrl: str(data.bot_payment_url) };
}

export interface VerifiedPayment {
  status: 'created' | 'pending' | 'paid' | 'expired' | string;
  orderId: string | null;
  amountRial: number | null;
  method: string | null;
  raw: Json;
}

function verified(data: Json): VerifiedPayment {
  const amount = str(data.amount);
  return {
    status: String(data.status ?? ''),
    orderId: str(data.order_id),
    amountRial: amount && /^\d+$/.test(amount) ? Number(amount) : null,
    method: str(data.method),
    raw: data,
  };
}

/** Final verification. Idempotent on the gateway side: calling it again returns the same result. */
export async function verifyPayment(token: string): Promise<VerifiedPayment> {
  return verified(await call('POST', `/payments/${encodeURIComponent(token)}/verify`));
}

/** Read-only status. */
export async function inquirePayment(token: string): Promise<VerifiedPayment> {
  return verified(await call('GET', `/payments/${encodeURIComponent(token)}`));
}
