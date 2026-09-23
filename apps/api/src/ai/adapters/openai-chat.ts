import type { StoredAnalysis } from '../../types.js';
import type { AiLimitsConfig, AiProfileConfig } from '../config.js';
import { buildAiReviewMessages } from '../prompt.js';
import { GENERATED_REVIEW_JSON_SCHEMA } from '../review-schema.js';
import { AiServiceError, type AiReviewRequest } from '../types.js';

export interface AdapterCompletion {
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface OpenAiChatAdapterOptions {
  profile: AiProfileConfig;
  limits: AiLimitsConfig;
  analysis: StoredAnalysis;
  request: AiReviewRequest;
  apiKey?: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export async function requestOpenAiChatCompletion(options: OpenAiChatAdapterOptions): Promise<AdapterCompletion> {
  const { profile, limits } = options;
  const controller = new AbortController();
  let timedOut = false;
  let callerCancelled = false;
  const abortFromCaller = (): void => {
    callerCancelled = true;
    controller.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    if (callerCancelled) return;
    timedOut = true;
    controller.abort();
  }, limits.timeoutMs);
  try {
    if (callerCancelled) throw cancelledRequest();
    const response = await options.fetch(chatCompletionsEndpoint(profile.baseUrl), {
      method: 'POST',
      headers: {
        ...(profile.auth.type === 'bearer' ? { Authorization: `Bearer ${options.apiKey as string}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRequestBody(options)),
      signal: controller.signal,
      // Do not forward a credential to a redirect target chosen by an upstream.
      redirect: 'error',
    });

    if (!response.ok) {
      throw new AiServiceError(502, 'AI_UPSTREAM_ERROR', `${profile.displayName} returned HTTP ${response.status}.`);
    }
    const envelope = await readJsonEnvelope(response, profile.displayName, limits.maxResponseBytes);
    return extractCompletion(envelope, profile.displayName, limits.maxResponseBytes);
  } catch (error) {
    if (timedOut) {
      throw new AiServiceError(504, 'AI_UPSTREAM_TIMEOUT', `The ${profile.displayName} request timed out.`);
    }
    if (callerCancelled) throw cancelledRequest();
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError(502, 'AI_UPSTREAM_UNAVAILABLE', `${profile.displayName} could not be reached.`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function buildRequestBody(options: OpenAiChatAdapterOptions): Record<string, unknown> {
  const { profile, limits, analysis, request } = options;
  return {
    model: profile.model,
    ...tokenLimitParameter(profile, limits.maxOutputTokens),
    ...structuredOutputParameter(profile),
    ...(profile.capabilities.thinkingControl === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
    messages: buildAiReviewMessages(analysis, request, limits.maxChanges),
  };
}

function tokenLimitParameter(profile: AiProfileConfig, maximumTokens: number): Record<string, unknown> {
  switch (profile.capabilities.tokenLimitParameter ?? 'max_tokens') {
    case 'max_completion_tokens':
      return { max_completion_tokens: maximumTokens };
    case 'max_tokens':
      return { max_tokens: maximumTokens };
    case 'none':
      return {};
  }
}

function structuredOutputParameter(profile: AiProfileConfig): Record<string, unknown> {
  switch (profile.capabilities.structuredOutput) {
    case 'json-schema':
      return {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'contractguard_ai_review',
            strict: true,
            schema: GENERATED_REVIEW_JSON_SCHEMA,
          },
        },
      };
    case 'json-object':
      return { response_format: { type: 'json_object' } };
    case 'prompt-only':
      return {};
  }
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

async function readJsonEnvelope(
  response: Response,
  providerLabel: string,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readLimitedResponseText(response, maximumBytes, providerLabel);
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError(502, 'AI_UPSTREAM_ERROR', `The ${providerLabel} response could not be read.`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw invalidResponse(`${providerLabel} returned an invalid response envelope.`);
  }
}

async function readLimitedResponseText(response: Response, maximumBytes: number, providerLabel: string): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw invalidResponse(`${providerLabel} returned an oversized response.`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function extractCompletion(
  envelope: Record<string, unknown>,
  providerLabel: string,
  maximumBytes: number,
): AdapterCompletion {
  const choices = envelope.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isPlainObject(choices[0])) {
    throw invalidResponse(`${providerLabel} returned no review choice.`);
  }
  const choice = choices[0];
  const message = choice.message;
  if (!isPlainObject(message) || typeof message.content !== 'string' || !message.content.trim()) {
    throw invalidResponse(`${providerLabel} returned an empty review.`);
  }
  if (Buffer.byteLength(message.content, 'utf8') > maximumBytes) {
    throw invalidResponse(`${providerLabel} returned an oversized review.`);
  }
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
  const usage = extractUsage(envelope);
  return {
    content: message.content,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function extractUsage(envelope: Record<string, unknown>): AdapterCompletion['usage'] | undefined {
  if (envelope.usage === undefined) return undefined;
  const value = expectObject(envelope.usage, 'usage');
  const usage: NonNullable<AdapterCompletion['usage']> = {};
  if (value.prompt_tokens !== undefined) usage.promptTokens = expectInteger(value.prompt_tokens, 'usage.prompt_tokens', 0, Number.MAX_SAFE_INTEGER);
  if (value.completion_tokens !== undefined) usage.completionTokens = expectInteger(value.completion_tokens, 'usage.completion_tokens', 0, Number.MAX_SAFE_INTEGER);
  if (value.total_tokens !== undefined) usage.totalTokens = expectInteger(value.total_tokens, 'usage.total_tokens', 0, Number.MAX_SAFE_INTEGER);
  return usage;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidResponse(`${path} must be an object.`);
  return value;
}

function expectInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidResponse(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function invalidResponse(message: string): AiServiceError {
  return new AiServiceError(502, 'AI_INVALID_RESPONSE', message);
}

function cancelledRequest(): AiServiceError {
  return new AiServiceError(499, 'AI_REQUEST_CANCELLED', 'The AI review request was cancelled.');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
