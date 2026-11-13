import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env, isProd, miniAppLink } from '../../config.js';
import { sql } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { redis } from '../../lib/redis.js';
import { parse, zUuid } from '../../lib/validate.js';
import { invalidateUser, requireUser } from '../auth/guard.js';
import { notify } from '../notifications/service.js';
import { publishToUser } from '../realtime/bus.js';
import { getSettings } from '../settings/settings.js';
import { createPayment, TetraError, verifyPayment } from './tetra.js';

/** Without an API key (development) a fake gateway page stands in for Tetra98. */
const fakeGateway = () => !env.TETRA_API_KEY && !isProd;
/** The gateway's order id: our payment id without dashes (plain alphanumerics are accepted everywhere). */
const orderIdOf = (paymentId: string) => paymentId.replace(/-/g, '');

interface PaymentRow {
  id: string;
  user_id: string;
  status: string;
  token: string | null;
  amount_toman: number;
  created_at: Date;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** What the payer's browser shows after the gateway: result + a button straight back into the Mini App. */
function resultPage(reply: FastifyReply, ok: boolean, paymentId: string | null, detail: string) {
  const link = miniAppLink(paymentId ? `pay_${paymentId}` : undefined);
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>نتیجه‌ی پرداخت · Vibe Chat</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e0a12;color:#f6eef9;font-family:Vazirmatn,Tahoma,sans-serif}
.card{max-width:360px;margin:24px;padding:36px 24px;border-radius:28px;background:#17111d;text-align:center;border:1px solid #ffffff17}
.icon{font-size:60px}.title{font-size:21px;font-weight:bold;margin:14px 0 8px}.muted{color:#a493b2;font-size:14px;line-height:1.9}
a.btn{display:block;margin-top:26px;padding:15px;border-radius:18px;color:#fff;text-decoration:none;font-weight:bold;
background:linear-gradient(90deg,#ff2d6f,#ff7a45)}</style></head><body><div class="card">
<div class="icon">${ok ? '💎' : '😕'}</div><div class="title">${ok ? 'پرداخت موفق بود' : 'پرداخت انجام نشد'}</div>
<div class="muted">${escapeHtml(detail)}</div><a class="btn" href="${escapeHtml(link)}">بازگشت به Vibe Chat</a></div>
<script>setTimeout(function(){location.href=${JSON.stringify(link)}},${ok ? 1800 : 4000})</script></body></html>`;
  return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
}

/**
 * Marks the payment paid exactly once and delivers what was bought: premium (extended from
 * max(now, current end)), or a pack of boosts / super likes added to the user's balance.
 */
export async function settle(paymentId: string, method: string | null, gatewayData: unknown) {
  const result = await sql.begin(async (tx) => {
    const [p] = await tx<{ user_id: string; duration_days: number; title: string; kind: 'premium' | 'boost' | 'superlikes'; quantity: number }[]>`
      UPDATE payments SET status = 'paid', paid_at = now(), method = ${method},
        gateway_data = ${gatewayData ? tx.json(gatewayData as never) : null}
      FROM plans
      WHERE payments.id = ${paymentId} AND payments.status = 'pending' AND plans.id = payments.plan_id
      RETURNING payments.user_id, plans.duration_days, plans.title, plans.kind, plans.quantity`;
    if (!p) return null;
    if (p.kind === 'boost') {
      await tx`UPDATE users SET boost_credits = boost_credits + ${p.quantity} WHERE id = ${p.user_id}`;
      return { userId: p.user_id, until: null, title: p.title, kind: p.kind, quantity: p.quantity };
    }
    if (p.kind === 'superlikes') {
      await tx`UPDATE users SET bonus_superlikes = bonus_superlikes + ${p.quantity} WHERE id = ${p.user_id}`;
      return { userId: p.user_id, until: null, title: p.title, kind: p.kind, quantity: p.quantity };
    }
    const [u] = await tx<{ premium_until: Date }[]>`
      UPDATE users SET premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => ${p.duration_days})
      WHERE id = ${p.user_id} RETURNING premium_until`;
    return { userId: p.user_id, until: u!.premium_until as Date | null, title: p.title, kind: p.kind, quantity: 0 };
  });
  if (result) {
    await invalidateUser(result.userId);
    await publishToUser(result.userId, { type: 'payment.updated', data: { paymentId, status: 'paid' } });
    await publishToUser(result.userId, { type: 'profile.updated', data: result.until ? { premiumUntil: result.until.toISOString() } : {} });
    const n = result.quantity.toLocaleString('fa-IR');
    await notify(
      result.userId,
      result.kind === 'boost'
        ? { type: 'premium', title: `${n} بوست به حسابت اضافه شد 🚀`, body: 'هر وقت خواستی از صفحه‌ی اصلی بوست رو بزن تا اول از همه دیده بشی.' }
        : result.kind === 'superlikes'
          ? { type: 'premium', title: `${n} سوپرلایک به حسابت اضافه شد ⭐`, body: 'سوپرلایک‌هات منتظرن؛ با ستاره‌ی آبی نشون بده کی رو خیلی پسندیدی.' }
          : {
              type: 'premium',
              title: 'عضویت ویژه فعال شد 💎',
              body: `${result.title} تا ${result.until!.toLocaleDateString('fa-IR')} فعال است. لذتشو ببر!`,
            },
    );
  }
  return result != null;
}

/**
 * Asks the gateway for the final word and applies it. Safe to call any number of times and from
 * several places at once (callback, webhook, the app polling): settle() only flips 'pending' once.
 */
async function confirm(p: PaymentRow): Promise<'paid' | 'pending' | 'failed' | 'expired'> {
  if (p.status === 'paid') return 'paid';
  if (p.status !== 'pending' || !p.token) return p.status === 'expired' ? 'expired' : 'failed';
  if (fakeGateway()) return 'pending';
  const v = await verifyPayment(p.token);
  if (v.status === 'paid') {
    if (v.orderId !== orderIdOf(p.id) || v.amountRial !== p.amount_toman * 10) {
      // Paid, but not what we asked for: never credit it automatically; support resolves it.
      await sql`UPDATE payments SET status = 'failed', gateway_data = ${sql.json(v.raw as never)} WHERE id = ${p.id} AND status = 'pending'`;
      return 'failed';
    }
    await settle(p.id, v.method, v.raw);
    return 'paid';
  }
  if (v.status === 'expired') {
    await sql`UPDATE payments SET status = 'expired' WHERE id = ${p.id} AND status = 'pending'`;
    await publishToUser(p.user_id, { type: 'payment.updated', data: { paymentId: p.id, status: 'expired' } });
    return 'expired';
  }
  return 'pending';
}

async function byToken(token: string): Promise<PaymentRow | undefined> {
  const [p] = await sql<PaymentRow[]>`SELECT id, user_id, status, token, amount_toman, created_at FROM payments WHERE token = ${token}`;
  return p;
}

export async function paymentRoutes(app: FastifyInstance) {
  app.post('/v1/payments', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { planId } = parse(z.object({ planId: zUuid }), req.body);
    const [plan] = await sql<{ id: string; title: string; price_toman: number }[]>`
      SELECT id, title, price_toman FROM plans WHERE id = ${planId} AND is_active`;
    if (!plan) throw notFound('این طرح در دسترس نیست');
    if (!(await getSettings()).paymentsEnabled) throw notFound('پرداخت آنلاین فعلاً فعال نیست');
    const id = uuidv7();
    await sql`INSERT INTO payments (id, user_id, plan_id, amount_toman) VALUES (${id}, ${req.user.id}, ${plan.id}, ${plan.price_toman})`;

    if (fakeGateway()) {
      const token = 'DEV' + orderIdOf(id);
      await sql`UPDATE payments SET token = ${token} WHERE id = ${id}`;
      // relative: the app opens it on its own origin, so it also works through a dev tunnel
      return { paymentId: id, payUrl: `/v1/payments/dev/pay?token=${token}` };
    }
    try {
      const created = await createPayment({
        amountRial: plan.price_toman * 10,
        orderId: orderIdOf(id),
        callbackUrl: `${env.PUBLIC_BASE_URL}/v1/payments/tetra/callback`,
        webhookUrl: env.TETRA_WEBHOOK ? `${env.PUBLIC_BASE_URL}/v1/payments/tetra/webhook` : undefined,
      });
      await sql`UPDATE payments SET token = ${created.token} WHERE id = ${id}`;
      return { paymentId: id, payUrl: created.paymentUrl };
    } catch (e) {
      req.log.error({ err: e, code: e instanceof TetraError ? e.code : undefined }, 'payment create failed');
      await sql`UPDATE payments SET status = 'failed' WHERE id = ${id}`;
      throw new AppError(502, 'gateway_error', 'اتصال به درگاه پرداخت برقرار نشد. چند لحظه بعد دوباره تلاش کن.');
    }
  });

  /** The app polls this while the payer is in the browser; a pending payment is re-verified (throttled). */
  app.get('/v1/payments/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [p] = await sql<(PaymentRow & { paid_at: Date | null; kind: string; quantity: number })[]>`
      SELECT p.id, p.user_id, p.status, p.token, p.amount_toman, p.created_at, p.paid_at, pl.kind, pl.quantity
      FROM payments p JOIN plans pl ON pl.id = p.plan_id WHERE p.id = ${id} AND p.user_id = ${req.user.id}`;
    if (!p) throw notFound();
    let status = p.status;
    if (status === 'pending' && p.token && Date.now() - p.created_at.getTime() > 15_000) {
      const free = await redis.set(`payv:${p.id}`, '1', 'EX', 8, 'NX');
      if (free === 'OK') status = await confirm(p).catch(() => status);
    }
    return { id: p.id, status, amountToman: p.amount_toman, paidAt: status === 'paid' ? (p.paid_at ?? new Date()) : null, kind: p.kind, quantity: p.quantity };
  });

  /** Tetra98 sends the payer's browser here: GET ?token=…&status=… (status is display-only). */
  app.get('/v1/payments/tetra/callback', async (req, reply) => {
    const q = req.query as { token?: string; status?: string };
    if (!q.token || q.token.length > 200) return resultPage(reply, false, null, 'اطلاعات پرداخت ناقص است.');
    const p = await byToken(q.token);
    if (!p) return resultPage(reply, false, null, 'پرداخت پیدا نشد.');
    try {
      const result = await confirm(p);
      if (result === 'paid') return resultPage(reply, true, p.id, 'عضویت ویژه‌ات فعال شد. برگرد و لذتشو ببر 💜');
      if (result === 'pending') {
        return resultPage(reply, false, p.id, 'پرداخت هنوز نهایی نشده است. اگر مبلغی کم شده، چند دقیقه بعد خودکار تأیید می‌شود.');
      }
      return resultPage(reply, false, p.id, 'پرداخت لغو شد یا تأیید نشد. اگر مبلغی کم شده، طبق قوانین بانکی به حسابت برمی‌گردد.');
    } catch (e) {
      req.log.error(e, 'payment verify failed');
      return resultPage(reply, false, p.id, 'خطا در تأیید پرداخت. اگر مبلغی کم شده، چند دقیقه بعد خودکار بررسی می‌شود.');
    }
  });

  /**
   * Server-to-server notice from the gateway (also when the payer never comes back). We don't trust
   * the body: it only tells us which token to verify with the gateway ourselves.
   */
  app.post('/v1/payments/tetra/webhook', { config: { rateLimit: false } }, async (req) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const token = String(b.token ?? b.data?.token ?? b.payment?.token ?? '');
    if (token && token.length <= 200) {
      const p = await byToken(token);
      if (p) await confirm(p).catch((e) => req.log.warn(e, 'webhook verify failed'));
    }
    return { ok: true };
  });

  if (!isProd) {
    app.get('/v1/payments/dev/pay', async (req, reply) => {
      const token = (req.query as { token?: string }).token ?? '';
      const t = encodeURIComponent(token);
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><html dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Tahoma;padding:32px;background:#0e0a12;color:#fff">
<h2>درگاه آزمایشی (فقط محیط توسعه)</h2><p><a style="color:#ff7a45" href="/v1/payments/dev/result?ok=1&token=${t}">✅ پرداخت موفق</a></p>
<p><a style="color:#aaa" href="/v1/payments/dev/result?ok=0&token=${t}">❌ انصراف</a></p></body></html>`);
    });
    app.get('/v1/payments/dev/result', async (req, reply) => {
      const q = req.query as { token?: string; ok?: string };
      const p = q.token ? await byToken(q.token) : undefined;
      if (!p) return resultPage(reply, false, null, 'پرداخت پیدا نشد.');
      if (q.ok === '1') {
        await settle(p.id, 'online', { dev: true });
        return resultPage(reply, true, p.id, 'پرداخت آزمایشی موفق بود.');
      }
      await sql`UPDATE payments SET status = 'canceled' WHERE id = ${p.id} AND status = 'pending'`;
      await publishToUser(p.user_id, { type: 'payment.updated', data: { paymentId: p.id, status: 'canceled' } });
      return resultPage(reply, false, p.id, 'پرداخت لغو شد.');
    });
  }
}

/** Worker: payments left pending (payer closed the browser) are re-checked, then expired. */
export async function reconcilePendingPayments() {
  if (fakeGateway()) return;
  const rows = await sql<PaymentRow[]>`
    SELECT id, user_id, status, token, amount_toman, created_at FROM payments
    WHERE status = 'pending' AND token IS NOT NULL AND created_at < now() - interval '2 minutes' AND created_at > now() - interval '1 day'
    ORDER BY created_at LIMIT 200`;
  for (const p of rows) {
    await confirm(p).catch(() => undefined);
  }
}
