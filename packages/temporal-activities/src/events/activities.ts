import type { PhaseEvent } from "@software-factory/core";
import type { EventPublisher } from "./publisher.js";

export interface EventActivityDeps {
  readonly publisher: EventPublisher;
}

export function createEventActivities(deps: EventActivityDeps) {
  return {
    async publishPhaseEvent(event: PhaseEvent): Promise<void> {
      deps.publisher.publishTaskEvent(event);
    },
  };
}
