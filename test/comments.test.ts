import request from "supertest";
import { setup } from "./helpers";

describe("comments", () => {
  it("threads replies one level deep and rejects replies to replies", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const reader = await signUp("reader");
    const post = await createPost(author, { title: "Discuss" });
    const path = `/posts/${post.slug}/comments`;

    const top = await request(app).post(path).set(reader.auth).send({ body: "First!" }).expect(201);
    const reply = await request(app).post(path).set(author.auth).send({ body: "Thanks", parentId: top.body.id }).expect(201);
    const tooDeep = await request(app).post(path).set(reader.auth).send({ body: "Nested", parentId: reply.body.id }).expect(422);
    expect(tooDeep.body.error.code).toBe("REPLY_DEPTH_EXCEEDED");

    const thread = await request(app).get(path).expect(200);
    expect(thread.body.items).toHaveLength(1);
    expect(thread.body.items[0]).toMatchObject({ id: top.body.id, body: "First!" });
    expect(thread.body.items[0].replies).toEqual([expect.objectContaining({ id: reply.body.id, parentId: top.body.id })]);
  });

  it("only exist on published posts", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const draft = await createPost(author, { title: "Not yet", status: "draft" });

    await request(app).post(`/posts/${draft.slug}/comments`).set(author.auth).send({ body: "Note to self" }).expect(404);
    await request(app).get(`/posts/${draft.slug}/comments`).set(author.auth).expect(404);
  });

  it("validates the body and that a parent belongs to the same post", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const first = await createPost(author, { title: "First" });
    const second = await createPost(author, { title: "Second" });
    const other = await request(app).post(`/posts/${first.slug}/comments`).set(author.auth).send({ body: "Hi" }).expect(201);

    const empty = await request(app).post(`/posts/${second.slug}/comments`).set(author.auth).send({ body: "   " }).expect(400);
    expect(empty.body.error.details[0].path).toBe("body");
    await request(app)
      .post(`/posts/${second.slug}/comments`)
      .set(author.auth)
      .send({ body: "Wrong thread", parentId: other.body.id })
      .expect(404);
    await request(app).post(`/posts/${second.slug}/comments`).send({ body: "Anonymous" }).expect(401);
  });

  it("can be deleted by the commenter, the post's author or an admin, and nobody else", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const commenter = await signUp("reader");
    const bystander = await signUp("reader");
    const admin = await signUp("admin");
    const post = await createPost(author, { title: "Moderation" });
    const comment = () =>
      request(app)
        .post(`/posts/${post.slug}/comments`)
        .set(commenter.auth)
        .send({ body: "Hot take" })
        .then((res) => res.body.id as string);

    const first = await comment();
    await request(app).delete(`/comments/${first}`).set(bystander.auth).expect(403);
    await request(app).delete(`/comments/${first}`).set(commenter.auth).expect(204);
    await request(app).delete(`/comments/${first}`).set(commenter.auth).expect(404);

    await request(app).delete(`/comments/${await comment()}`).set(author.auth).expect(204);
    await request(app).delete(`/comments/${await comment()}`).set(admin.auth).expect(204);
    await request(app).delete("/comments/not-a-uuid").set(admin.auth).expect(404);
  });

  it("removes replies along with their parent", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const post = await createPost(author, { title: "Cascade" });
    const path = `/posts/${post.slug}/comments`;
    const top = await request(app).post(path).set(author.auth).send({ body: "Parent" }).expect(201);
    await request(app).post(path).set(author.auth).send({ body: "Child", parentId: top.body.id }).expect(201);

    await request(app).delete(`/comments/${top.body.id}`).set(author.auth).expect(204);
    expect((await request(app).get(path).expect(200)).body.items).toEqual([]);
  });
});
