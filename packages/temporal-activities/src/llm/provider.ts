import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export interface ProviderConfig {
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly planningModel?: string;
  readonly budgetModel?: string;
  readonly siteUrl?: string;
  readonly siteName?: string;
}

export function createProvider(config: ProviderConfig) {
  return createOpenRouter({
    apiKey: config.apiKey,
    compatibility: "strict",
  });
}

export function buildRequestConfig(config: ProviderConfig) {
  return {
    headers: {
      "HTTP-Referer": config.siteUrl ?? "https://github.com/software-factory",
      "X-Title": config.siteName ?? "Software Factory",
    },
    providerOptions: {
      openrouter: {
        allowFallbacks: false,
        dataCollection: "deny" as const,
        requireParameters: true,
      },
    },
  } as const;
}
