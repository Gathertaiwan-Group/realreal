import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const key = req.headers['idempotency-key'];

  if (!key || typeof key !== 'string' || key.length < 16 || key.length > 100) {
    return next();
  }

  const nowIso = new Date().toISOString();

  const { data: existing } = await supabase
    .from('order_idempotency_keys')
    .select('status_code, response_body')
    .eq('key', key)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (existing) {
    return res.status(existing.status_code).json(existing.response_body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    // Only remember SUCCESSFUL responses.
    //
    // The point of this table is "don't create the same order twice". A request
    // that failed created no order, so there is nothing to protect — and
    // storing it does real harm: the browser reuses one Idempotency-Key for
    // every retry of the same attempt, so a cached failure is replayed for the
    // life of the key. The customer presses 前往付款 again, gets the identical
    // error back instantly, and the payment gateway is never even contacted.
    //
    // That is what happened to #10000217 on 2026-09-07: a LINE Pay attempt
    // failed once, and every retry after it returned that same stored 502.
    // The customer only got through by switching payment method, which is the
    // one input change that rotates the key.
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return originalJson(body);
    }

    const orderId =
      body && body.data && body.data.orderId ? body.data.orderId : null;

    supabase
      .from('order_idempotency_keys')
      .insert({
        key,
        user_id: res.locals.userId ?? null,
        guest_email: req.body?.guestEmail ?? null,
        order_id: orderId,
        status_code: res.statusCode,
        response_body: body,
      })
      .then(({ error }: { error: any }) => {
        if (error) {
          console.warn('[idempotency] failed to store key:', error);
        }
      });

    return originalJson(body);
  };

  next();
}
