import { Router } from "express";
import { canChangeRoles } from "../access";
import { requireUser } from "../auth";
import { Context } from "../context";
import { forbidden, notFound } from "../errors";
import { asyncHandler } from "../http";
import { toPublicUser } from "../presenters";
import { isUuid, updateRoleSchema } from "../validation";

export function userRoutes(ctx: Context): Router {
  const { users } = ctx.repos;
  const router = Router();

  router.patch(
    "/users/:id/role",
    asyncHandler(async (req, res) => {
      if (!canChangeRoles(requireUser(res))) throw forbidden("Only admins can change roles");
      const { role } = updateRoleSchema.parse(req.body);
      const updated = isUuid(req.params.id) ? await users.updateRole(req.params.id, role) : undefined;
      if (!updated) throw notFound("User");
      res.json({ user: toPublicUser(updated) });
    }),
  );

  return router;
}
