import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import request from "supertest";
import { AppConfig, createApp } from "../src/app";
import { Role } from "../src/domain";
import { createInMemoryRepositories } from "../src/repository";

export class FakeClock {
  constructor(private ms = Date.parse("2026-03-02T09:00:00.000Z")) {}

  readonly now = () => this.ms;

  advance(seconds: number) {
    this.ms += seconds * 1000;
  }
}

export interface TestUser {
  id: string;
  auth: { Authorization: string };
}

const PASSWORD = "correct horse battery";

/**
 * A fresh app on an in-memory store with a fake clock. The login limiter is
 * effectively off here; the rate-limit test configures its own.
 */
export function setup(overrides: Partial<AppConfig> = {}) {
  const clock = new FakeClock();
  const repos = createInMemoryRepositories();
  const app = createApp({
    repos,
    jwtSecret: "test-secret",
    clock: clock.now,
    passwordHashRounds: 4,
    loginRateLimit: { capacity: 1_000, refillEveryMs: 1 },
    ...overrides,
  });

  let count = 0;

  async function signUp(role: Role = "author"): Promise<TestUser> {
    const n = ++count;
    const email = `user${n}@example.com`;
    if (role === "admin") {
      await repos.users.insert({
        id: randomUUID(),
        email,
        displayName: `Admin ${n}`,
        role,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        createdAt: new Date(clock.now()).toISOString(),
      });
    } else {
      await request(app).post("/auth/register").send({ email, password: PASSWORD, displayName: `User ${n}`, role }).expect(201);
    }
    const login = await request(app).post("/auth/login").send({ email, password: PASSWORD }).expect(200);
    return { id: login.body.user.id, auth: { Authorization: `Bearer ${login.body.accessToken}` } };
  }

  /** Creates a post one second after the previous one, so feed order is predictable. */
  async function createPost(
    author: TestUser,
    fields: { title?: string; body?: string; tags?: string[]; status?: "draft" | "published" } = {},
  ) {
    clock.advance(1);
    const res = await request(app)
      .post("/posts")
      .set(author.auth)
      .send({ title: "A post", body: "Some *markdown* body.", status: "published", ...fields })
      .expect(201);
    return res.body;
  }

  return { app, clock, repos, signUp, createPost };
}
