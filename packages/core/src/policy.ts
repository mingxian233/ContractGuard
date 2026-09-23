import { ContractGuardError } from "./errors.js";
import { fingerprintObject } from "./fingerprint.js";
import { ruleCatalog } from "./rules.js";
import type { AppliedPolicy, RulePolicy, RulePolicyRule, Severity } from "./types.js";

export const DEFAULT_SCORING_WEIGHTS: Readonly<Record<Severity, number>> = Object.freeze({
  breaking: 12,
  "potentially-breaking": 4,
  "non-breaking": 0,
  info: 0,
});

export const DEFAULT_RULE_POLICY: Readonly<RulePolicy> = Object.freeze({
  schemaVersion: 1,
  id: "contractguard-default",
});

export interface ResolvedRulePolicy {
  metadata: AppliedPolicy;
  rules: Readonly<Record<string, Readonly<RulePolicyRule>>>;
  scoring: Readonly<Record<Severity, number>>;
}

const SEVERITIES = new Set<Severity>(["breaking", "potentially-breaking", "non-breaking", "info"]);
const TOP_LEVEL_KEYS = new Set(["schemaVersion", "id", "rules", "scoring"]);
const RULE_KEYS = new Set(["enabled", "severity"]);

export function validateRulePolicy(value: unknown): RulePolicy {
  if (!isRecord(value)) invalid("Rule policy must be a JSON object.");
  for (const key of Object.keys(value)) if (!TOP_LEVEL_KEYS.has(key)) invalid(`Unsupported rule policy field: ${key}.`);
  if (value.schemaVersion !== 1) invalid("Rule policy schemaVersion must be 1.");
  if (value.id !== undefined && (!isSafeId(value.id) || value.id.length > 100)) {
    invalid("Rule policy id must contain 1-100 letters, digits, dots, underscores, or hyphens.");
  }

  const validRuleIds = new Set(ruleCatalog.map((rule) => rule.id));
  let rules: Record<string, RulePolicyRule> | undefined;
  if (value.rules !== undefined) {
    if (!isRecord(value.rules)) invalid("Rule policy rules must be a JSON object.");
    rules = {};
    for (const [ruleId, candidate] of Object.entries(value.rules)) {
      if (!validRuleIds.has(ruleId)) invalid(`Unknown rule id in policy: ${ruleId}.`);
      if (!isRecord(candidate)) invalid(`Policy for ${ruleId} must be a JSON object.`);
      for (const key of Object.keys(candidate)) if (!RULE_KEYS.has(key)) invalid(`Unsupported ${ruleId} policy field: ${key}.`);
      if (candidate.enabled !== undefined && typeof candidate.enabled !== "boolean") {
        invalid(`${ruleId}.enabled must be a boolean.`);
      }
      if (candidate.severity !== undefined && !SEVERITIES.has(candidate.severity as Severity)) {
        invalid(`${ruleId}.severity is not a supported severity.`);
      }
      rules[ruleId] = {
        ...(candidate.enabled === undefined ? {} : { enabled: candidate.enabled }),
        ...(candidate.severity === undefined ? {} : { severity: candidate.severity as Severity }),
      };
    }
  }

  let scoring: Partial<Record<Severity, number>> | undefined;
  if (value.scoring !== undefined) {
    if (!isRecord(value.scoring)) invalid("Rule policy scoring must be a JSON object.");
    scoring = {};
    for (const [severity, weight] of Object.entries(value.scoring)) {
      if (!SEVERITIES.has(severity as Severity)) invalid(`Unknown scoring severity: ${severity}.`);
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100) {
        invalid(`Scoring weight for ${severity} must be a number from 0 to 100.`);
      }
      scoring[severity as Severity] = weight;
    }
  }

  return {
    schemaVersion: 1,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(rules === undefined ? {} : { rules }),
    ...(scoring === undefined ? {} : { scoring }),
  };
}

export function resolveRulePolicy(value: RulePolicy | undefined): ResolvedRulePolicy {
  const policy = validateRulePolicy(value ?? DEFAULT_RULE_POLICY);
  const normalized: RulePolicy = {
    schemaVersion: 1,
    id: policy.id ?? "custom-policy",
    rules: policy.rules ?? {},
    scoring: policy.scoring ?? {},
  };
  return {
    metadata: {
      id: normalized.id as string,
      fingerprint: fingerprintObject(normalized),
    },
    rules: normalized.rules as Record<string, RulePolicyRule>,
    scoring: Object.freeze({ ...DEFAULT_SCORING_WEIGHTS, ...normalized.scoring }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function invalid(message: string): never {
  throw new ContractGuardError("INVALID_POLICY", message);
}
