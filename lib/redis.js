// src/lib/redis.js
import Redis from "ioredis";

const redisClient = new Redis(process.env.UPSTASH_REDIS_URL, {
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
  connectionName: "lune-medguide",
  enableReadyCheck: true,
  connectTimeout: 10000,
  disconnectTimeout: 2000,
});

redisClient.on("connect", () => {
  console.log("✅ Connected to Upstash Redis");
});

redisClient.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

// Key prefixes for organization
export const CACHE_KEYS = {
  MEDICINE_QUERY: "med:q:", // Medicine query responses
  AI_RESPONSE: "ai:r:",     // AI assistant responses
  USER_SESSION: "usr:s:",   // User sessions (if needed)
  MEDGUIDE: "mg:",          // MedGuide responses
};

// Helper to build cache keys
export function buildKey(prefix, identifier) {
  return `${prefix}${identifier}`;
}

// NEW: Get from cache
export async function getCache(key) {
  try {
    const cached = await redisClient.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (err) {
    console.error(`Cache GET error for key ${key}:`, err);
    return null;
  }
}

// NEW: Set to cache with expiry
export async function setCache(key, data, expirySeconds = 3600) {
  try {
    await redisClient.set(key, JSON.stringify(data), "EX", expirySeconds);
    return true;
  } catch (err) {
    console.error(`Cache SET error for key ${key}:`, err);
    return false;
  }
}

// Generic cache helper with expiry (existing function - keep for backwards compatibility)
export async function cacheWithExpiry(key, getData, expirySeconds = 3600) {
  try {
    // Try to get from cache first
    const cached = await redisClient.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // If not in cache, get fresh data
    const data = await getData();
    
    // Cache with expiry
    await redisClient.set(key, JSON.stringify(data), "EX", expirySeconds);
    
    return data;
  } catch (err) {
    console.error(`Cache error for key ${key}:`, err);
    // On cache error, fallback to direct data fetch
    return getData();
  }
}

export default redisClient;
