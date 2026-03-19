import type { FastifyInstance } from "fastify";

const APP_MANIFEST = {
  name: "Software Factory",
  url: "https://github.com/software-factory",
  hook_attributes: { url: "" },
  redirect_url: "",
  default_permissions: {
    contents: "write",
    pull_requests: "write",
    checks: "write",
    statuses: "write",
    issues: "read",
    administration: "read",
    merge_queues: "read",
  },
  default_events: [
    "pull_request",
    "pull_request_review",
    "check_suite",
    "check_run",
    "merge_group",
    "push",
    "installation",
  ],
} as const;

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/setup/github",
    { config: { skipAuth: true } },
    async (request, reply) => {
      const host = request.headers.host ?? "localhost:3000";
      const protocol = request.headers["x-forwarded-proto"] ?? "http";
      const baseUrl = `${protocol}://${host}`;

      const manifest = {
        ...APP_MANIFEST,
        hook_attributes: {
          url: `${baseUrl}/api/webhooks/github`,
        },
        redirect_url: `${baseUrl}/api/setup/github/callback`,
      };

      reply.send({
        manifest,
        url: `https://github.com/settings/apps/new?manifest=${encodeURIComponent(JSON.stringify(manifest))}`,
      });
    },
  );

  app.get(
    "/api/setup/github/callback",
    { config: { skipAuth: true } },
    async (request, reply) => {
      const { code } = request.query as { code?: string };

      if (!code) {
        reply.status(400).send({
          error: {
            code: "bad_request",
            message: "Missing code parameter",
          },
        });
        return;
      }

      // Exchange code for app credentials
      // Code expires in 1 hour
      try {
        const response = await fetch(
          `https://api.github.com/app-manifests/${code}/conversions`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (!response.ok) {
          reply.status(502).send({
            error: {
              code: "github_transient",
              message: `GitHub returned ${response.status}`,
            },
          });
          return;
        }

        const data = (await response.json()) as Record<string, unknown>;

        // Return credentials for the operator to save
        // NOT stored in DB — goes in env/config
        reply.send({
          message:
            "GitHub App created. Save these credentials securely — they cannot be retrieved again.",
          appId: data.id,
          clientId: data.client_id,
          webhookSecret: data.webhook_secret,
          pem: data.pem,
        });
      } catch (e) {
        reply.status(502).send({
          error: {
            code: "github_transient",
            message: `Failed to exchange code: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
  );
}
