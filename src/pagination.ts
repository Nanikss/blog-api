import { z } from "zod";

/** Keyset position in the published feed, which is ordered by (publishedAt DESC, id DESC). */
export interface Cursor {
  publishedAt: string;
  id: string;
}

const cursorShape = z.tuple([z.string().datetime(), z.string().uuid()]);

export function encodeCursor(position: Cursor): string {
  return Buffer.from(JSON.stringify([position.publishedAt, position.id])).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | undefined {
  try {
    const parsed = cursorShape.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? { publishedAt: parsed.data[0], id: parsed.data[1] } : undefined;
  } catch {
    return undefined;
  }
}
