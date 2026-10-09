const MAX_SLUG_LENGTH = 80;

/** "Café déjà vu!" -> "cafe-deja-vu". Titles with no ASCII letters or digits fall back to "post". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining accents left over from NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateAtWord(slug) || "post";
}

function truncateAtWord(slug: string): string {
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const window = slug.slice(0, MAX_SLUG_LENGTH + 1); // the extra char shows whether the cut lands on a dash
  const lastDash = window.lastIndexOf("-");
  return (lastDash > 0 ? window.slice(0, lastDash) : slug.slice(0, MAX_SLUG_LENGTH)).replace(/-+$/, "");
}

/** Returns `base` if it is free, otherwise the lowest free `base-N` with N >= 2. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** True if `slug` is `base` or `base-N`, i.e. it was generated from the same title. */
export function isSlugFor(slug: string, base: string): boolean {
  return slug === base || new RegExp(`^${base}-\\d+$`).test(slug); // base is [a-z0-9-] only, so it is regex-safe
}
