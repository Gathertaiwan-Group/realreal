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
