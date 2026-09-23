import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';

export const DEFAULT_AI_TIMEOUT_MS = 30_000;
export const DEFAULT_AI_MAX_CHANGES = 50;
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_AI_MAX_RESPONSE_BYTES = 128 * 1024;
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
const MAX_CONFIG_BYTES = 256 * 1024;

/** A safe display/audit identifier; protocol execution remains restricted by AiAdapterKind. */
export type AiProviderKind = string;
export type AiAdapterKind = 'openai-chat';
export type AiStructuredOutputMode = 'json-schema' | 'json-object' | 'prompt-only';
export type AiThinkingControl = 'disabled' | 'none';
export type AiTokenLimitParameter = 'max_tokens' | 'max_completion_tokens' | 'none';

export interface AiLimitsConfig {
  timeoutMs: number;
  maxChanges: number;
  maxOutputTokens: number;
  maxResponseBytes: number;
}

export interface AiProfileConfig {
  id: string;
  enabled: boolean;
  displayName: string;
  provider: AiProviderKind;
  adapter: AiAdapterKind;
  baseUrl: string;
  model: string;
  auth: {
    type: 'bearer' | 'none';
    secretEnv?: string;
  };
  capabilities: {
    structuredOutput: AiStructuredOutputMode;
    thinkingControl: AiThinkingControl;
    tokenLimitParameter?: AiTokenLimitParameter;
  };
  dataBoundary: string;
}

export interface AiRuntimeConfig {
  schemaVersion: 1;
  enabled: boolean;
  activeProfile: string;
  allowRequestProfileOverride: boolean;
  defaults: AiLimitsConfig;
  profiles: AiProfileConfig[];
}

export interface LegacyDeepSeekConfig {
  enabled: boolean;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxChanges: number;
  maxOutputTokens: number;
  maxResponseBytes?: number;
}

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid LLM configuration: ${message}`);
    this.name = 'AiConfigurationError';
  }
}

export function loadAiConfiguration(
  path = nonEmpty(process.env.CONTRACTGUARD_LLM_CONFIG),
): AiRuntimeConfig | undefined {
  if (path === undefined) return undefined;
  const absolutePath = resolve(path);
  let text: string;
  try {
    const stats = statSync(absolutePath);
    if (!stats.isFile()) throw new AiConfigurationError('CONTRACTGUARD_LLM_CONFIG must point to a file.');
    if (stats.size > MAX_CONFIG_BYTES) throw new AiConfigurationError(`the configuration file exceeds ${MAX_CONFIG_BYTES} bytes.`);
    text = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    if (error instanceof AiConfigurationError) throw error;
    throw new AiConfigurationError('the configuration file could not be read.');
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new AiConfigurationError('the configuration file is not valid JSON.');
  }
  return parseAiConfiguration(value);
}

/** Strictly validates the server-owned JSON document. Unknown fields are rejected. */
export function parseAiConfiguration(value: unknown): AiRuntimeConfig {
  const root = expectObject(value, 'root');
  assertOnlyKeys(root, [
    '$schema',
    'schemaVersion',
    'enabled',
    'activeProfile',
    'allowRequestProfileOverride',
    'defaults',
    'profiles',
  ], 'root');
  if (root.$schema !== undefined) expectString(root.$schema, '$schema', 500);
  if (root.schemaVersion !== 1) fail('schemaVersion must be 1.');
  const enabled = expectBoolean(root.enabled, 'enabled');
  const activeProfile = expectIdentifier(root.activeProfile, 'activeProfile');
  const allowRequestProfileOverride = expectBoolean(root.allowRequestProfileOverride, 'allowRequestProfileOverride');
  const defaults = parseLimits(root.defaults);
  const profileMap = expectObject(root.profiles, 'profiles');
  const entries = Object.entries(profileMap);
  if (entries.length === 0 || entries.length > 32) fail('profiles must contain from 1 to 32 entries.');
  const profiles = entries.map(([id, profile]) => parseProfile(id, profile));
  if (!profiles.some((profile) => profile.id === activeProfile)) fail('activeProfile must reference a configured profile.');
  if (!profiles.some((profile) => profile.id === activeProfile && profile.enabled)) {
    fail('activeProfile must reference an enabled profile.');
  }
  return {
    schemaVersion: 1,
    enabled,
    activeProfile,
    allowRequestProfileOverride,
    defaults,
    profiles,
  };
}

export function createLegacyDeepSeekConfiguration(
  config: LegacyDeepSeekConfig,
): AiRuntimeConfig & { legacyApiKey?: string } {
  const profile: AiProfileConfig = {
    id: 'deepseek',
    enabled: true,
    displayName: 'DeepSeek',
    provider: 'deepseek',
    adapter: 'openai-chat',
    baseUrl: validateBaseUrl(config.baseUrl, 'profiles.deepseek.baseUrl', 'deepseek-cloud'),
    model: boundedRuntimeString(config.model, DEFAULT_DEEPSEEK_MODEL, 100),
    auth: { type: 'bearer', secretEnv: 'DEEPSEEK_API_KEY' },
    capabilities: {
      structuredOutput: 'json-object',
      thinkingControl: 'disabled',
      tokenLimitParameter: 'max_tokens',
    },
    dataBoundary: 'deepseek-cloud',
  };
  return {
    schemaVersion: 1,
    enabled: config.enabled,
    activeProfile: profile.id,
    allowRequestProfileOverride: false,
    defaults: {
      timeoutMs: boundedInteger(config.timeoutMs, DEFAULT_AI_TIMEOUT_MS, 1, 120_000),
      maxChanges: boundedInteger(config.maxChanges, DEFAULT_AI_MAX_CHANGES, 1, 200),
      maxOutputTokens: boundedInteger(config.maxOutputTokens, DEFAULT_AI_MAX_OUTPUT_TOKENS, 512, 32_768),
      maxResponseBytes: boundedInteger(
        config.maxResponseBytes ?? DEFAULT_AI_MAX_RESPONSE_BYTES,
        DEFAULT_AI_MAX_RESPONSE_BYTES,
        1_024,
        1024 * 1024,
      ),
    },
    profiles: [profile],
    ...(config.apiKey === undefined ? {} : { legacyApiKey: config.apiKey }),
  };
}

export function legacyDeepSeekConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): LegacyDeepSeekConfig {
  return {
    enabled: parseBoolean(environment.CONTRACTGUARD_AI_ENABLED, false),
    apiKey: nonEmpty(environment.DEEPSEEK_API_KEY),
    baseUrl: nonEmpty(environment.DEEPSEEK_BASE_URL) ?? 'https://api.deepseek.com',
    model: boundedRuntimeString(nonEmpty(environment.DEEPSEEK_MODEL) ?? DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 100),
    timeoutMs: runtimeInteger(environment.CONTRACTGUARD_AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS, 1, 120_000),
    maxChanges: runtimeInteger(environment.CONTRACTGUARD_AI_MAX_CHANGES, DEFAULT_AI_MAX_CHANGES, 1, 200),
    maxOutputTokens: runtimeInteger(
      environment.CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS,
      DEFAULT_AI_MAX_OUTPUT_TOKENS,
      512,
      32_768,
    ),
    maxResponseBytes: runtimeInteger(
      environment.CONTRACTGUARD_AI_MAX_RESPONSE_BYTES,
      DEFAULT_AI_MAX_RESPONSE_BYTES,
      1_024,
      1024 * 1024,
    ),
  };
}

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  return isLoopbackHostname(new URL(baseUrl).hostname);
}

function parseLimits(value: unknown): AiLimitsConfig {
  const limits = expectObject(value, 'defaults');
  assertOnlyKeys(limits, ['timeoutMs', 'maxChanges', 'maxOutputTokens', 'maxResponseBytes'], 'defaults');
  return {
    timeoutMs: expectInteger(limits.timeoutMs, 'defaults.timeoutMs', 1, 120_000),
    maxChanges: expectInteger(limits.maxChanges, 'defaults.maxChanges', 1, 200),
    maxOutputTokens: expectInteger(limits.maxOutputTokens, 'defaults.maxOutputTokens', 512, 32_768),
    maxResponseBytes: expectInteger(limits.maxResponseBytes, 'defaults.maxResponseBytes', 1_024, 1024 * 1024),
  };
}

function parseProfile(idValue: string, value: unknown): AiProfileConfig {
  const id = expectIdentifier(idValue, `profiles.${idValue}`);
  const path = `profiles.${id}`;
  const profile = expectObject(value, path);
  assertOnlyKeys(profile, [
    'enabled',
    'displayName',
    'provider',
    'adapter',
    'baseUrl',
    'model',
    'auth',
    'capabilities',
    'dataBoundary',
  ], path);

  const provider = expectIdentifier(profile.provider, `${path}.provider`);
  const adapter = expectEnum(profile.adapter, ['openai-chat'] as const, `${path}.adapter`);
  const dataBoundary = expectString(profile.dataBoundary, `${path}.dataBoundary`, 100);
  const authValue = expectObject(profile.auth, `${path}.auth`);
  assertOnlyKeys(authValue, ['type', 'secretEnv'], `${path}.auth`);
  const authType = expectEnum(authValue.type, ['bearer', 'none'] as const, `${path}.auth.type`);
  let secretEnv: string | undefined;
  if (authType === 'bearer') {
    secretEnv = expectEnvironmentName(authValue.secretEnv, `${path}.auth.secretEnv`);
  } else if (authValue.secretEnv !== undefined) {
    fail(`${path}.auth.secretEnv is not allowed when auth.type is none.`);
  }

  const capabilitiesValue = expectObject(profile.capabilities, `${path}.capabilities`);
  assertOnlyKeys(
    capabilitiesValue,
    ['structuredOutput', 'thinkingControl', 'tokenLimitParameter'],
    `${path}.capabilities`,
  );
  const structuredOutput = expectEnum(
    capabilitiesValue.structuredOutput,
    ['json-schema', 'json-object', 'prompt-only'] as const,
    `${path}.capabilities.structuredOutput`,
  );
  const thinkingControl = expectEnum(
    capabilitiesValue.thinkingControl,
    ['disabled', 'none'] as const,
    `${path}.capabilities.thinkingControl`,
  );
  const tokenLimitParameter = capabilitiesValue.tokenLimitParameter === undefined
    ? 'max_tokens'
    : expectEnum(
      capabilitiesValue.tokenLimitParameter,
      ['max_tokens', 'max_completion_tokens', 'none'] as const,
      `${path}.capabilities.tokenLimitParameter`,
    );

  return {
    id,
    enabled: expectBoolean(profile.enabled, `${path}.enabled`),
    displayName: expectString(profile.displayName, `${path}.displayName`, 100),
    provider,
    adapter,
    baseUrl: validateBaseUrl(
      expectString(profile.baseUrl, `${path}.baseUrl`, 2_000),
      `${path}.baseUrl`,
      dataBoundary,
    ),
    model: expectString(profile.model, `${path}.model`, 200),
    auth: { type: authType, ...(secretEnv === undefined ? {} : { secretEnv }) },
    capabilities: { structuredOutput, thinkingControl, tokenLimitParameter },
    dataBoundary,
  };
}

function validateBaseUrl(value: string, path: string, dataBoundary: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${path} must be an absolute HTTP(S) URL.`);
  }
  if (parsed.username || parsed.password) fail(`${path} must not contain embedded credentials.`);
  if (parsed.search || parsed.hash) fail(`${path} must not contain a query string or fragment.`);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') fail(`${path} must use HTTP(S).`);
  const loopback = isLoopbackHostname(parsed.hostname);
  const explicitlyLocal = dataBoundary === 'local';
  if (loopback && !explicitlyLocal) {
    fail(`${path} may use a loopback address only when dataBoundary is local.`);
  }
  if (explicitlyLocal && !loopback) {
    fail(`${path} for a local profile must use localhost, 127.0.0.1, or ::1.`);
  }
  if (!loopback && parsed.protocol !== 'https:') {
    fail(`${path} must use HTTPS; HTTP is allowed only for an explicitly local profile.`);
  }
  const normalizedHostname = normalizeHostname(parsed.hostname);
  if (!loopback && (
    isIP(normalizedHostname) !== 0
    || normalizedHostname.endsWith('.localhost')
    || normalizedHostname.endsWith('.local')
  )) {
    fail(`${path} for a cloud profile must use a public HTTPS hostname, not an IP literal or local hostname.`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    fail(`${path} must be a non-empty string no longer than ${maximumLength} characters.`);
  }
  return value.trim();
}

function expectIdentifier(value: unknown, path: string): string {
  const id = expectString(value, path, 64);
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(id)) {
    fail(`${path} must contain only lowercase letters, numbers, dots, underscores, or hyphens.`);
  }
  return id;
}

function expectEnvironmentName(value: unknown, path: string): string {
  const name = expectString(value, path, 100);
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) fail(`${path} must be an uppercase environment-variable name.`);
  return name;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean.`);
  return value as boolean;
}

function expectInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function expectEnum<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(`${path} must be one of: ${allowed.join(', ')}.`);
  return value as T[number];
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) fail(`${path} contains the unsupported field ${unexpected}.`);
}

function fail(message: string): never {
  throw new AiConfigurationError(message);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function runtimeInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function boundedRuntimeString(value: string, fallback: string, maximumLength: number): string {
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximumLength ? trimmed : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
