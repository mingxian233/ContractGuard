import type { StoredAnalysis } from '../types.js';
import { requestOpenAiChatCompletion, type OpenAiChatAdapterOptions } from './adapters/openai-chat.js';
import {
  createLegacyDeepSeekConfiguration,
  isLoopbackBaseUrl,
  legacyDeepSeekConfigFromEnvironment,
  loadAiConfiguration,
  type AiAdapterKind,
  type AiRuntimeConfig,
} from './config.js';
import { AI_PROMPT_VERSION } from './prompt.js';
import { parseAndValidateGeneratedReview } from './review-schema.js';
import { AiServiceError, type AiProviderStatus, type AiReviewService, type AiServiceStatus } from './types.js';

type Adapter = (options: OpenAiChatAdapterOptions) => ReturnType<typeof requestOpenAiChatCompletion>;

/** Only audited adapters compiled into the server may be selected by configuration. */
const ADAPTER_REGISTRY: Readonly<Record<AiAdapterKind, Adapter>> = Object.freeze({
  'openai-chat': requestOpenAiChatCompletion,
});

export interface MultiProviderAiServiceOptions {
  config?: AiRuntimeConfig;
  configPath?: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  /** Used only by the backwards-compatible programmatic DeepSeek configuration. */
  directSecrets?: Readonly<Record<string, string | undefined>>;
}

export function createMultiProviderAiService(options: MultiProviderAiServiceOptions = {}): AiReviewService {
  const environment = options.environment ?? process.env;
  const configPath = options.configPath ?? nonEmpty(environment.CONTRACTGUARD_LLM_CONFIG);
  const configured = options.config
    ?? (configPath === undefined ? undefined : loadAiConfiguration(configPath));
  const legacy = configured === undefined
    ? createLegacyDeepSeekConfiguration(legacyDeepSeekConfigFromEnvironment(environment))
    : undefined;
  const config = configured ?? legacy as AiRuntimeConfig;
  const directSecrets: Readonly<Record<string, string | undefined>> = options.directSecrets
    ?? (legacy === undefined ? {} : { deepseek: legacy.legacyApiKey });
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  return {
    status(): AiServiceStatus {
      const providers = config.profiles.map((profile) => statusForProfile(config, profile.id, environment, directSecrets));
      const active = config.profiles.find((profile) => profile.id === config.activeProfile)!;
      const activeStatus = providers.find((profile) => profile.id === active.id)!;
      return {
        enabled: config.enabled,
        configured: activeStatus.configured,
        available: activeStatus.available,
        provider: active.provider,
        model: active.model,
        promptVersion: AI_PROMPT_VERSION,
        activeProfile: active.id,
        activeProviderId: active.id,
        defaultProviderId: active.id,
        allowRequestProfileOverride: config.allowRequestProfileOverride,
        allowRequestProviderOverride: config.allowRequestProfileOverride,
        providers,
      };
    },

    async review(analysis, request, callOptions) {
      if (!config.enabled) {
        throw new AiServiceError(503, 'AI_DISABLED', 'AI review is disabled on this server.');
      }
      const requestedId = request.providerId ?? config.activeProfile;
      if (request.providerId !== undefined
        && request.providerId !== config.activeProfile
        && !config.allowRequestProfileOverride) {
        throw new AiServiceError(400, 'AI_PROVIDER_OVERRIDE_DISABLED', 'Selecting a different AI provider is disabled on this server.');
      }
      const profile = config.profiles.find((candidate) => candidate.id === requestedId);
      if (profile === undefined) {
        throw new AiServiceError(400, 'AI_PROVIDER_NOT_FOUND', 'The requested AI provider is not configured on this server.');
      }
      if (!profile.enabled) {
        throw new AiServiceError(503, 'AI_PROVIDER_DISABLED', 'The requested AI provider is disabled on this server.');
      }
      const apiKey = resolveApiKey(profile.id, profile.auth, environment, directSecrets);
      if (profile.auth.type === 'bearer' && apiKey === undefined) {
        throw new AiServiceError(503, 'AI_NOT_CONFIGURED', `AI review is enabled but ${profile.displayName} credentials are not configured.`);
      }

      const adapter = ADAPTER_REGISTRY[profile.adapter];
      const completion = await adapter({
        profile,
        limits: config.defaults,
        analysis,
        request,
        ...(apiKey === undefined ? {} : { apiKey }),
        fetch: fetchImplementation,
        ...(callOptions?.signal === undefined ? {} : { signal: callOptions.signal }),
      });
      if (completion.finishReason === 'length') {
        throw new AiServiceError(
          502,
          'AI_INVALID_RESPONSE',
          `${profile.displayName} truncated the JSON review because the output token limit was reached. `
          + 'Increase defaults.maxOutputTokens or reduce defaults.maxChanges, then retry.',
        );
      }
      const generated = parseAndValidateGeneratedReview(
        completion.content,
        new Set(analysis.changes.map((change) => change.id)),
        profile.displayName,
      );
      return {
        schemaVersion: '1.0',
        analysisId: analysis.id,
        provider: profile.provider,
        providerId: profile.id,
        providerLabel: profile.displayName,
        model: profile.model,
        generatedAt: now().toISOString(),
        promptVersion: AI_PROMPT_VERSION,
        ...generated,
        ...(completion.usage === undefined ? {} : { usage: completion.usage }),
      };
    },
  };
}

function statusForProfile(
  config: AiRuntimeConfig,
  profileId: string,
  environment: NodeJS.ProcessEnv,
  directSecrets: Readonly<Record<string, string | undefined>>,
): AiProviderStatus {
  const profile = config.profiles.find((candidate) => candidate.id === profileId)!;
  const configured = profile.auth.type === 'none'
    || resolveApiKey(profile.id, profile.auth, environment, directSecrets) !== undefined;
  return {
    id: profile.id,
    label: profile.displayName,
    displayName: profile.displayName,
    provider: profile.provider,
    model: profile.model,
    enabled: profile.enabled,
    configured,
    available: config.enabled && profile.enabled && configured,
    local: isLoopbackBaseUrl(profile.baseUrl),
  };
}

function resolveApiKey(
  profileId: string,
  auth: { type: 'bearer' | 'none'; secretEnv?: string },
  environment: NodeJS.ProcessEnv,
  directSecrets: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (auth.type === 'none') return undefined;
  return nonEmpty(directSecrets[profileId]) ?? nonEmpty(environment[auth.secretEnv as string]);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
