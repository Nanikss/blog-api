import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { Router } from "express";
import { requireUser } from "../auth";
import { Context, isoNow } from "../context";
import { User } from "../domain";
import { ApiError, conflict } from "../errors";
import { asyncHandler } from "../http";
import { toPublicUser } from "../presenters";
import { rateLimit } from "../rateLimiter";
import { DuplicateKeyError } from "../repository";
import { loginSchema, registerSchema } from "../validation";

export function authRoutes(ctx: Context): Router {
  const { users } = ctx.repos;
  const router = Router();

  // Compared against when the email is unknown, so a miss costs the same bcrypt
  // work as a wrong password and response time doesn't reveal which emails exist.
  const dummyHash = bcrypt.hashSync("dummy-password-for-timing", ctx.passwordHashRounds);

  router.post(
    "/auth/register",
    asyncHandler(async (req, res) => {
      const input = registerSchema.parse(req.body);
      const user: User = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, ctx.passwordHashRounds),
        createdAt: isoNow(ctx),
      };
      try {
        await users.insert(user);
      } catch (err) {
        if (err instanceof DuplicateKeyError) throw conflict("EMAIL_TAKEN", "An account with that email already exists");
        throw err;
      }
      res.status(201).json({ user: toPublicUser(user) });
    }),
  );

  router.post(
    "/auth/login",
    rateLimit(ctx.loginLimiter, (req) => req.ip ?? "unknown"),
    asyncHandler(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);
      const user = await users.findByEmail(email);
      const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
      if (!user || !passwordMatches) {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
      }
      res.json({ ...ctx.tokens.issue(user.id), tokenType: "Bearer", user: toPublicUser(user) });
    }),
  );

  router.get("/auth/me", (_req, res) => {
    res.json({ user: toPublicUser(requireUser(res)) });
  });

  return router;
}
