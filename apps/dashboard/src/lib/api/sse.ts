export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export type SSEEventHandler = (event: SSEEvent) => void;

export interface SSEClient {
  connect(): void;
  disconnect(): void;
  onTasks(handler: SSEEventHandler): void;
  onSystem(handler: SSEEventHandler): void;
}

export function createSSEClient(apiUrl: string, token: string): SSEClient {
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  const taskHandlers: SSEEventHandler[] = [];
  const systemHandlers: SSEEventHandler[] = [];

  function connect(): void {
    disconnect();
    reconnectAttempts = 0;
    doConnect();
  }

  function doConnect(): void {
    const url = `${apiUrl}/api/events?token=${encodeURIComponent(token)}`;
    eventSource = new EventSource(url);

    eventSource.addEventListener("tasks", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SSEEvent;
        for (const handler of taskHandlers) handler(data);
      } catch {
        // Ignore malformed events
      }
    });

    eventSource.addEventListener("system", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SSEEvent;
        for (const handler of systemHandlers) handler(data);
      } catch {
        // Ignore malformed events
      }
    });

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
      reconnectAttempts++;
      reconnectTimer = setTimeout(doConnect, delay);
    };

    eventSource.onopen = () => {
      reconnectAttempts = 0;
    };
  }

  function disconnect(): void {
    eventSource?.close();
    eventSource = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  return {
    connect,
    disconnect,
    onTasks(handler: SSEEventHandler) {
      taskHandlers.push(handler);
    },
    onSystem(handler: SSEEventHandler) {
      systemHandlers.push(handler);
    },
  };
}
