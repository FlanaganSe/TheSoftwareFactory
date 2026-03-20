import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSSEClient } from "../sse";
import type { SSEEvent } from "../sse";

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Auto-open
    setTimeout(() => this.onopen?.(), 0);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close() {
    this.closed = true;
  }

  // Test helper: emit an event
  emit(type: string, data: string) {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createSSEClient", () => {
  it("connects to SSE endpoint with token", () => {
    const client = createSSEClient("http://localhost:3000", "my-key");
    client.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      "http://localhost:3000/api/events?token=my-key",
    );
  });

  it("receives and dispatches task events", async () => {
    const client = createSSEClient("http://localhost:3000", "key");
    const events: SSEEvent[] = [];
    client.onTasks((e) => events.push(e));
    client.connect();

    const es = MockEventSource.instances[0];
    es.emit("tasks", JSON.stringify({ type: "task_state_changed", taskId: "abc" }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("task_state_changed");
    expect(events[0].taskId).toBe("abc");
  });

  it("receives and dispatches system events", () => {
    const client = createSSEClient("http://localhost:3000", "key");
    const events: SSEEvent[] = [];
    client.onSystem((e) => events.push(e));
    client.connect();

    const es = MockEventSource.instances[0];
    es.emit("system", JSON.stringify({ type: "safety_event", event: "kill_activated" }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("safety_event");
  });

  it("handles malformed event data gracefully", () => {
    const client = createSSEClient("http://localhost:3000", "key");
    const events: SSEEvent[] = [];
    client.onTasks((e) => events.push(e));
    client.connect();

    const es = MockEventSource.instances[0];
    // Should not throw or push
    es.emit("tasks", "not valid json {{{");

    expect(events).toHaveLength(0);
  });

  it("auto-reconnects on error with exponential backoff", () => {
    const client = createSSEClient("http://localhost:3000", "key");
    client.connect();

    expect(MockEventSource.instances).toHaveLength(1);

    // Simulate error
    MockEventSource.instances[0].onerror?.();

    // First reconnect after 1s
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances).toHaveLength(2);

    // Second error → 2s
    MockEventSource.instances[1].onerror?.();
    vi.advanceTimersByTime(2000);
    expect(MockEventSource.instances).toHaveLength(3);

    // Third error → 4s
    MockEventSource.instances[2].onerror?.();
    vi.advanceTimersByTime(4000);
    expect(MockEventSource.instances).toHaveLength(4);
  });

  it("disconnect closes EventSource and cancels reconnect timer", () => {
    const client = createSSEClient("http://localhost:3000", "key");
    client.connect();

    const es = MockEventSource.instances[0];

    // Trigger error (starts reconnect timer)
    es.onerror?.();

    // Disconnect should cancel the timer
    client.disconnect();

    // Advance past reconnect time — should NOT create new instance
    vi.advanceTimersByTime(5000);
    // Only 1 instance (the original, now closed)
    expect(MockEventSource.instances).toHaveLength(1);
    expect(es.closed).toBe(true);
  });
});
