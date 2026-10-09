CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE, -- the API lowercases before storing
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('reader', 'author', 'admin')),
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id            UUID PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  author_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL, -- markdown, stored as submitted
  tags          TEXT[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ,
  CHECK (status = 'draft' OR published_at IS NOT NULL)
);

-- Serves the published feed and its keyset cursor: ORDER BY published_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts (published_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS posts_tags_idx ON posts USING GIN (tags);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY,
  post_id     UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES comments (id) ON DELETE CASCADE, -- one level deep, enforced by the API
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS likes (
  post_id     UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id) -- makes a like idempotent at the storage level
);
