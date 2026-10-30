export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Authentication required") => new HttpError(401, message);
export const forbidden = (message = "You do not have permission to do that") => new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const tooLarge = (message: string) => new HttpError(413, message);
export const serviceUnavailable = (message: string, details?: unknown) =>
  new HttpError(503, message, details);
