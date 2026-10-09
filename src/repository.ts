import { Comment, Post, Role, User } from "./domain";
import { Cursor } from "./pagination";

/** Thrown by any store when a unique key (user email, post slug) is already taken. */
export class DuplicateKeyError extends Error {
  constructor(readonly key: "email" | "slug") {
    super(`duplicate ${key}`);
    this.name = "DuplicateKeyError";
  }
}

export interface PublishedPostQuery {
  limit: number;
  after?: Cursor;
  tag?: string;
  /** Lowercased terms; every one must appear in the title or body. */
  search?: string[];
}

export interface UserRepository {
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByIds(ids: string[]): Promise<User[]>;
  /** @throws DuplicateKeyError("email") */
  insert(user: User): Promise<void>;
  updateRole(id: string, role: Role): Promise<User | undefined>;
}

export interface PostRepository {
  findById(id: string): Promise<Post | undefined>;
  findBySlug(slug: string): Promise<Post | undefined>;
  /** Slugs equal to `base` or starting with `base-`, used to pick the next free suffix. */
  slugsStartingWith(base: string): Promise<string[]>;
  /** @throws DuplicateKeyError("slug") */
  insert(post: Post): Promise<void>;
  /** @throws DuplicateKeyError("slug") */
  update(post: Post): Promise<void>;
  /** Also removes the post's comments and likes. */
  delete(id: string): Promise<void>;
  /** Published posts, newest first, ordered by (publishedAt DESC, id DESC). */
  listPublished(query: PublishedPostQuery): Promise<Post[]>;
  /** All of an author's posts including drafts, most recently updated first. */
  listByAuthor(authorId: string): Promise<Post[]>;
}

export interface CommentRepository {
  findById(id: string): Promise<Comment | undefined>;
  insert(comment: Comment): Promise<void>;
  /** Oldest first. */
  listByPost(postId: string): Promise<Comment[]>;
  /** Also removes replies to the comment. */
  delete(id: string): Promise<void>;
}

export interface LikeRepository {
  /** No-op if the user already likes the post. */
  add(postId: string, userId: string): Promise<void>;
  /** No-op if the user does not like the post. */
  remove(postId: string, userId: string): Promise<void>;
  count(postIds: string[]): Promise<Map<string, number>>;
}

export interface Repositories {
  users: UserRepository;
  posts: PostRepository;
  comments: CommentRepository;
  likes: LikeRepository;
}

// ---------------------------------------------------------------------------
// In-memory implementation: the default for local development and tests.
// The four repositories share one state object so deletes can cascade the way
// the foreign keys in db/schema.sql do. Records are copied on the way in and
// out so callers can never mutate stored state by accident.
// ---------------------------------------------------------------------------

interface MemoryState {
  users: Map<string, User>;
  posts: Map<string, Post>;
  comments: Map<string, Comment>;
  likes: Map<string, Set<string>>; // postId -> userIds
}

const copyPost = (post: Post): Post => ({ ...post, tags: [...post.tags] });

/** Newest first; id breaks ties so the order (and therefore the cursor) is total. */
function feedOrder(a: Post, b: Post): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt! < b.publishedAt! ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isAfter(post: Post, cursor: Cursor): boolean {
  return post.publishedAt! < cursor.publishedAt || (post.publishedAt === cursor.publishedAt && post.id < cursor.id);
}

class InMemoryUserRepository implements UserRepository {
  constructor(private readonly state: MemoryState) {}

  async findById(id: string) {
    const user = this.state.users.get(id);
    return user && { ...user };
  }

  async findByEmail(email: string) {
    for (const user of this.state.users.values()) if (user.email === email) return { ...user };
    return undefined;
  }

  async findByIds(ids: string[]) {
    return ids.flatMap((id) => {
      const user = this.state.users.get(id);
      return user ? [{ ...user }] : [];
    });
  }

  async insert(user: User) {
    if (await this.findByEmail(user.email)) throw new DuplicateKeyError("email");
    this.state.users.set(user.id, { ...user });
  }

  async updateRole(id: string, role: Role) {
    const user = this.state.users.get(id);
    if (!user) return undefined;
    user.role = role;
    return { ...user };
  }
}

class InMemoryPostRepository implements PostRepository {
  constructor(private readonly state: MemoryState) {}

  async findById(id: string) {
    const post = this.state.posts.get(id);
    return post && copyPost(post);
  }

  async findBySlug(slug: string) {
    for (const post of this.state.posts.values()) if (post.slug === slug) return copyPost(post);
    return undefined;
  }

  async slugsStartingWith(base: string) {
    return [...this.state.posts.values()]
      .map((post) => post.slug)
      .filter((slug) => slug === base || slug.startsWith(`${base}-`));
  }

  async insert(post: Post) {
    this.assertSlugFree(post);
    this.state.posts.set(post.id, copyPost(post));
  }

  async update(post: Post) {
    this.assertSlugFree(post);
    this.state.posts.set(post.id, copyPost(post));
  }

  async delete(id: string) {
    this.state.posts.delete(id);
    this.state.likes.delete(id);
    for (const [commentId, comment] of this.state.comments) {
      if (comment.postId === id) this.state.comments.delete(commentId);
    }
  }

  async listPublished({ limit, after, tag, search = [] }: PublishedPostQuery) {
    return [...this.state.posts.values()]
      .filter((post) => post.status === "published")
      .filter((post) => !tag || post.tags.includes(tag))
      .filter((post) => {
        const title = post.title.toLowerCase();
        const body = post.body.toLowerCase();
        return search.every((term) => title.includes(term) || body.includes(term));
      })
      .filter((post) => !after || isAfter(post, after))
      .sort(feedOrder)
      .slice(0, limit)
      .map(copyPost);
  }

  async listByAuthor(authorId: string) {
    return [...this.state.posts.values()]
      .filter((post) => post.authorId === authorId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map(copyPost);
  }

  private assertSlugFree(post: Post) {
    for (const other of this.state.posts.values()) {
      if (other.slug === post.slug && other.id !== post.id) throw new DuplicateKeyError("slug");
    }
  }
}

class InMemoryCommentRepository implements CommentRepository {
  constructor(private readonly state: MemoryState) {}

  async findById(id: string) {
    const comment = this.state.comments.get(id);
    return comment && { ...comment };
  }

  async insert(comment: Comment) {
    this.state.comments.set(comment.id, { ...comment });
  }

  async listByPost(postId: string) {
    // Map iteration is insertion order, and sort is stable, so same-instant comments keep their order.
    return [...this.state.comments.values()]
      .filter((comment) => comment.postId === postId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map((comment) => ({ ...comment }));
  }

  async delete(id: string) {
    this.state.comments.delete(id);
    for (const [replyId, reply] of this.state.comments) {
      if (reply.parentId === id) this.state.comments.delete(replyId);
    }
  }
}

class InMemoryLikeRepository implements LikeRepository {
  constructor(private readonly state: MemoryState) {}

  async add(postId: string, userId: string) {
    const likers = this.state.likes.get(postId) ?? new Set<string>();
    likers.add(userId);
    this.state.likes.set(postId, likers);
  }

  async remove(postId: string, userId: string) {
    this.state.likes.get(postId)?.delete(userId);
  }

  async count(postIds: string[]) {
    return new Map(postIds.map((id) => [id, this.state.likes.get(id)?.size ?? 0]));
  }
}

export function createInMemoryRepositories(): Repositories {
  const state: MemoryState = { users: new Map(), posts: new Map(), comments: new Map(), likes: new Map() };
  return {
    users: new InMemoryUserRepository(state),
    posts: new InMemoryPostRepository(state),
    comments: new InMemoryCommentRepository(state),
    likes: new InMemoryLikeRepository(state),
  };
}
