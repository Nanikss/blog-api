# Blog API

[![CI](https://github.com/Nanikss/blog-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Nanikss/blog-api/actions/workflows/ci.yml)

A REST API for a small blog platform: **register/login → write drafts → publish → comment and like**. I built it to show the parts of a content API that are easy to get subtly wrong: who can see and change what, stable URLs, pagination that doesn't skip or repeat rows, and writes that are safe to retry.

**Stack:** TypeScript · Express 4 · zod · jsonwebtoken · bcryptjs · Postgres (`pg`) or in-memory · Jest + supertest.

## What it does

1. **Auth with roles.** Register and log in with email and password (bcrypt-hashed). Login returns a short-lived JWT access token (15 minutes). Users are `reader`, `author` or `admin`. Anyone can sign up as a reader or author; only an admin can make someone an admin.
2. **Posts.** Authors create, edit and delete their own posts; admins can edit or delete any post. Posts start as drafts and are published explicitly. Each post gets a URL slug from its title (`my-post`, then `my-post-2` on a collision).
3. **Published feed.** Newest first, with cursor pagination, a tag filter, and a simple search where every term must appear in the title or body.
4. **Comments.** Only on published posts, with replies nested one level deep. A comment can be deleted by whoever wrote it, by the post's author, or by an admin.
5. **Likes.** One like per user per post. Liking twice or unliking twice changes nothing, and every post carries a like count.
6. **SEO fields.** `GET /posts/:slug` returns `meta.title`, `meta.description` (a plain-text excerpt of the body, up to 160 characters) and `meta.canonicalPath`.

The body is **markdown, stored exactly as submitted**. The API doesn't render it and doesn't sanitise or escape HTML. Rendering markdown and sanitising the HTML is the client's job, because only the client knows where the output will end up.

## Design decisions

- **Repository pattern.** Routes only see the `Repositories` interface (`src/repository.ts`). The in-memory implementation is the default and backs every test. The Postgres implementation (`src/postgres.ts`, `db/schema.sql`) is selected by `DATABASE_URL`. Uniqueness and cascading deletes are part of the contract: both stores raise `DuplicateKeyError` for a taken email or slug, and deleting a post removes its comments and likes. Postgres does this with a unique index and `ON DELETE CASCADE`; the in-memory store does it in code.
- **Slug strategy.** `slugify` lowercases the title, strips accents and punctuation, and caps the slug at 80 characters on a word boundary. If the slug is taken, it adds the lowest free `-N`. Two requests can still pick the same slug at the same moment, so the unique index is the real guard: on `DuplicateKeyError` the route picks again (up to 3 tries). A slug follows the title while the post is a draft and is **frozen at first publish**, because by then links to it may exist.
- **Visibility vs permission.** Every rule is in `src/access.ts`. If you can't see a resource (someone else's draft), you get **404**, so drafts don't leak their existence. If you can see it but can't change it, you get **403**. No token, or a bad one, is **401**. A taken email is **409**.
- **Idempotent likes.** `PUT /posts/:slug/like` and `DELETE /posts/:slug/like`. These verbs are idempotent by definition, so a client can safely retry them. The `(post_id, user_id)` primary key with `ON CONFLICT DO NOTHING` enforces this at the storage level.
- **Cursor pagination.** The feed is ordered by `(publishedAt DESC, id DESC)`. The cursor is that pair for the last row, base64url-encoded. Unlike an offset, it doesn't skip or repeat posts when new ones are published between pages, and Postgres serves it from the partial index `posts_feed_idx`. The route fetches `limit + 1` rows to know whether a next page exists, so no `COUNT` query is needed.
- **One error shape.** Every failure returns `{ "error": { "code", "message", "details?" } }`. zod failures become `400 VALIDATION_ERROR` with one `{ path, message }` per field. Body-parser failures become `MALFORMED_JSON` (400) and `PAYLOAD_TOO_LARGE` (413). Anything unexpected is logged and returned as a plain `500 INTERNAL`.
- **Rate limiting.** Login is limited per client IP with a token bucket I wrote myself (`src/rateLimiter.ts`): bursts of 5, then one attempt every 12 seconds. Refill is computed lazily from an injected clock, so tests can move time forward without sleeping. Blocked requests get `429` with `Retry-After`.
- **Tokens carry only the user id.** The role is loaded from the store on every request, so a promotion or demotion takes effect immediately instead of when the token expires. Tokens are pinned to HS256 on verify.
- **Small hardening steps.** JSON bodies are capped at 200 kB. Request body schemas are `.strict()`, so a client can't slip in `authorId` or `role: "admin"`. Password hashes never appear in a response (`toPublicUser`). Passwords over 72 bytes are rejected instead of being silently truncated by bcrypt. A login for an unknown email still runs a bcrypt compare, so response timing doesn't reveal which emails exist.

## API

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/register` | anyone | `{ email, password, displayName, role? }`, role is `reader` (default) or `author` |
| POST | `/auth/login` | anyone | returns `{ accessToken, tokenType, expiresIn, user }`; rate limited |
| GET | `/auth/me` | signed in | the current user |
| PATCH | `/users/:id/role` | admin | `{ role }` |
| GET | `/posts` | anyone | published only; `?limit=1..50&cursor=&tag=&q=` returns `{ items, nextCursor }` |
| POST | `/posts` | author, admin | `{ title, body, tags?, status? }`; 201 with `Location` |
| GET | `/posts/:slug` | anyone | full post + `meta`; drafts only for their author or an admin |
| PATCH | `/posts/:slug` | owner, admin | any of `title`, `body`, `tags`, `status` |
| DELETE | `/posts/:slug` | owner, admin | 204; also removes comments and likes |
| GET | `/users/me/posts` | signed in | your posts, drafts included |
| PUT | `/posts/:slug/like` | signed in | idempotent; returns `{ liked, likeCount }` |
| DELETE | `/posts/:slug/like` | signed in | idempotent |
| GET | `/posts/:slug/comments` | anyone | top-level comments, each with `replies` |
| POST | `/posts/:slug/comments` | signed in | `{ body, parentId? }`; replying to a reply returns `422 REPLY_DEPTH_EXCEEDED` |
| DELETE | `/comments/:id` | commenter, post author, admin | 204; also removes its replies |

## Run

```bash
npm install
npm run build
JWT_SECRET=change-me ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=admin-pass-123 npm start   # in-memory store on :4000

# Postgres instead:
psql "$DATABASE_URL" -f db/schema.sql
DATABASE_URL=postgres://localhost/blog JWT_SECRET=change-me npm start
```

`ADMIN_EMAIL` and `ADMIN_PASSWORD` create the first admin if that account doesn't exist yet. Set `TRUST_PROXY_HOPS` when the app runs behind a load balancer, so the rate limiter sees the real client IP.

## Tests

```bash
npm test    # 32 tests
```

The tests run the whole HTTP stack through supertest against the in-memory store, with a fake clock. They cover the register and login flows, duplicate emails, identical 401s for a wrong password and an unknown email, expired tokens, role changes, and the login rate limit (time is moved forward instead of slept). They also check 403s for non-owners, slug collisions and slug freezing, drafts hidden from the feed and from other users, cursor paging with no gaps or repeats, tag and search filters, the comment depth limit and delete rules, like idempotency, and the error shape for validation, malformed JSON and oversized bodies. Unit tests cover slugify, the token bucket, excerpts and cursors. CI (`.github/workflows/ci.yml`) runs the build and the tests on every push and pull request.

## Layout

```
src/app.ts            createApp(config): middleware, routes, error handler
src/index.ts          entry point: picks the store, creates the first admin, listens
src/access.ts         every visibility and permission rule
src/auth.ts           JWT issue/verify, authenticate middleware, requireUser
src/rateLimiter.ts    token bucket with an injectable clock + Express middleware
src/repository.ts     repository interfaces + in-memory implementation
src/postgres.ts       Postgres implementation (pg)
src/slug.ts           slugify, collision suffixes
src/seo.ts            markdown excerpt + meta fields
src/pagination.ts     keyset cursor encode/decode
src/validation.ts     zod request schemas
src/presenters.ts     response shapes (no password hashes)
src/errors.ts         ApiError + the single error handler
src/routes/           auth, users, posts (+ likes), comments
db/schema.sql         tables, foreign keys with cascades, feed/tag indexes
test/                 supertest API tests + unit tests
```

## Interview notes

- **Access tokens only.** A 15-minute JWT with no refresh token means users log in again often. Next I'd add rotating refresh tokens stored hashed server-side, so a session can be revoked and a reused refresh token can be detected.
- **The rate limiter is per process.** It's correct for one instance, but behind a load balancer each instance has its own buckets. I'd move the same token-bucket logic to Redis (an atomic Lua script) so all instances share limits, and I'd also key by account to slow down attacks spread across many IPs.
- **Search is substring matching.** `ILIKE` on title and body is fine at this size but can't use an index and doesn't rank results. In Postgres I'd add a generated `tsvector` column with a GIN index and rank with `ts_rank`. The repository interface wouldn't change.
- **Like counts are computed on read.** A grouped `COUNT` over the primary key is cheap for a page of posts. If the feed got hot, I'd keep a counter column updated in the same transaction as the like, and treat the `likes` table as the source of truth.
- **Slugs are frozen at first publish, with no redirects.** Renaming a published post keeps its old slug. A cleaner fix would let the slug change and keep a `slug_history` table that returns a 301 from old slugs.

Built with AI coding tools; I designed the API and access rules, and reviewed and tested the code.
