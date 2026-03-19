import type { Redis } from "ioredis";

export interface LeaseResult {
  readonly acquired: boolean;
  readonly existingOwner?: string;
}

// Lua scripts are MANDATORY — Redis MULTI/EXEC cannot do check-and-modify atomically

const ACQUIRE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

export function createBranchLeaseActivity(redis: Redis) {
  return {
    async acquireBranchLease(
      branch: string,
      taskId: string,
      ttlSeconds: number,
    ): Promise<LeaseResult> {
      const key = `factory:branch_lease:${branch}`;
      const result = (await redis.eval(
        ACQUIRE_SCRIPT,
        1,
        key,
        taskId,
        ttlSeconds.toString(),
      )) as number;
      if (result === 1) return { acquired: true };
      const existingOwner = await redis.get(key);
      return { acquired: false, existingOwner: existingOwner ?? undefined };
    },

    async releaseBranchLease(branch: string, taskId: string): Promise<boolean> {
      const key = `factory:branch_lease:${branch}`;
      const result = (await redis.eval(
        RELEASE_SCRIPT,
        1,
        key,
        taskId,
      )) as number;
      return result === 1;
    },

    async renewBranchLease(
      branch: string,
      taskId: string,
      ttlSeconds: number,
    ): Promise<boolean> {
      const key = `factory:branch_lease:${branch}`;
      const result = (await redis.eval(
        RENEW_SCRIPT,
        1,
        key,
        taskId,
        ttlSeconds.toString(),
      )) as number;
      return result === 1;
    },
  };
}
