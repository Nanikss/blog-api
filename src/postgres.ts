import { Pool } from "pg";
import { Comment, Post, PostStatus, Role, User } from "./domain";
import {
  CommentRepository,
  DuplicateKeyError,
  LikeRepository,
  PostRepository,
  PublishedPostQuery,
  Repositories,
  UserRepository,
} from "./repository";

// Postgres implementation of the repositories. Cascading deletes and unique
// keys are enforced by the schema in db/schema.sql rather than in code.

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  password_hash: string;
  created_at: Date;
}

interface PostRow {
  id: string;
  slug: string;
  author_id: string;
  title: string;
  body: string;
  tags: string[];
  status: PostStatus;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: Date;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  passwordHash: r.password_hash,
  createdAt: r.created_at.toISOString(),
});

const toPost = (r: PostRow): Post => ({
  id: r.id,
  slug: r.slug,
  authorId: r.author_id,
  title: r.title,
  body: r.body,
  tags: r.tags,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  publishedAt: r.published_at ? r.published_at.toISOString() : null,
});

const toComment = (r: CommentRow): Comment => ({
  id: r.id,
  postId: r.post_id,
  authorId: r.author_id,
  parentId: r.parent_id,
  body: r.body,
  createdAt: r.created_at.toISOString(),
});

const UNIQUE_VIOLATION = "23505";

async function mapUniqueViolation<T>(key: "email" | "slug", work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new DuplicateKeyError(key);
    throw err;
  }
}

/** Escapes LIKE wildcards so search terms match literally. */
const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string) {
    const r = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return r.rows[0] && toUser(r.rows[0]);
  }

  async findByEmail(email: string) {
    const r = await this.pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    return r.rows[0] && toUser(r.rows[0]);
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const r = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = ANY($1::uuid[])", [ids]);
    return r.rows.map(toUser);
  }

  async insert(user: User) {
    await mapUniqueViolation(
      "email",
      this.pool.query(
        `INSERT INTO users (id, email, display_name, role, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, user.email, user.displayName, user.role, user.passwordHash, user.createdAt],
      ),
    );
  }

  async updateRole(id: string, role: Role) {
    const r = await this.pool.query<UserRow>("UPDATE users SET role = $2 WHERE id = $1 RETURNING *", [id, role]);
    return r.rows[0] && toUser(r.rows[0]);
  }
}

class PostgresPostRepository implements PostRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string) {
    const r = await this.pool.query<PostRow>("SELECT * FROM posts WHERE id = $1", [id]);
    return r.rows[0] && toPost(r.rows[0]);
  }

  async findBySlug(slug: string) {
    const r = await this.pool.query<PostRow>("SELECT * FROM posts WHERE slug = $1", [slug]);
    return r.rows[0] && toPost(r.rows[0]);
  }

  async slugsStartingWith(base: string) {
    const r = await this.pool.query<{ slug: string }>("SELECT slug FROM posts WHERE slug = $1 OR slug LIKE $2", [
      base,
      `${escapeLike(base)}-%`,
    ]);
    return r.rows.map((row) => row.slug);
  }

  async insert(post: Post) {
    await mapUniqueViolation(
      "slug",
      this.pool.query(
        `INSERT INTO posts (id, slug, author_id, title, body, tags, status, created_at, updated_at, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          post.id,
          post.slug,
          post.authorId,
          post.title,
          post.body,
          post.tags,
          post.status,
          post.createdAt,
          post.updatedAt,
          post.publishedAt,
        ],
      ),
    );
  }

  async update(post: Post) {
    await mapUniqueViolation(
      "slug",
      this.pool.query(
        `UPDATE posts SET slug = $2, title = $3, body = $4, tags = $5, status = $6, updated_at = $7, published_at = $8
         WHERE id = $1`,
        [post.id, post.slug, post.title, post.body, post.tags, post.status, post.updatedAt, post.publishedAt],
      ),
    );
  }

  async delete(id: string) {
    await this.pool.query("DELETE FROM posts WHERE id = $1", [id]);
  }

  async listPublished({ limit, after, tag, search = [] }: PublishedPostQuery) {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = ["status = 'published'"];
    if (tag) where.push(`tags @> ARRAY[${param(tag)}]::text[]`);
    for (const term of search) {
      const p = param(`%${escapeLike(term)}%`);
      where.push(`(title ILIKE ${p} OR body ILIKE ${p})`);
    }
    if (after) {
      where.push(`(published_at, id) < (${param(after.publishedAt)}::timestamptz, ${param(after.id)}::uuid)`);
    }
    const sql = `SELECT * FROM posts WHERE ${where.join(" AND ")}
                 ORDER BY published_at DESC, id DESC LIMIT ${param(limit)}`;
    const r = await this.pool.query<PostRow>(sql, params);
    return r.rows.map(toPost);
  }

  async listByAuthor(authorId: string) {
    const r = await this.pool.query<PostRow>("SELECT * FROM posts WHERE author_id = $1 ORDER BY updated_at DESC", [
      authorId,
    ]);
    return r.rows.map(toPost);
  }
}

class PostgresCommentRepository implements CommentRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string) {
    const r = await this.pool.query<CommentRow>("SELECT * FROM comments WHERE id = $1", [id]);
    return r.rows[0] && toComment(r.rows[0]);
  }

  async insert(comment: Comment) {
    await this.pool.query(
      `INSERT INTO comments (id, post_id, author_id, parent_id, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [comment.id, comment.postId, comment.authorId, comment.parentId, comment.body, comment.createdAt],
    );
  }

  async listByPost(postId: string) {
    const r = await this.pool.query<CommentRow>(
      "SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at, id",
      [postId],
    );
    return r.rows.map(toComment);
  }

  async delete(id: string) {
    await this.pool.query("DELETE FROM comments WHERE id = $1", [id]);
  }
}

class PostgresLikeRepository implements LikeRepository {
  constructor(private readonly pool: Pool) {}

  async add(postId: string, userId: string) {
    await this.pool.query("INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      postId,
      userId,
    ]);
  }

  async remove(postId: string, userId: string) {
    await this.pool.query("DELETE FROM likes WHERE post_id = $1 AND user_id = $2", [postId, userId]);
  }

  async count(postIds: string[]) {
    const counts = new Map(postIds.map((id) => [id, 0]));
    if (postIds.length === 0) return counts;
    const r = await this.pool.query<{ post_id: string; n: number }>(
      "SELECT post_id, count(*)::int AS n FROM likes WHERE post_id = ANY($1::uuid[]) GROUP BY post_id",
      [postIds],
    );
    for (const row of r.rows) counts.set(row.post_id, row.n);
    return counts;
  }
}

export function createPostgresRepositories(pool: Pool): Repositories {
  return {
    users: new PostgresUserRepository(pool),
    posts: new PostgresPostRepository(pool),
    comments: new PostgresCommentRepository(pool),
    likes: new PostgresLikeRepository(pool),
  };
}
