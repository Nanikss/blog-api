import { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 does not forward rejected promises to the error handler, so every async route goes through this. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
