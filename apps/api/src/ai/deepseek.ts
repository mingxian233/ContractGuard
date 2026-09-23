import {
  createLegacyDeepSeekConfiguration,
  legacyDeepSeekConfigFromEnvironment,
  type LegacyDeepSeekConfig,
} from './config.js';
import { createMultiProviderAiService } from './service.js';
import type { AiReviewService } from './types.js';

/** Backwards-compatible public type retained for existing programmatic users and tests. */
export type DeepSeekAiConfig = LegacyDeepSeekConfig;

export interface DeepSeekAiServiceOptions {
  config?: Partial<DeepSeekAiConfig>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

/**
 * Compatibility wrapper for the pre-V1.1 DeepSeek-only API.
 * New deployments should use createMultiProviderAiService and CONTRACTGUARD_LLM_CONFIG.
 */
export function createDeepSeekAiService(options: DeepSeekAiServiceOptions = {}): AiReviewService {
  const environmentDefaults = legacyDeepSeekConfigFromEnvironment();
  const config: LegacyDeepSeekConfig = {
    ...environmentDefaults,
    ...options.config,
  };
  const runtimeConfig = createLegacyDeepSeekConfiguration(config);
  return createMultiProviderAiService({
    config: runtimeConfig,
    directSecrets: { deepseek: config.apiKey },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
