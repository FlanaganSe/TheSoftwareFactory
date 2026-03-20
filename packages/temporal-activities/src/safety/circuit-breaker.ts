import type { Redis } from "ioredis";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  readonly service: string;
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  readonly halfOpenMaxAttempts: number;
}

export interface CircuitBreakerStatus {
  readonly service: string;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly lastFailureAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly trippedAt: string | null;
  readonly nextRetryAt: string | null;
}

export interface CircuitBreaker {
  canExecute(service: string): Promise<boolean>;
  recordSuccess(service: string): Promise<void>;
  recordFailure(service: string): Promise<void>;
  getStatus(service: string): Promise<CircuitBreakerStatus>;
  getAllStatuses(): Promise<CircuitBreakerStatus[]>;
  forceOpen(service: string): Promise<void>;
  forceClose(service: string): Promise<void>;
}

const DEFAULT_CONFIGS: readonly CircuitBreakerConfig[] = [
  {
    service: "github",
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    halfOpenMaxAttempts: 1,
  },
  {
    service: "openrouter",
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
    halfOpenMaxAttempts: 1,
  },
  {
    service: "docker",
    failureThreshold: 3,
    resetTimeoutMs: 120_000,
    halfOpenMaxAttempts: 1,
  },
];

function keys(service: string) {
  const prefix = `factory:circuit:${service}`;
  return {
    state: `${prefix}:state`,
    failures: `${prefix}:failures`,
    lastFailure: `${prefix}:last_failure`,
    lastSuccess: `${prefix}:last_success`,
    trippedAt: `${prefix}:tripped_at`,
  } as const;
}

export function createCircuitBreaker(
  redis: Redis,
  configs?: readonly CircuitBreakerConfig[],
): CircuitBreaker {
  const configMap = new Map<string, CircuitBreakerConfig>();
  for (const c of configs ?? DEFAULT_CONFIGS) {
    configMap.set(c.service, c);
  }

  function getConfig(service: string): CircuitBreakerConfig {
    return (
      configMap.get(service) ?? {
        service,
        failureThreshold: 5,
        resetTimeoutMs: 60_000,
        halfOpenMaxAttempts: 1,
      }
    );
  }

  async function getState(service: string): Promise<CircuitState> {
    const k = keys(service);
    const state = await redis.get(k.state);
    if (state === "open" || state === "half_open") return state;
    return "closed";
  }

  async function checkHalfOpenTransition(service: string): Promise<boolean> {
    const k = keys(service);
    const config = getConfig(service);
    const trippedAt = await redis.get(k.trippedAt);
    if (!trippedAt) return false;
    const elapsed = Date.now() - new Date(trippedAt).getTime();
    if (elapsed >= config.resetTimeoutMs) {
      // Atomically transition to half_open only if still open
      const script = `
        if redis.call('GET', KEYS[1]) == 'open' then
          redis.call('SET', KEYS[1], 'half_open')
          return 1
        end
        return 0
      `;
      const result = (await redis.eval(script, 1, k.state)) as number;
      return result === 1;
    }
    return false;
  }

  return {
    async canExecute(service: string): Promise<boolean> {
      const state = await getState(service);
      if (state === "closed") return true;
      if (state === "half_open") return true;
      // state === "open" — check if cooldown elapsed
      const transitioned = await checkHalfOpenTransition(service);
      return transitioned;
    },

    async recordSuccess(service: string): Promise<void> {
      const k = keys(service);
      const now = new Date().toISOString();
      // Atomic: read state, reset failures, set success timestamp,
      // close circuit if half_open
      const script = `
        local state = redis.call('GET', KEYS[1]) or 'closed'
        redis.call('SET', KEYS[2], '0')
        redis.call('SET', KEYS[3], ARGV[1])
        if state == 'half_open' then
          redis.call('SET', KEYS[1], 'closed')
          redis.call('DEL', KEYS[4])
        end
        return 0
      `;
      await redis.eval(
        script,
        4,
        k.state,
        k.failures,
        k.lastSuccess,
        k.trippedAt,
        now,
      );
    },

    async recordFailure(service: string): Promise<void> {
      const k = keys(service);
      const config = getConfig(service);
      const now = new Date().toISOString();
      // Atomic: read state, increment failures, conditionally trip circuit
      const script = `
        local state = redis.call('GET', KEYS[1]) or 'closed'
        if state == 'half_open' then
          redis.call('SET', KEYS[1], 'open')
          redis.call('INCR', KEYS[2])
          redis.call('SET', KEYS[3], ARGV[1])
          redis.call('SET', KEYS[4], ARGV[1])
          return 0
        end
        local failures = redis.call('INCR', KEYS[2])
        redis.call('SET', KEYS[3], ARGV[1])
        if failures >= tonumber(ARGV[2]) and state ~= 'open' then
          redis.call('SET', KEYS[1], 'open')
          redis.call('SET', KEYS[4], ARGV[1])
        end
        return failures
      `;
      await redis.eval(
        script,
        4,
        k.state,
        k.failures,
        k.lastFailure,
        k.trippedAt,
        now,
        config.failureThreshold.toString(),
      );
    },

    async getStatus(service: string): Promise<CircuitBreakerStatus> {
      const k = keys(service);
      const config = getConfig(service);
      const [state, failures, lastFailure, lastSuccess, trippedAt] =
        await redis.mget(
          k.state,
          k.failures,
          k.lastFailure,
          k.lastSuccess,
          k.trippedAt,
        );
      const currentState: CircuitState =
        state === "open" || state === "half_open" ? state : "closed";

      let nextRetryAt: string | null = null;
      if (currentState === "open" && trippedAt) {
        const retryTime = new Date(trippedAt).getTime() + config.resetTimeoutMs;
        nextRetryAt = new Date(retryTime).toISOString();
      }

      return {
        service,
        state: currentState,
        consecutiveFailures: Number.parseInt(failures ?? "0", 10),
        lastFailureAt: lastFailure,
        lastSuccessAt: lastSuccess,
        trippedAt: trippedAt,
        nextRetryAt,
      };
    },

    async getAllStatuses(): Promise<CircuitBreakerStatus[]> {
      const services = [...configMap.keys()];
      return Promise.all(services.map((s) => this.getStatus(s)));
    },

    async forceOpen(service: string): Promise<void> {
      const k = keys(service);
      const now = new Date().toISOString();
      await redis.multi().set(k.state, "open").set(k.trippedAt, now).exec();
    },

    async forceClose(service: string): Promise<void> {
      const k = keys(service);
      await redis
        .multi()
        .set(k.state, "closed")
        .set(k.failures, "0")
        .del(k.trippedAt)
        .exec();
    },
  };
}
