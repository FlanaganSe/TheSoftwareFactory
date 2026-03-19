import type {
  ActivityExecuteInput,
  ActivityInboundCallsInterceptor,
  Next,
} from "@temporalio/worker";

/**
 * Activity interceptor that logs activity starts, completions, and failures
 * using structured logging. OTel correlation deferred to M20.
 */
export class ActivityLogInterceptor implements ActivityInboundCallsInterceptor {
  async execute(
    input: ActivityExecuteInput,
    next: Next<ActivityInboundCallsInterceptor, "execute">,
  ): Promise<unknown> {
    const activityName = input.headers?.["activity-name"] ?? "unknown";
    const startMs = Date.now();
    try {
      const result = await next(input);
      const durationMs = Date.now() - startMs;
      console.log(
        JSON.stringify({
          level: "info",
          msg: "activity_completed",
          activity: activityName,
          durationMs,
        }),
      );
      return result;
    } catch (error: unknown) {
      const durationMs = Date.now() - startMs;
      console.log(
        JSON.stringify({
          level: "error",
          msg: "activity_failed",
          activity: activityName,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }
}
