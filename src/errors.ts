import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/** An error that maps directly onto the `{ error: { code, message, details? } }` response shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const unauthorized = (message = "Authentication required") => new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message: string) => new ApiError(403, "FORBIDDEN", message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

const errorBody = (code: string, message: string, details?: unknown) => ({ error: { code, message, details } });

/** Errors raised by express.json() (body-parser) carry an HTTP status and a `type`. */
function isBodyParserError(err: unknown): err is { status: number; type: string; message: string } {
  return typeof err === "object" && err !== null && typeof (err as { type?: unknown }).type === "string"
    && typeof (err as { status?: unknown }).status === "number";
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json(errorBody(err.code, err.message, err.details));
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return res.status(400).json(errorBody("VALIDATION_ERROR", "Request validation failed", details));
  }
  if (isBodyParserError(err)) {
    if (err.type === "entity.too.large") {
      return res.status(413).json(errorBody("PAYLOAD_TOO_LARGE", "Request body is too large"));
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json(errorBody("MALFORMED_JSON", "Request body is not valid JSON"));
    }
    return res.status(err.status).json(errorBody("BAD_REQUEST", err.message));
  }
  console.error(err);
  return res.status(500).json(errorBody("INTERNAL", "Something went wrong"));
};
