import { randomUUID } from "crypto";
import { Router } from "express";
import { canEditPost, canWritePosts } from "../access";
import { currentUser, requireUser } from "../auth";
import { Context, isoNow } from "../context";
import { Post } from "../domain";
import { forbidden } from "../errors";
import { asyncHandler } from "../http";
import { encodeCursor } from "../pagination";
import { loadAuthors, postDetail, postSummary } from "../presenters";
import { DuplicateKeyError } from "../repository";
import { isSlugFor, slugify, uniqueSlug } from "../slug";
import { createPostSchema, listPostsQuery, updatePostSchema } from "../validation";
import { findPublishedPost, findVisiblePost } from "./loaders";

const SLUG_ATTEMPTS = 3;

export function postRoutes(ctx: Context): Router {
  const { posts, users, likes } = ctx.repos;
  const router = Router();

  async function summaries(list: Post[]) {
    const [authors, counts] = await Promise.all([
      loadAuthors(users, list.map((p) => p.authorId)),
      likes.count(list.map((p) => p.id)),
    ]);
    return list.map((post) => postSummary(post, authors, counts.get(post.id) ?? 0));
  }

  async function detail(post: Post) {
    const [authors, counts] = await Promise.all([loadAuthors(users, [post.authorId]), likes.count([post.id])]);
    return postDetail(post, authors, counts.get(post.id) ?? 0);
  }

  /**
   * Picks the next free slug for the post's title and writes it. The unique index
   * is the real guard: if a concurrent request takes the same slug between the
   * read and the write, the store raises DuplicateKeyError and we pick again.
   */
  async function writeWithFreshSlug(post: Post, write: (p: Post) => Promise<void>): Promise<Post> {
    const base = slugify(post.title);
    for (let attempt = 1; ; attempt++) {
      const candidate = { ...post, slug: uniqueSlug(base, await posts.slugsStartingWith(base)) };
      try {
        await write(candidate);
        return candidate;
      } catch (err) {
        if (!(err instanceof DuplicateKeyError) || attempt === SLUG_ATTEMPTS) throw err;
      }
    }
  }

  router.get(
    "/posts",
    asyncHandler(async (req, res) => {
      const query = listPostsQuery.parse(req.query);
      // Fetch one extra row to learn whether there is a next page without a COUNT.
      const rows = await posts.listPublished({
        limit: query.limit + 1,
        after: query.cursor,
        tag: query.tag,
        search: query.q,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > query.limit && last ? encodeCursor({ publishedAt: last.publishedAt!, id: last.id }) : null;
      res.json({ items: await summaries(page), nextCursor });
    }),
  );

  router.post(
    "/posts",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      if (!canWritePosts(user)) throw forbidden("Only authors and admins can create posts");
      const input = createPostSchema.parse(req.body);
      const now = isoNow(ctx);
      const post = await writeWithFreshSlug(
        {
          id: randomUUID(),
          slug: "",
          authorId: user.id,
          title: input.title,
          body: input.body,
          tags: input.tags,
          status: input.status,
          createdAt: now,
          updatedAt: now,
          publishedAt: input.status === "published" ? now : null,
        },
        (p) => posts.insert(p),
      );
      res.status(201).location(`/posts/${post.slug}`).json(await detail(post));
    }),
  );

  router.get(
    "/posts/:slug",
    asyncHandler(async (req, res) => {
      res.json(await detail(await findVisiblePost(posts, req.params.slug, currentUser(res))));
    }),
  );

  router.patch(
    "/posts/:slug",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      const post = await findVisiblePost(posts, req.params.slug, user);
      if (!canEditPost(user, post)) throw forbidden("Only the post's author or an admin can edit it");
      const patch = updatePostSchema.parse(req.body);
      const now = isoNow(ctx);
      const next: Post = {
        ...post,
        title: patch.title ?? post.title,
        body: patch.body ?? post.body,
        tags: patch.tags ?? post.tags,
        status: patch.status ?? post.status,
        updatedAt: now,
        publishedAt: post.publishedAt ?? (patch.status === "published" ? now : null),
      };
      // A slug follows the title only until the post is first published; after that
      // links may exist in the wild, so it never changes again.
      const reslug = post.publishedAt === null && !isSlugFor(post.slug, slugify(next.title));
      const saved = reslug ? await writeWithFreshSlug(next, (p) => posts.update(p)) : next;
      if (!reslug) await posts.update(saved);
      res.json(await detail(saved));
    }),
  );

  router.delete(
    "/posts/:slug",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      const post = await findVisiblePost(posts, req.params.slug, user);
      if (!canEditPost(user, post)) throw forbidden("Only the post's author or an admin can delete it");
      await posts.delete(post.id);
      res.status(204).end();
    }),
  );

  // PUT and DELETE because both are idempotent: repeating either leaves the same state.
  router.put(
    "/posts/:slug/like",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      const post = await findPublishedPost(posts, req.params.slug);
      await likes.add(post.id, user.id);
      res.json({ liked: true, likeCount: (await likes.count([post.id])).get(post.id) ?? 0 });
    }),
  );

  router.delete(
    "/posts/:slug/like",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      const post = await findPublishedPost(posts, req.params.slug);
      await likes.remove(post.id, user.id);
      res.json({ liked: false, likeCount: (await likes.count([post.id])).get(post.id) ?? 0 });
    }),
  );

  router.get(
    "/users/me/posts",
    asyncHandler(async (_req, res) => {
      const user = requireUser(res);
      res.json({ items: await summaries(await posts.listByAuthor(user.id)) });
    }),
  );

  return router;
}
