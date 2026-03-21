import type { Redis } from "ioredis";
import type { AgentLogger } from "../llm/agent.js";

const TASKS_CHANNEL = "factory:tasks";

export interface EventPublisher {
  /** Fire-and-forget publish to the tasks SSE channel. Never throws. */
  publishTaskEvent(event: Record<string, unknown>): void;
}

export function createEventPublisher(
  redis: Redis,
  logger?: AgentLogger,
): EventPublisher {
  return {
    publishTaskEvent(event) {
      redis
        .publish(TASKS_CHANNEL, JSON.stringify(event))
        .then((subscriberCount) => {
          if (subscriberCount === 0) {
            logger?.warn(
              { channel: TASKS_CHANNEL },
              "no SSE subscribers connected",
            );
          }
        })
        .catch((err: unknown) => {
          logger?.error(
            {
              channel: TASKS_CHANNEL,
              err: err instanceof Error ? err.message : String(err),
            },
            "failed to publish event",
          );
        });
    },
  };
}
