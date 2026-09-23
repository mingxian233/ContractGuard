import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const projectRoot = resolve(import.meta.dirname, '../../..');

const yamlChecks = [
  ['.github/workflows/ci.yml', (value) => isObject(value.jobs) && isObject(value.jobs.verify)],
  ['.github/ISSUE_TEMPLATE/bug_report.yml', isIssueForm],
  ['.github/ISSUE_TEMPLATE/false_positive_or_negative.yml', isIssueForm],
  ['.github/ISSUE_TEMPLATE/rule_request.yml', isIssueForm],
  ['.github/ISSUE_TEMPLATE/config.yml', (value) => Array.isArray(value.contact_links)],
  ['docker-compose.yml', (value) => isObject(value.services) && isObject(value.services.contractguard)],
  ['examples/github-actions-contractguard.yml', (value) => isObject(value.jobs) && isObject(value.jobs.compatibility)],
];

for (const [relativePath, validate] of yamlChecks) {
  const value = parseYaml(await read(relativePath));
  if (!isObject(value) || !validate(value)) throw new Error(`${relativePath} is missing its expected top-level structure.`);
}

const aiExample = JSON.parse(await read('examples/ai-review-request.json'));
if (!isObject(aiExample) || typeof aiExample.language !== 'string' || !['zh-CN', 'en'].includes(aiExample.language)) {
  throw new Error('examples/ai-review-request.json must contain a supported language.');
}

const llmSchema = JSON.parse(await read('config/llm-providers.schema.json'));
if (
  !isObject(llmSchema)
  || llmSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
  || llmSchema.additionalProperties !== false
  || !isObject(llmSchema.$defs)
) {
  throw new Error('config/llm-providers.schema.json must be a strict JSON Schema 2020-12 document.');
}

const llmExample = JSON.parse(await read('config/llm-providers.example.json'));
validateLlmExample(llmExample);

const policySchema = JSON.parse(await read('config/rule-policy.schema.json'));
if (
  !isObject(policySchema)
  || policySchema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
  || policySchema.additionalProperties !== false
  || !isObject(policySchema.$defs)
) {
  throw new Error('config/rule-policy.schema.json must be a strict JSON Schema 2020-12 document.');
}
const policyExample = JSON.parse(await read('config/rule-policy.example.json'));
validateRulePolicyExample(policyExample, policySchema);

const environmentEntries = new Map();
for (const [index, sourceLine] of (await read('.env.example')).split(/\r?\n/).entries()) {
  const line = sourceLine.trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) throw new Error(`.env.example:${index + 1} is not a KEY=value entry.`);
  if (environmentEntries.has(match[1])) throw new Error(`.env.example contains duplicate key ${match[1]}.`);
  environmentEntries.set(match[1], match[2]);
}

for (const required of [
  'PORT',
  'HOST',
  'CONTRACTGUARD_DATA_DIR',
  'CONTRACTGUARD_POLICY_CONFIG',
  'CONTRACTGUARD_LLM_CONFIG',
  'CONTRACTGUARD_AI_ENABLED',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
]) {
  if (!environmentEntries.has(required)) throw new Error(`.env.example is missing ${required}.`);
}

process.stdout.write(`Configuration examples OK: ${yamlChecks.length} YAML, 5 JSON, ${environmentEntries.size} environment entries.\n`);

async function read(relativePath) {
  return readFile(resolve(projectRoot, relativePath), 'utf8');
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIssueForm(value) {
  return typeof value.name === 'string'
    && typeof value.description === 'string'
    && Array.isArray(value.body)
    && value.body.length > 0;
}

function validateLlmExample(value) {
  if (!isObject(value) || value.schemaVersion !== 1) {
    throw new Error('config/llm-providers.example.json must use schemaVersion 1.');
  }
  if (typeof value.enabled !== 'boolean' || typeof value.allowRequestProfileOverride !== 'boolean') {
    throw new Error('LLM example enabled and allowRequestProfileOverride must be booleans.');
  }
  if (!isObject(value.defaults)) throw new Error('LLM example is missing defaults.');
  const integerRanges = {
    timeoutMs: [1, 120_000],
    maxChanges: [1, 200],
    maxOutputTokens: [512, 32_768],
    maxResponseBytes: [1_024, 1024 * 1024],
  };
  for (const [name, [minimum, maximum]] of Object.entries(integerRanges)) {
    const setting = value.defaults[name];
    if (!Number.isSafeInteger(setting) || setting < minimum || setting > maximum) {
      throw new Error(`LLM example defaults.${name} is outside its supported range.`);
    }
  }

  if (!isObject(value.profiles)) throw new Error('LLM example profiles must be an object.');
  const profileEntries = Object.entries(value.profiles);
  if (profileEntries.length < 1 || profileEntries.length > 32) {
    throw new Error('LLM example must contain from 1 to 32 profiles.');
  }
  if (typeof value.activeProfile !== 'string' || !isObject(value.profiles[value.activeProfile])) {
    throw new Error('LLM example activeProfile must reference a configured profile.');
  }
  if (value.profiles[value.activeProfile].enabled !== true) {
    throw new Error('LLM example activeProfile must be enabled.');
  }

  const expectedProviders = new Set(['deepseek', 'openai', 'gemini', 'ollama']);
  for (const [id, profile] of profileEntries) {
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(id) || !isObject(profile)) {
      throw new Error(`LLM example contains an invalid profile id: ${id}.`);
    }
    if (!expectedProviders.delete(profile.provider)) {
      throw new Error(`LLM example has a duplicate or unsupported provider: ${String(profile.provider)}.`);
    }
    if (profile.adapter !== 'openai-chat' || typeof profile.enabled !== 'boolean') {
      throw new Error(`LLM example profile ${id} has an unsupported adapter or enabled value.`);
    }
    if (typeof profile.baseUrl !== 'string' || typeof profile.model !== 'string' || !profile.model.trim()) {
      throw new Error(`LLM example profile ${id} must contain a baseUrl and model.`);
    }
    const loopback = validateExampleBaseUrl(profile.baseUrl, id);
    if (!isObject(profile.auth) || !['bearer', 'none'].includes(profile.auth.type)) {
      throw new Error(`LLM example profile ${id} has an invalid auth block.`);
    }
    if (profile.auth.type === 'bearer' && !/^[A-Z_][A-Z0-9_]*$/.test(profile.auth.secretEnv)) {
      throw new Error(`LLM example profile ${id} must reference a secret environment variable.`);
    }
    if (profile.auth.type === 'none' && profile.auth.secretEnv !== undefined) {
      throw new Error(`LLM example profile ${id} must not declare secretEnv for auth.type none.`);
    }
    if (
      !isObject(profile.capabilities)
      || !['json-schema', 'json-object', 'prompt-only'].includes(profile.capabilities.structuredOutput)
      || !['disabled', 'none'].includes(profile.capabilities.thinkingControl)
      || !['max_tokens', 'max_completion_tokens', 'none'].includes(profile.capabilities.tokenLimitParameter ?? 'max_tokens')
    ) {
      throw new Error(`LLM example profile ${id} has invalid capabilities.`);
    }
    if (typeof profile.dataBoundary !== 'string' || !profile.dataBoundary.trim()) {
      throw new Error(`LLM example profile ${id} must declare its dataBoundary.`);
    }
    if ((profile.dataBoundary === 'local') !== loopback) {
      throw new Error(`LLM example profile ${id} must pair loopback baseUrl with dataBoundary local.`);
    }
  }
  if (expectedProviders.size > 0) {
    throw new Error(`LLM example is missing provider examples: ${[...expectedProviders].join(', ')}.`);
  }
}

function validateExampleBaseUrl(value, profileId) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`LLM example profile ${profileId} has an invalid baseUrl.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`LLM example profile ${profileId} baseUrl contains credentials, a query, or a fragment.`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`LLM example profile ${profileId} must use HTTPS unless it is loopback-only.`);
  }
  return loopback;
}

function validateRulePolicyExample(value, schema) {
  if (!isObject(value) || value.schemaVersion !== 1) {
    throw new Error('config/rule-policy.example.json must use schemaVersion 1.');
  }
  if (value.id !== undefined && (
    typeof value.id !== 'string'
    || value.id.length > 100
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.id)
  )) {
    throw new Error('Rule policy example has an invalid id.');
  }
  const knownRuleIds = new Set(schema.properties?.rules?.propertyNames?.enum ?? []);
  if (value.rules !== undefined) {
    if (!isObject(value.rules)) throw new Error('Rule policy example rules must be an object.');
    for (const [ruleId, override] of Object.entries(value.rules)) {
      if (!knownRuleIds.has(ruleId) || !isObject(override)) {
        throw new Error(`Rule policy example contains an unknown or invalid rule: ${ruleId}.`);
      }
      if (override.enabled !== undefined && typeof override.enabled !== 'boolean') {
        throw new Error(`Rule policy example ${ruleId}.enabled must be a boolean.`);
      }
      if (override.severity !== undefined && !['breaking', 'potentially-breaking', 'non-breaking', 'info'].includes(override.severity)) {
        throw new Error(`Rule policy example ${ruleId}.severity is invalid.`);
      }
    }
  }
  if (value.scoring !== undefined) {
    if (!isObject(value.scoring)) throw new Error('Rule policy example scoring must be an object.');
    for (const [severity, weight] of Object.entries(value.scoring)) {
      if (!['breaking', 'potentially-breaking', 'non-breaking', 'info'].includes(severity)
        || typeof weight !== 'number'
        || !Number.isFinite(weight)
        || weight < 0
        || weight > 100) {
        throw new Error(`Rule policy example scoring.${severity} is invalid.`);
      }
    }
  }
}
