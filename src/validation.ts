import { z } from "zod";
import { decodeCursor } from "./pagination";

const email = z.string().trim().toLowerCase().email().max(254);

// bcrypt silently ignores everything past 72 bytes, so longer passwords are rejected rather than truncated.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 bytes");

export const registerSchema = z
  .object({
    email,
    password,
    displayName: z.string().trim().min(1).max(60),
    // Admin cannot be self-assigned; an existing admin promotes users.
    role: z.enum(["reader", "author"]).default("reader"),
  })
  .strict();

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) }).strict();

export const updateRoleSchema = z.object({ role: z.enum(["reader", "author", "admin"]) }).strict();

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .max(30)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Tags may contain letters, digits and single dashes");
const tags = z
  .array(tag)
  .max(10)
  .transform((list) => [...new Set(list)]);
const title = z.string().trim().min(1).max(200);
const body = z
  .string()
  .max(50_000)
  .refine((value) => value.trim().length > 0, "Body must not be empty");
const status = z.enum(["draft", "published"]);

export const createPostSchema = z
  .object({ title, body, tags: tags.default([]), status: status.default("draft") })
  .strict();

export const updatePostSchema = z
  .object({ title, body, tags, status })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Provide at least one field to update");

export const listPostsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z
    .string()
    .max(500)
    .transform((raw, ctx) => {
      const cursor = decodeCursor(raw);
      if (!cursor) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid cursor" });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
  tag: tag.optional(),
  // Every term must appear in the title or body (case-insensitive).
  q: z
    .string()
    .max(100)
    .transform((raw) => raw.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5))
    .optional(),
});

export const createCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(5_000),
    parentId: z.string().uuid().optional(),
  })
  .strict();

const uuid = z.string().uuid();
export const isUuid = (value: string) => uuid.safeParse(value).success;
