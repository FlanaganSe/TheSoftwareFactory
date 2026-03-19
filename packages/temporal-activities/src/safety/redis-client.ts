import { Redis } from "ioredis";

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
    lazyConnect: true,
  });
}

/** Pub/Sub needs a SEPARATE connection (subscriber can't issue commands). */
export function createRedisPubSubClient(url: string): Redis {
  return createRedisClient(url);
}
