import type { ErrorRequestHandler } from 'express';
import type { FieldErrors } from '../shared/bill.js';
import { isConnectionError } from './db.js';

/** An error the user should see, with an HTTP status and optional field messages. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: FieldErrors,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: FieldErrors) => new HttpError(400, message, fields);
export const fieldError = (fields: FieldErrors) => new HttpError(400, 'Please fix the highlighted fields', fields);

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  void _next;
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message, fields: error.fields, code: error.code } });
    return;
  }
  if ((error as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'The request was not valid JSON' } });
    return;
  }
  if (isConnectionError(error)) {
    const message =
      req.method === 'GET'
        ? "The database isn't reachable right now. Try again in a moment."
        : "Couldn't save — the database isn't reachable. Try again in a moment.";
    res.status(503).json({ error: { message, code: 'DB_DOWN' } });
    return;
  }
  console.error(error);
  res.status(500).json({ error: { message: 'Something went wrong. Nothing was changed. Please try again.' } });
};
