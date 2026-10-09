import { randomUUID } from "crypto";
import { Router } from "express";
import { canDeleteComment } from "../access";
import { requireUser } from "../auth";
import { Context, isoNow } from "../context";
import { Comment } from "../domain";
import { ApiError, forbidden, notFound } from "../errors";
import { asyncHandler } from "../http";
import { commentThreads, commentView, loadAuthors } from "../presenters";
import { createCommentSchema, isUuid } from "../validation";
import { findPublishedPost } from "./loaders";

export function commentRoutes(ctx: Context): Router {
  const { posts, comments, users } = ctx.repos;
  const router = Router();

  router.get(
    "/posts/:slug/comments",
    asyncHandler(async (req, res) => {
      const post = await findPublishedPost(posts, req.params.slug);
      const list = await comments.listByPost(post.id);
      const authors = await loadAuthors(users, list.map((c) => c.authorId));
      res.json({ items: commentThreads(list, authors) });
    }),
  );

  router.post(
    "/posts/:slug/comments",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      const post = await findPublishedPost(posts, req.params.slug);
      const input = createCommentSchema.parse(req.body);

      if (input.parentId) {
        const parent = await comments.findById(input.parentId);
        if (!parent || parent.postId !== post.id) throw notFound("Parent comment");
        if (parent.parentId !== null) {
          throw new ApiError(422, "REPLY_DEPTH_EXCEEDED", "Replies can only be one level deep; reply to the top-level comment");
        }
      }

      const comment: Comment = {
        id: randomUUID(),
        postId: post.id,
        authorId: user.id,
        parentId: input.parentId ?? null,
        body: input.body,
        createdAt: isoNow(ctx),
      };
      await comments.insert(comment);
      res.status(201).json(commentView(comment, await loadAuthors(users, [user.id])));
    }),
  );

  router.delete(
    "/comments/:id",
    asyncHandler(async (req, res) => {
      const user = requireUser(res);
      const comment = isUuid(req.params.id) ? await comments.findById(req.params.id) : undefined;
      const post = comment && (await posts.findById(comment.postId));
      if (!comment || !post) throw notFound("Comment");
      if (!canDeleteComment(user, comment, post)) {
        throw forbidden("Only the commenter, the post's author or an admin can delete a comment");
      }
      await comments.delete(comment.id);
      res.status(204).end();
    }),
  );

  return router;
}
