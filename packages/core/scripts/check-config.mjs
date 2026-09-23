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

const environmentEntries = new Map();
for (const [index, sourceLine] of (await read('.env.example')).split(/\r?\n/).entries()) {
  const line = sourceLine.trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) throw new Error(`.env.example:${index + 1} is not a KEY=value entry.`);
  if (environmentEntries.has(match[1])) throw new Error(`.env.example contains duplicate key ${match[1]}.`);
  environmentEntries.set(match[1], match[2]);
}

for (const required of ['PORT', 'HOST', 'CONTRACTGUARD_DATA_DIR', 'CONTRACTGUARD_AI_ENABLED', 'DEEPSEEK_API_KEY']) {
  if (!environmentEntries.has(required)) throw new Error(`.env.example is missing ${required}.`);
}

process.stdout.write(`Configuration examples OK: ${yamlChecks.length} YAML, 1 JSON, ${environmentEntries.size} environment entries.\n`);

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
