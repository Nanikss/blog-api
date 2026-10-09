import request from "supertest";
import { setup } from "./helpers";

describe("likes", () => {
  it("are idempotent per user and counted on the post", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const reader = await signUp("reader");
    const post = await createPost(author, { title: "Like me" });
    const like = `/posts/${post.slug}/like`;

    expect((await request(app).put(like).set(reader.auth).expect(200)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await request(app).put(like).set(reader.auth).expect(200)).body).toEqual({ liked: true, likeCount: 1 });
    expect((await request(app).put(like).set(author.auth).expect(200)).body.likeCount).toBe(2);

    expect((await request(app).get(`/posts/${post.slug}`).expect(200)).body.likeCount).toBe(2);
    expect((await request(app).get("/posts").expect(200)).body.items[0].likeCount).toBe(2);

    expect((await request(app).delete(like).set(reader.auth).expect(200)).body).toEqual({ liked: false, likeCount: 1 });
    expect((await request(app).delete(like).set(reader.auth).expect(200)).body).toEqual({ liked: false, likeCount: 1 });
  });

  it("need a signed-in user and a published post", async () => {
    const { app, signUp, createPost } = setup();
    const author = await signUp();
    const published = await createPost(author, { title: "Public" });
    const draft = await createPost(author, { title: "Private", status: "draft" });

    await request(app).put(`/posts/${published.slug}/like`).expect(401);
    await request(app).put(`/posts/${draft.slug}/like`).set(author.auth).expect(404);
    await request(app).put("/posts/does-not-exist/like").set(author.auth).expect(404);
  });
});
