import { Comment, Post, User } from "./domain";

// Every access rule in one place. Routes answer 404 when the caller cannot see a
// resource at all (so drafts don't leak their existence) and 403 when they can
// see it but may not change it.

export const canWritePosts = (user: User) => user.role === "author" || user.role === "admin";

export const canEditPost = (user: User | undefined, post: Post) =>
  !!user && (user.id === post.authorId || user.role === "admin");

export const canViewPost = (user: User | undefined, post: Post) =>
  post.status === "published" || canEditPost(user, post);

export const canDeleteComment = (user: User, comment: Comment, post: Post) =>
  user.id === comment.authorId || user.id === post.authorId || user.role === "admin";

export const canChangeRoles = (user: User) => user.role === "admin";
