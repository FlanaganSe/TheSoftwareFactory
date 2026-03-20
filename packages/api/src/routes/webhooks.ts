import { createHash } from "node:crypto";
import { Webhooks } from "@octokit/webhooks";
import { webhookRepo } from "@software-factory/db";
import type { FastifyInstance } from "fastify";
import { dispatchWebhookToWorkflow } from "../webhooks/dispatcher.js";

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Capture raw body for webhook signature verification.
  // The HMAC must be verified against the exact bytes GitHub sent,
  // not a re-serialized version.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const raw = body as string;
        done(null, { parsed: JSON.parse(raw), raw });
      } catch (e) {
        done(e as Error);
      }
    },
  );

  const webhooks = new Webhooks({ secret: app.webhookSecret });

  app.post(
    "/api/webhooks/github",
    { config: { skipAuth: true } },
    async (request, reply) => {
      const signature = request.headers["x-hub-signature-256"] as
        | string
        | undefined;
      const deliveryId = request.headers["x-github-delivery"] as
        | string
        | undefined;
      const event = request.headers["x-github-event"] as string | undefined;

      if (!signature) {
        reply.status(401).send({
          error: { code: "unauthorized", message: "Missing webhook signature" },
        });
        return;
      }

      if (!deliveryId) {
        reply.status(400).send({
          error: {
            code: "bad_request",
            message: "Missing X-GitHub-Delivery header",
          },
        });
        return;
      }

      // Extract raw body and parsed body
      const bodyWrapper = request.body as {
        parsed: Record<string, unknown>;
        raw: string;
      };
      const rawPayload = bodyWrapper.raw;
      const body = bodyWrapper.parsed;

      // Verify HMAC-SHA256 signature against raw bytes
      const isValid = await webhooks.verify(rawPayload, signature);

      if (!isValid) {
        reply.status(401).send({
          error: { code: "unauthorized", message: "Invalid webhook signature" },
        });
        return;
      }

      // Check for duplicate delivery (idempotency)
      const processedResult = await webhookRepo.isDeliveryProcessed(
        app.db,
        deliveryId,
      );
      if (processedResult.isOk() && processedResult.value) {
        reply.status(200).send({ status: "already_processed" });
        return;
      }

      const action = typeof body.action === "string" ? body.action : null;

      // Compute payload hash for integrity
      const payloadHash = createHash("sha256").update(rawPayload).digest("hex");

      // Persist BEFORE any processing
      const recordResult = await webhookRepo.recordDelivery(
        app.db,
        deliveryId,
        event ?? "unknown",
        action,
        payloadHash,
      );

      if (recordResult.isErr()) {
        // Duplicate key constraint — already received
        reply.status(200).send({ status: "already_received" });
        return;
      }

      // Log structured event info
      request.log.info(
        {
          deliveryId,
          event,
          action,
          repository: (body.repository as Record<string, unknown>)?.full_name,
        },
        "Webhook received",
      );

      // Dispatch to Temporal workflow (if a running workflow exists for this PR)
      const temporalClient = app.temporalClient;
      if (temporalClient && event) {
        try {
          const dispatch = await dispatchWebhookToWorkflow(
            temporalClient,
            app.db,
            event,
            action,
            body,
          );
          if (dispatch.dispatched) {
            request.log.info(
              {
                deliveryId,
                workflowId: dispatch.workflowId,
                signalName: dispatch.signalName,
              },
              "Webhook dispatched to workflow",
            );
          }
        } catch (e) {
          // Dispatch failure should not fail the webhook response
          request.log.error(
            {
              deliveryId,
              error: e instanceof Error ? e.message : String(e),
            },
            "Webhook dispatch failed",
          );
        }
      }

      // Mark as processed
      await webhookRepo.markDeliveryProcessed(app.db, deliveryId);

      reply.status(200).send({ status: "processed" });
    },
  );
}
