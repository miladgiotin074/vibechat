/**
 * Errors the API returns on purpose. `code` is stable and machine-readable (the app switches on it);
 * `message` is Persian and safe to show to the user.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message = 'درخواست نامعتبر است', details?: unknown) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'لطفاً دوباره وارد شوید') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'دسترسی ندارید', code = 'forbidden') => new AppError(403, code, message);
export const notFound = (message = 'پیدا نشد') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
export const tooMany = (message = 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.', code = 'rate_limited') =>
  new AppError(429, code, message);
