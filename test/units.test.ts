import { decodeCursor, encodeCursor } from "../src/pagination";
import { TokenBucketLimiter } from "../src/rateLimiter";
import { excerpt } from "../src/seo";
import { isSlugFor, slugify, uniqueSlug } from "../src/slug";
import { FakeClock } from "./helpers";

describe("slugify", () => {
  it("lowercases, strips accents and punctuation, and collapses separators", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("Crème brûlée & Ça va")).toBe("creme-brulee-ca-va");
    expect(slugify("Node.js 16 -> 20")).toBe("node-js-16-20");
  });

  it("falls back to 'post' and truncates long titles on a word boundary", () => {
    expect(slugify("!!!")).toBe("post");
    const slug = slugify("word ".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("word")).toBe(true);
  });
});

describe("uniqueSlug", () => {
  it("adds the lowest free numeric suffix", () => {
    expect(uniqueSlug("my-post", [])).toBe("my-post");
    expect(uniqueSlug("my-post", ["my-post"])).toBe("my-post-2");
    expect(uniqueSlug("my-post", ["my-post", "my-post-2", "my-post-4"])).toBe("my-post-3");
    expect(isSlugFor("my-post-3", "my-post")).toBe(true);
    expect(isSlugFor("my-post-about-x", "my-post")).toBe(false);
  });
});

describe("excerpt", () => {
  it("keeps short text whole and cuts long text on a word with an ellipsis", () => {
    expect(excerpt("## Title\n\n- one\n- `two`")).toBe("Title one two");
    const long = excerpt("lorem ipsum ".repeat(40), 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long).toMatch(/(lorem|ipsum)…$/);
  });
});

describe("cursor", () => {
  it("round-trips and rejects anything it did not produce", () => {
    const position = { publishedAt: "2026-03-02T09:00:00.000Z", id: "8f14e45f-ceea-4e7a-9b1f-1d2c3b4a5f60" };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
    expect(decodeCursor("garbage")).toBeUndefined();
    expect(decodeCursor(Buffer.from('["yesterday","x"]').toString("base64url"))).toBeUndefined();
  });
});

describe("TokenBucketLimiter", () => {
  it("refills one token per interval, never above capacity", () => {
    const clock = new FakeClock();
    const limiter = new TokenBucketLimiter({ capacity: 2, refillEveryMs: 1_000, clock: clock.now });

    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.take("b").allowed).toBe(true); // keys are independent

    clock.advance(60); // a long pause still only refills to capacity
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("forgets fully refilled buckets once it tracks too many keys", () => {
    const clock = new FakeClock();
    const limiter = new TokenBucketLimiter({ capacity: 1, refillEveryMs: 1_000, clock: clock.now, maxKeys: 2 });
    limiter.take("a");
    limiter.take("b");
    clock.advance(5);
    limiter.take("c");
    expect(limiter.size).toBe(1);
    expect(limiter.take("c").allowed).toBe(false);
  });
});
