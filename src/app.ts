import express, { Express } from "express";
import { authenticate, createTokenService } from "./auth";
import { Clock, systemClock } from "./clock";
import { Context } from "./context";
import { errorHandler, notFound } from "./errors";
import { TokenBucketLimiter } from "./rateLimiter";
import { Repositories } from "./repository";
import { authRoutes } from "./routes/auth";
import { commentRoutes } from "./routes/comments";
import { postRoutes } from "./routes/posts";
import { userRoutes } from "./routes/users";

export interface AppConfig {
  repos: Repositories;
  jwtSecret: string;
  clock?: Clock;
  /** Default 15 minutes. */
  accessTokenTtlSeconds?: number;
  /** bcrypt cost factor. Default 10; tests lower it for speed. */
  passwordHashRounds?: number;
  /** Per client IP. Default: bursts of 5, then one attempt every 12 seconds. */
  loginRateLimit?: { capacity: number; refillEveryMs: number };
  /** Default "200kb"; a post body is capped at 50,000 characters by validation. */
  jsonLimit?: string;
  /** Number of reverse proxies in front of the app, so req.ip is the real client. Default 0. */
  trustProxyHops?: number;
}

export function createApp(config: AppConfig): Express {
  const clock = config.clock ?? systemClock;
  const ctx: Context = {
    repos: config.repos,
    clock,
    tokens: createTokenService(config.jwtSecret, config.accessTokenTtlSeconds ?? 15 * 60, clock),
    passwordHashRounds: config.passwordHashRounds ?? 10,
    loginLimiter: new TokenBucketLimiter({ capacity: 5, refillEveryMs: 12_000, ...config.loginRateLimit, clock }),
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops ?? 0);
  app.use(express.json({ limit: config.jsonLimit ?? "200kb" }));
  app.use(authenticate(ctx.tokens, ctx.repos.users));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(authRoutes(ctx));
  app.use(postRoutes(ctx));
  app.use(commentRoutes(ctx));
  app.use(userRoutes(ctx));

  app.use((_req, _res, next) => next(notFound("Route")));
  app.use(errorHandler);
  return app;
}
