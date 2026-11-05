const { RedisRateLimitStore } = require("../../middleware/rateLimitStore");

function fakeRedis() {
  const hits = new Map();
  return {
    hits,
    eval: jest.fn(async (script, [key], [windowMs]) => {
      hits.set(key, (hits.get(key) || 0) + 1);
      return [hits.get(key), Number(windowMs) - 10];
    }),
    decr: jest.fn(async (key) => hits.set(key, hits.get(key) - 1)),
    del: jest.fn(async (key) => hits.delete(key)),
  };
}

describe("RedisRateLimitStore", () => {
  test("counts hits per key under its own prefix", async () => {
    const redis = fakeRedis();
    const store = new RedisRateLimitStore("api", redis);
    store.init({ windowMs: 60000 });

    await store.increment("1.2.3.4");
    const second = await store.increment("1.2.3.4");

    expect(second.totalHits).toBe(2);
    expect(second.resetTime.getTime()).toBeGreaterThan(Date.now() + 59000);
    expect(redis.eval).toHaveBeenLastCalledWith(expect.any(String), ["rl:api:1.2.3.4"], ["60000"]);
  });

  test("decrements and resets a key", async () => {
    const redis = fakeRedis();
    const store = new RedisRateLimitStore("location", redis);
    store.init({ windowMs: 1000 });
    await store.increment("user:a@b.c");
    await store.increment("user:a@b.c");

    await store.decrement("user:a@b.c");
    expect(redis.hits.get("rl:location:user:a@b.c")).toBe(1);

    await store.resetKey("user:a@b.c");
    expect(redis.hits.has("rl:location:user:a@b.c")).toBe(false);
  });
});
