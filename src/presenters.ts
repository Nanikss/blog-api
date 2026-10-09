import { Comment, Post, User } from "./domain";
import { UserRepository } from "./repository";
import { excerpt, postMeta } from "./seo";

// Response shapes. Nothing here ever includes passwordHash.

export interface AuthorView {
  id: string;
  displayName: string;
}

export type Authors = Map<string, AuthorView>;

export const toPublicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  createdAt: user.createdAt,
});

export async function loadAuthors(users: UserRepository, ids: string[]): Promise<Authors> {
  const found = await users.findByIds([...new Set(ids)]);
  return new Map(found.map((user) => [user.id, { id: user.id, displayName: user.displayName }]));
}

const authorOf = (authors: Authors, id: string): AuthorView => authors.get(id) ?? { id, displayName: "Unknown" };

export function postSummary(post: Post, authors: Authors, likeCount: number) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: excerpt(post.body),
    tags: post.tags,
    status: post.status,
    author: authorOf(authors, post.authorId),
    likeCount,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export function postDetail(post: Post, authors: Authors, likeCount: number) {
  return { ...postSummary(post, authors, likeCount), body: post.body, meta: postMeta(post) };
}

export function commentView(comment: Comment, authors: Authors) {
  return {
    id: comment.id,
    parentId: comment.parentId,
    body: comment.body,
    author: authorOf(authors, comment.authorId),
    createdAt: comment.createdAt,
  };
}

/** Top-level comments oldest first, each with its replies oldest first. */
export function commentThreads(comments: Comment[], authors: Authors) {
  const replies = new Map<string, ReturnType<typeof commentView>[]>();
  for (const c of comments) {
    if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), commentView(c, authors)]);
  }
  return comments
    .filter((c) => c.parentId === null)
    .map((c) => ({ ...commentView(c, authors), replies: replies.get(c.id) ?? [] }));
}
