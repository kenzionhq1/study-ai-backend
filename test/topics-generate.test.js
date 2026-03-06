import test from "node:test";
import assert from "node:assert/strict";

import { registerUser } from "../src/controllers/authController.js";
import { generateTopic, getUserTopics } from "../src/controllers/topicController.js";

const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const createUser = async () => {
  const email = `user-${Date.now()}-${Math.random().toString(16).slice(2)}@test.com`;
  const req = { body: { name: "Test User", email, password: "password123" } };
  const res = makeRes();
  await registerUser(req, res);
  assert.equal(res.statusCode, 201);
  return res.body.user;
};

test("POST /api/topics/generate success in local provider mode", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  process.env.USE_IN_MEMORY_DB = "true";
  process.env.AI_PROVIDER = "local";
  delete process.env.SIMULATE_AI_DOWN;

  const user = await createUser();
  const req = { body: { topic: "Photosynthesis" }, user };
  const res = makeRes();

  await generateTopic(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body._id);
  assert.ok(res.body.userId);
  assert.equal(res.body.topic, "photosynthesis");
  assert.ok(res.body.content);
  assert.ok(Array.isArray(res.body.questions));
  assert.ok(res.body.createdAt);
  assert.ok(["local", "openai", "library"].includes(res.body.source));
});

test("POST /api/topics/generate returns 503 when AI provider unavailable", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  process.env.USE_IN_MEMORY_DB = "true";
  process.env.AI_PROVIDER = "openai";
  process.env.SIMULATE_AI_DOWN = "true";

  const user = await createUser();
  const req = { body: { topic: "Cell Biology" }, user };
  const res = makeRes();

  await generateTopic(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(typeof res.body?.message, "string");

  const listRes = makeRes();
  await getUserTopics({ user }, listRes);
  assert.equal(listRes.statusCode, 200);
  assert.equal(Array.isArray(listRes.body), true);
  assert.equal(listRes.body.length, 0);

  delete process.env.SIMULATE_AI_DOWN;
});

test("POST /api/topics/generate returns 400 for invalid input", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  process.env.USE_IN_MEMORY_DB = "true";
  process.env.AI_PROVIDER = "local";

  const user = await createUser();
  const req = { body: { topic: "   " }, user };
  const res = makeRes();

  await generateTopic(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.message, "Topic is required");
});

test("POST /api/topics/generate flags inappropriate topic input", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  process.env.USE_IN_MEMORY_DB = "true";
  process.env.AI_PROVIDER = "local";

  const user = await createUser();
  const req = { body: { topic: "best hentai porn websites" }, user };
  const res = makeRes();

  await generateTopic(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.flagged, true);
  assert.equal(res.body?.code, "INAPPROPRIATE_TOPIC");
  assert.equal(typeof res.body?.message, "string");
});

test("POST /api/topics/generate flags profanity topic input", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  process.env.USE_IN_MEMORY_DB = "true";
  process.env.AI_PROVIDER = "local";

  const user = await createUser();
  const req = { body: { topic: "fuck" }, user };
  const res = makeRes();

  await generateTopic(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.flagged, true);
  assert.equal(res.body?.code, "INAPPROPRIATE_TOPIC");
});
