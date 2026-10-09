import { TokenService } from "./auth";
import { Clock } from "./clock";
import { TokenBucketLimiter } from "./rateLimiter";
import { Repositories } from "./repository";

/** Everything a route module needs, built once in createApp. */
export interface Context {
  repos: Repositories;
  clock: Clock;
  tokens: TokenService;
  passwordHashRounds: number;
  loginLimiter: TokenBucketLimiter;
}

export const isoNow = (ctx: Context) => new Date(ctx.clock()).toISOString();
