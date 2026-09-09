export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string): HttpError => new HttpError(400, code, message);
export const notFound = (code: string, message?: string): HttpError => new HttpError(404, code, message);
export const conflict = (code: string, message?: string): HttpError => new HttpError(409, code, message);
