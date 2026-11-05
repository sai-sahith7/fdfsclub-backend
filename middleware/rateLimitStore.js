const { Redis } = require("@upstash/redis");
const logger = require("../utils/logger");

const TAG = "RateLimit";
const REDIS_TIMEOUT_MS = 1500;

const INCREMENT_SCRIPT = `
local hits = redis.call("INCR", KEYS[1])
if hits == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

let client;

function getRedis() {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token, retry: { retries: 1, backoff: () => 100 } }) : null;
  if (!client && process.env.NODE_ENV === "production") {
    logger.warn(TAG, "UPSTASH_REDIS_REST_URL/TOKEN not set, rate limits are counted per server instance");
  }
  return client;
}

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis timed out")), REDIS_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    throw new Error(`Rate limit store unavailable: ${String(error?.message || error).split(",")[0]}`);
  } finally {
    clearTimeout(timer);
  }
}

class RedisRateLimitStore {
  constructor(prefix, redis) {
    this.prefix = `rl:${prefix}:`;
    this.redis = redis;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const [totalHits, ttl] = await withTimeout(this.redis.eval(INCREMENT_SCRIPT, [this.prefix + key], [String(this.windowMs)]));
    return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Number(ttl)) };
  }

  async decrement(key) {
    await withTimeout(this.redis.decr(this.prefix + key));
  }

  async resetKey(key) {
    await withTimeout(this.redis.del(this.prefix + key));
  }
}

function createRateLimitStore(prefix) {
  if (process.env.NODE_ENV === "test") return undefined;
  const redis = getRedis();
  return redis ? new RedisRateLimitStore(prefix, redis) : undefined;
}

module.exports = { createRateLimitStore, RedisRateLimitStore };
