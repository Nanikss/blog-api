import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { createApp } from "./app";
import { createPostgresRepositories } from "./postgres";
import { createInMemoryRepositories, Repositories } from "./repository";

/** Admins cannot self-register, so the first one is created from the environment. */
async function ensureAdmin(repos: Repositories) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || (await repos.users.findByEmail(email))) return;
  await repos.users.insert({
    id: randomUUID(),
    email,
    displayName: "Admin",
    role: "admin",
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
  });
  console.log(`created admin ${email}`);
}

async function main() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET must be set");

  const databaseUrl = process.env.DATABASE_URL;
  const repos = databaseUrl
    ? createPostgresRepositories(new Pool({ connectionString: databaseUrl }))
    : createInMemoryRepositories();
  await ensureAdmin(repos);

  const app = createApp({ repos, jwtSecret, trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0) });
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`blog-api on http://localhost:${port} (store: ${databaseUrl ? "postgres" : "memory"})`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
