export type Role = "reader" | "author" | "admin";
export type PostStatus = "draft" | "published";

// Timestamps are ISO-8601 UTC strings throughout, so they sort lexicographically.

export interface User {
  id: string;
  email: string; // stored lowercased
  displayName: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
}

export interface Post {
  id: string;
  slug: string;
  authorId: string;
  title: string;
  /** Markdown, stored exactly as submitted. Rendering and sanitising HTML is the client's job. */
  body: string;
  tags: string[];
  status: PostStatus;
  createdAt: string;
  updatedAt: string;
  /** Set the first time the post is published and never cleared; it also freezes the slug. */
  publishedAt: string | null;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  /** null for a top-level comment; replies point at a top-level comment (one level only). */
  parentId: string | null;
  body: string;
  createdAt: string;
}
