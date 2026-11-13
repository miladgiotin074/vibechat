import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses request input; a failure becomes a 400 with the field paths in `details`. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('اطلاعات ارسالی نامعتبر است', issues);
  }
  return result.data;
}

export const zUuid = z.string().uuid();
export const zId = z.string().regex(/^\d{1,19}$/);
export const zLimit = (max = 50, def = 20) => z.coerce.number().int().min(1).max(max).default(def);
