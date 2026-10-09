import { Post } from "./domain";

/**
 * A plain-text summary of a markdown body for <meta name="description">. It is a
 * best-effort strip of common markdown syntax, not a renderer, and it does no HTML
 * escaping: the client escapes it when it writes the attribute.
 */
export function excerpt(markdown: string, maxLength = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "") // headings, quotes, list markers
    .replace(/[*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

export function postMeta(post: Post) {
  return {
    title: post.title,
    description: excerpt(post.body),
    canonicalPath: `/posts/${post.slug}`,
  };
}
