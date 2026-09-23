import type { AiReview, AiRiskLevel, AiRiskPriority } from './types.js';
import { AiServiceError } from './types.js';

export interface GeneratedReview {
  overview: AiReview['overview'];
  keyRisks: AiReview['keyRisks'];
  migrationPlan: AiReview['migrationPlan'];
  testSuggestions: AiReview['testSuggestions'];
  caveats: AiReview['caveats'];
}

/**
 * Provider-neutral schema used when an upstream supports strict structured output.
 * It intentionally uses the widely supported subset; all length/count/range limits
 * remain enforced by the local validator below and cannot be bypassed by a provider.
 */
export const GENERATED_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'keyRisks', 'migrationPlan', 'testSuggestions', 'caveats'],
  properties: {
    overview: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'executiveSummary', 'riskLevel'],
      properties: {
        headline: { type: 'string' },
        executiveSummary: { type: 'string' },
        riskLevel: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      },
    },
    keyRisks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['changeId', 'title', 'explanation', 'affectedConsumers', 'remediation', 'priority'],
        properties: {
          changeId: { type: 'string' },
          title: { type: 'string' },
          explanation: { type: 'string' },
          affectedConsumers: { type: 'array', items: { type: 'string' } },
          remediation: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
        },
      },
    },
    migrationPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['order', 'title', 'actions', 'relatedChangeIds'],
        properties: {
          order: { type: 'integer' },
          title: { type: 'string' },
          actions: { type: 'array', items: { type: 'string' } },
          relatedChangeIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    testSuggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'details', 'relatedChangeIds'],
        properties: {
          title: { type: 'string' },
          details: { type: 'string' },
          relatedChangeIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    caveats: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function parseAndValidateGeneratedReview(
  content: string,
  validChangeIds: Set<string>,
  providerLabel: string,
): GeneratedReview {
  const normalized = content.trim().replace(/^\uFEFF/, '');
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(normalized);
  const exactCandidate = (fenced?.[1] ?? normalized).trim();
  const candidates = new Set([exactCandidate, ...balancedJsonObjects(normalized)]);
  const validReviews: GeneratedReview[] = [];
  let validationError: AiServiceError | undefined;

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed === undefined) continue;
    try {
      validReviews.push(validateGeneratedReview(parsed, validChangeIds));
    } catch (error) {
      if (!(error instanceof AiServiceError) || error.code !== 'AI_INVALID_RESPONSE') throw error;
      validationError = error;
    }
  }

  if (validReviews.length === 1) return validReviews[0]!;
  if (validReviews.length > 1) throw invalidResponse(`${providerLabel} returned multiple valid JSON review objects.`);
  if (validationError !== undefined) throw validationError;
  throw invalidResponse(`${providerLabel} did not return valid JSON.`);
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Extract complete JSON objects while ignoring braces inside JSON strings. */
function balancedJsonObjects(value: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (insideString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') insideString = false;
      continue;
    }
    if (character === '"') insideString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        candidates.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function validateGeneratedReview(value: unknown, validChangeIds: Set<string>): GeneratedReview {
  const root = expectObject(value, 'review');
  assertOnlyKeys(root, ['overview', 'keyRisks', 'migrationPlan', 'testSuggestions', 'caveats'], 'review');

  const overviewValue = expectObject(root.overview, 'overview');
  assertOnlyKeys(overviewValue, ['headline', 'executiveSummary', 'riskLevel'], 'overview');
  const riskLevel = expectEnum(overviewValue.riskLevel, ['critical', 'high', 'medium', 'low'] as const, 'overview.riskLevel');
  const overview = {
    headline: expectString(overviewValue.headline, 'overview.headline', 160),
    executiveSummary: expectString(overviewValue.executiveSummary, 'overview.executiveSummary', 4_000),
    riskLevel: riskLevel as AiRiskLevel,
  };

  const keyRisks = expectArray(root.keyRisks, 'keyRisks', 8).map((item, index) => {
    const risk = expectObject(item, `keyRisks[${index}]`);
    assertOnlyKeys(risk, ['changeId', 'title', 'explanation', 'affectedConsumers', 'remediation', 'priority'], `keyRisks[${index}]`);
    const changeId = expectChangeId(risk.changeId, `keyRisks[${index}].changeId`, validChangeIds);
    const priority = expectEnum(risk.priority, ['P0', 'P1', 'P2'] as const, `keyRisks[${index}].priority`);
    return {
      changeId,
      title: expectString(risk.title, `keyRisks[${index}].title`, 200),
      explanation: expectString(risk.explanation, `keyRisks[${index}].explanation`, 2_000),
      affectedConsumers: expectStringArray(risk.affectedConsumers, `keyRisks[${index}].affectedConsumers`, 20, 200),
      remediation: expectString(risk.remediation, `keyRisks[${index}].remediation`, 2_000),
      priority: priority as AiRiskPriority,
    };
  });

  const migrationPlan = expectArray(root.migrationPlan, 'migrationPlan', 8).map((item, index) => {
    const step = expectObject(item, `migrationPlan[${index}]`);
    assertOnlyKeys(step, ['order', 'title', 'actions', 'relatedChangeIds'], `migrationPlan[${index}]`);
    return {
      order: expectInteger(step.order, `migrationPlan[${index}].order`, 1, 100),
      title: expectString(step.title, `migrationPlan[${index}].title`, 200),
      actions: expectStringArray(step.actions, `migrationPlan[${index}].actions`, 15, 500),
      relatedChangeIds: expectChangeIdArray(step.relatedChangeIds, `migrationPlan[${index}].relatedChangeIds`, validChangeIds),
    };
  });

  const testSuggestions = expectArray(root.testSuggestions, 'testSuggestions', 8).map((item, index) => {
    const suggestion = expectObject(item, `testSuggestions[${index}]`);
    assertOnlyKeys(suggestion, ['title', 'details', 'relatedChangeIds'], `testSuggestions[${index}]`);
    return {
      title: expectString(suggestion.title, `testSuggestions[${index}].title`, 200),
      details: expectString(suggestion.details, `testSuggestions[${index}].details`, 2_000),
      relatedChangeIds: expectChangeIdArray(suggestion.relatedChangeIds, `testSuggestions[${index}].relatedChangeIds`, validChangeIds),
    };
  });

  return {
    overview,
    keyRisks,
    migrationPlan,
    testSuggestions,
    caveats: expectStringArray(root.caveats, 'caveats', 6, 500),
  };
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidResponse(`${path} must be an object.`);
  return value;
}

function expectArray(value: unknown, path: string, maximumLength: number): unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(`${path} must be an array.`);
  return value.slice(0, maximumLength);
}

function expectString(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) {
    throw invalidResponse(`${path} must be a non-empty string no longer than ${maximumLength} characters.`);
  }
  return value.trim();
}

function expectStringArray(value: unknown, path: string, maximumItems: number, maximumStringLength: number): string[] {
  const items = typeof value === 'string' ? [value] : expectArray(value, path, maximumItems);
  return items.map((item, index) => expectString(item, `${path}[${index}]`, maximumStringLength));
}

function expectChangeId(value: unknown, path: string, validIds: Set<string>): string {
  const id = expectString(value, path, 100);
  if (!validIds.has(id)) throw invalidResponse(`${path} does not reference a finding in this analysis.`);
  return id;
}

function expectChangeIdArray(value: unknown, path: string, validIds: Set<string>): string[] {
  const items = typeof value === 'string' ? [value] : expectArray(value, path, 50);
  return items.map((item, index) => expectChangeId(item, `${path}[${index}]`, validIds));
}

function expectInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidResponse(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function expectEnum<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw invalidResponse(`${path} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T[number];
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw invalidResponse(`${path} contains the unsupported field ${unexpected}.`);
}

function invalidResponse(message: string): AiServiceError {
  return new AiServiceError(502, 'AI_INVALID_RESPONSE', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
