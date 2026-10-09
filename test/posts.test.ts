import request from "supertest";
import { setup } from "./helpers";

describe("creating posts", () => {
  it("requires an author or admin", async () => {
    const { app, signUp } = setup();
    const reader = await signUp("reader");
    const admin = await signUp("admin");
    const post = { title: "Hello", body: "World" };

    await request(app).post("/posts").send(post).expect(401);
    const res = await request(app).post("/posts").set(reader.auth).send(post).expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    await request(app).post("/posts").set(admin.auth).send(post).expect(201);
  });

  it("generates unique slugs from titles", async () => {
    const { signUp, createPost } = setup();
    const alice = await signUp();
    const bob = await signUp();

    expect((await createPost(alice, { title: "My Post!" })).slug).toBe("my-post");
    expect((await createPost(alice, { title: "my post" })).slug).toBe("my-post-2");
    expect((await createPost(bob, { title: "  My -- Post  ", status: "draft" })).slug).toBe("my-post-3");
    expect((await createPost(bob, { title: "Café déjà vu" })).slug).toBe("cafe-deja-vu");
  });

  it("rejects unknown fields and bad tags", async () => {
    const { app, signUp } = setup();
    const author = await signUp();
    const res = await request(app)
      .post("/posts")
      .set(author.auth)
      .send({ title: "Hi", body: "There", tags: ["ok", "not ok"], authorId: "someone-else" })
      .expect(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["", "tags.1"]);
  });
});

describe("drafts", () => {
  it("are visible only to their author and admins", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const otherAuthor = await signUp();
    const admin = await signUp("admin");
    const draft = await createPost(author, { title: "Work in progress", status: "draft" });
    const path = `/posts/${draft.slug}`;

    expect(draft.publishedAt).toBeNull();
    await request(app).get(path).expect(404);
    await request(app).get(path).set(otherAuthor.auth).expect(404);
    await request(app).patch(path).set(otherAuthor.auth).send({ title: "Mine now" }).expect(404);
    await request(app).get(path).set(author.auth).expect(200);
    await request(app).get(path).set(admin.auth).expect(200);

    const feed = await request(app).get("/posts").expect(200);
    expect(feed.body.items).toHaveLength(0);
    const mine = await request(app).get("/users/me/posts").set(author.auth).expect(200);
    expect(mine.body.items.map((p: { slug: string }) => p.slug)).toEqual([draft.slug]);
  });

  it("follow their title until first published, then keep the slug", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const draft = await createPost(author, { title: "First title", status: "draft" });

    const renamed = await request(app).patch(`/posts/${draft.slug}`).set(author.auth).send({ title: "Second title" }).expect(200);
    expect(renamed.body.slug).toBe("second-title");
    await request(app).get("/posts/first-title").set(author.auth).expect(404);

    const published = await request(app)
      .patch("/posts/second-title")
      .set(author.auth)
      .send({ status: "published" })
      .expect(200);
    expect(published.body.publishedAt).not.toBeNull();

    const retitled = await request(app).patch("/posts/second-title").set(author.auth).send({ title: "Third title" }).expect(200);
    expect(retitled.body).toMatchObject({ slug: "second-title", title: "Third title" });
  });
});

describe("ownership", () => {
  it("lets only the owner or an admin edit or delete a post", async () => {
    const { app, signUp, createPost } = setup();
    const owner = await signUp();
    const otherAuthor = await signUp();
    const admin = await signUp("admin");
    const post = await createPost(owner, { title: "Owned" });
    const path = `/posts/${post.slug}`;

    await request(app).patch(path).set(otherAuthor.auth).send({ body: "Defaced" }).expect(403);
    await request(app).delete(path).set(otherAuthor.auth).expect(403);
    await request(app).patch(path).send({ body: "Anonymous" }).expect(401);

    const edited = await request(app).patch(path).set(admin.auth).send({ body: "Moderated" }).expect(200);
    expect(edited.body.body).toBe("Moderated");

    await request(app).delete(path).set(owner.auth).expect(204);
    await request(app).get(path).expect(404);
  });
});

describe("reading a post", () => {
  it("returns the markdown as stored plus SEO meta fields", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const body = `# Hello\n\nThis is **markdown** with a [link](https://example.com) and <b>raw html</b>.\n\n${"More words here. ".repeat(20)}`;
    const post = await createPost(author, { title: "Hello, World", body, tags: ["Intro", "intro", "meta"] });

    const res = await request(app).get(`/posts/${post.slug}`).expect(200);
    expect(res.body.body).toBe(body);
    expect(res.body.tags).toEqual(["intro", "meta"]);
    expect(res.body.author).toEqual({ id: author.id, displayName: expect.any(String) });
    expect(res.body.meta.title).toBe("Hello, World");
    expect(res.body.meta.canonicalPath).toBe("/posts/hello-world");
    expect(res.body.meta.description.startsWith("Hello This is markdown with a link and <b>raw html</b>.")).toBe(true);
    expect(res.body.meta.description.length).toBeLessThanOrEqual(160);
    expect(res.body.meta.description.endsWith("…")).toBe(true);
  });
});

describe("published feed", () => {
  it("pages newest first with a cursor and leaves out drafts", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const titles = ["One", "Two", "Three", "Four", "Five"];
    for (const title of titles) await createPost(author, { title });
    await createPost(author, { title: "Hidden draft", status: "draft" });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await request(app)
        .get("/posts")
        .query(cursor ? { limit: 2, cursor } : { limit: 2 })
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((p: { slug: string }) => p.slug));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(["five", "four", "three", "two", "one"]);
  });

  it("filters by tag and searches title and body, case-insensitively", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    await createPost(author, { title: "Postgres indexes", body: "B-tree and GIN.", tags: ["databases"] });
    await createPost(author, { title: "Java records", body: "Immutable data carriers.", tags: ["java"] });
    await createPost(author, { title: "Records in Postgres", body: "Row types.", tags: ["databases", "java"] });

    const slugs = async (query: object) =>
      (await request(app).get("/posts").query(query).expect(200)).body.items.map((p: { slug: string }) => p.slug);

    expect(await slugs({ tag: "java" })).toEqual(["records-in-postgres", "java-records"]);
    expect(await slugs({ q: "POSTGRES" })).toEqual(["records-in-postgres", "postgres-indexes"]);
    expect(await slugs({ q: "gin" })).toEqual(["postgres-indexes"]);
    expect(await slugs({ q: "records postgres", tag: "java" })).toEqual(["records-in-postgres"]);
  });

  it("rejects a tampered cursor or an out-of-range limit", async () => {
    const { app } = setup();
    const badCursor = await request(app).get("/posts").query({ cursor: "bm90LWEtY3Vyc29y" }).expect(400);
    expect(badCursor.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ path: "cursor", message: "Invalid cursor" }],
    });
    await request(app).get("/posts").query({ limit: 500 }).expect(400);
  });
});

describe("request handling", () => {
  it("uses the standard error shape for unknown routes, malformed JSON and oversized bodies", async () => {
    const { app, signUp } = setup({ jsonLimit: "1kb" });
    const author = await signUp();

    const missing = await request(app).get("/nope").expect(404);
    expect(missing.body).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });

    const malformed = await request(app)
      .post("/posts")
      .set(author.auth)
      .set("Content-Type", "application/json")
      .send('{"title":')
      .expect(400);
    expect(malformed.body.error.code).toBe("MALFORMED_JSON");

    const tooLarge = await request(app)
      .post("/posts")
      .set(author.auth)
      .send({ title: "Big", body: "x".repeat(2_000) })
      .expect(413);
    expect(tooLarge.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
