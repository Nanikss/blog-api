import { canViewPost } from "../access";
import { Post, User } from "../domain";
import { notFound } from "../errors";
import { PostRepository } from "../repository";

/** A post the caller may see: published, or a draft they own or administer. Otherwise 404. */
export async function findVisiblePost(posts: PostRepository, slug: string, viewer: User | undefined): Promise<Post> {
  const post = await posts.findBySlug(slug);
  if (!post || !canViewPost(viewer, post)) throw notFound("Post");
  return post;
}

/** Comments and likes only exist on published posts, whoever is asking. */
export async function findPublishedPost(posts: PostRepository, slug: string): Promise<Post> {
  const post = await posts.findBySlug(slug);
  if (!post || post.status !== "published") throw notFound("Post");
  return post;
}
