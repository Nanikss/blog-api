import request from "supertest";
import { setup, TestUser } from "./helpers";

const kumar = { email: "Kumar@Example.com", password: "s3cret-passphrase", displayName: "Kumar" };

describe("register and login", () => {
  it("registers a reader, issues a token and never exposes the password hash", async () => {
    const { app } = setup();
    const reg = await request(app).post("/auth/register").send(kumar).expect(201);
    expect(reg.body.user).toMatchObject({ email: "kumar@example.com", role: "reader", displayName: "Kumar" });

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "kumar@example.com", password: kumar.password })
      .expect(200);
    expect(login.body).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body.user.id).toBe(reg.body.user.id);

    for (const body of [reg.body, login.body, me.body]) {
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    }
  });

  it("returns 409 for an email that is already registered, ignoring case", async () => {
    const { app } = setup();
    await request(app).post("/auth/register").send(kumar).expect(201);
    const res = await request(app)
      .post("/auth/register")
      .send({ ...kumar, email: "KUMAR@example.com" })
      .expect(409);
    expect(res.body).toEqual({ error: { code: "EMAIL_TAKEN", message: expect.any(String) } });
  });

  it("gives the same 401 for a wrong password and for an unknown email", async () => {
    const { app } = setup();
    await request(app).post("/auth/register").send(kumar).expect(201);
    const wrongPassword = await request(app).post("/auth/login").send({ email: kumar.email, password: "nope-nope" });
    const unknownEmail = await request(app).post("/auth/login").send({ email: "who@example.com", password: "nope-nope" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects invalid input with field-level details, including a self-assigned admin role", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "not-an-email", password: "short", displayName: " ", role: "admin" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(["displayName", "email", "password", "role"]);
  });
});

describe("access tokens", () => {
  it("rejects missing, malformed and expired tokens with 401", async () => {
    const { app, clock, signUp } = setup();
    const reader = await signUp("reader");
    await request(app).get("/auth/me").set(reader.auth).expect(200);

    await request(app).get("/auth/me").expect(401);
    await request(app).get("/auth/me").set("Authorization", "Bearer not-a-jwt").expect(401);
    await request(app).get("/auth/me").set("Authorization", "Basic abc").expect(401);

    clock.advance(15 * 60);
    const expired = await request(app).get("/auth/me").set(reader.auth).expect(401);
    expect(expired.body.error).toEqual({ code: "UNAUTHORIZED", message: "Access token expired" });
  });

  it("lets only admins change roles, and the change applies to existing tokens", async () => {
    const { app, signUp } = setup();
    const admin = await signUp("admin");
    const author = await signUp("author");
    const reader = await signUp("reader");
    const promote = (actor: TestUser) =>
      request(app).patch(`/users/${reader.id}/role`).set(actor.auth).send({ role: "author" });

    expect((await promote(author)).status).toBe(403);
    await request(app).post("/posts").set(reader.auth).send({ title: "Hi", body: "Hello" }).expect(403);

    const res = await promote(admin).expect(200);
    expect(res.body.user.role).toBe("author");
    await request(app).post("/posts").set(reader.auth).send({ title: "Hi", body: "Hello" }).expect(201);
  });
});

describe("login rate limit", () => {
  it("allows a burst, then answers 429 with Retry-After until a token refills", async () => {
    const { app, clock } = setup({ loginRateLimit: { capacity: 3, refillEveryMs: 10_000 } });
    const attempt = () => request(app).post("/auth/login").send({ email: "x@example.com", password: "guess-123" });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("10");
    expect(limited.body.error.code).toBe("RATE_LIMITED");

    clock.advance(9);
    expect((await attempt()).status).toBe(429);
    clock.advance(1);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});
