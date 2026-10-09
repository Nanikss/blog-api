import { RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { Clock } from "./clock";
import { User } from "./domain";
import { ApiError, unauthorized } from "./errors";
import { asyncHandler } from "./http";
import { UserRepository } from "./repository";

export interface TokenService {
  issue(userId: string): { accessToken: string; expiresIn: number };
  /** Returns the user id, or throws a 401 ApiError. */
  verify(token: string): string;
}

/**
 * HS256 access tokens that carry only the user id. Role is read from the store on
 * every request, so a promotion or demotion takes effect immediately rather than
 * when the token expires.
 */
export function createTokenService(secret: string, ttlSeconds: number, clock: Clock): TokenService {
  const nowSeconds = () => Math.floor(clock() / 1000);
  return {
    issue(userId) {
      // An explicit iat makes jsonwebtoken compute exp from our clock instead of Date.now().
      const accessToken = jwt.sign({ sub: userId, iat: nowSeconds() }, secret, {
        algorithm: "HS256",
        expiresIn: ttlSeconds,
      });
      return { accessToken, expiresIn: ttlSeconds };
    },
    verify(token) {
      try {
        const payload = jwt.verify(token, secret, { algorithms: ["HS256"], clockTimestamp: nowSeconds() });
        if (typeof payload === "string" || typeof payload.sub !== "string") throw unauthorized("Invalid access token");
        return payload.sub;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if (err instanceof jwt.TokenExpiredError) throw unauthorized("Access token expired");
        throw unauthorized("Invalid access token");
      }
    },
  };
}

/**
 * Resolves the caller from the Authorization header, if one is sent. Anonymous
 * requests pass through; a header that is present but invalid is always a 401,
 * even on public routes, so a broken client finds out instead of silently being
 * treated as logged out.
 */
export function authenticate(tokens: TokenService, users: UserRepository): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return next();
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw unauthorized("Expected 'Authorization: Bearer <token>'");
    const user = await users.findById(tokens.verify(token));
    if (!user) throw unauthorized("Invalid access token");
    res.locals.user = user;
    next();
  });
}

export function currentUser(res: Response): User | undefined {
  return res.locals.user as User | undefined;
}

export function requireUser(res: Response): User {
  const user = currentUser(res);
  if (!user) throw unauthorized();
  return user;
}
