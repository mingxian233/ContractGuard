#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  analyzeCompatibility,
  ENGINE_VERSION,
  ruleCatalog,
  validateRulePolicy,
  type RulePolicy,
} from '@contractguard/core';
import { Command, InvalidArgumentError } from 'commander';
import { formatResult, terminalSafe, type OutputFormat } from './formatters.js';

type FailOn = 'breaking' | 'potentially-breaking' | 'never';

const program = new Command()
  .name('contractguard')
  .description('Detect backward-incompatible changes between two OpenAPI 3.x contracts.')
  .version(ENGINE_VERSION)
  .showHelpAfterError();

program.command('compare')
  .description('Compare a baseline OpenAPI contract with a candidate contract.')
  .argument('<baseline>', 'baseline OpenAPI YAML or JSON file')
  .argument('<candidate>', 'candidate OpenAPI YAML or JSON file')
  .option('-f, --format <format>', 'table, json, markdown, or html', parseFormat, 'table')
  .option('-o, --output <file>', 'write the report to a file instead of stdout')
  .option('--fail-on <level>', 'breaking, potentially-breaking, or never', parseFailOn, 'breaking')
  .option('--policy <file>', 'apply a ContractGuard rule policy JSON file')
  .action(async (
    baselinePath: string,
    candidatePath: string,
    options: { format: OutputFormat; output?: string; failOn: FailOn; policy?: string },
  ) => {
    try {
      const [baseline, candidate] = await Promise.all([
        readFile(resolve(baselinePath), 'utf8'),
        readFile(resolve(candidatePath), 'utf8'),
      ]);
      const policy = options.policy === undefined ? undefined : await readPolicy(options.policy);
      const result = analyzeCompatibility(baseline, candidate, policy === undefined ? {} : { policy });
      const rendered = formatResult(result, options.format, {
        baseline: basename(baselinePath),
        candidate: basename(candidatePath),
      });
      if (options.output) {
        const outputPath = resolve(options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, rendered, 'utf8');
        process.stderr.write(`Report written to ${terminalSafe(outputPath)}\n`);
      } else {
        process.stdout.write(rendered);
      }
      if (thresholdReached(result.summary, options.failOn)) process.exitCode = 2;
    } catch (error) {
      process.stderr.write(`ContractGuard error: ${terminalSafe(error instanceof Error ? error.message : String(error))}\n`);
      process.exitCode = 1;
    }
  });

program.command('rules')
  .description('Print the built-in compatibility rule catalog.')
  .option('--json', 'print machine-readable JSON')
  .action((options: { json?: boolean }) => {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(ruleCatalog, null, 2)}\n`);
      return;
    }
    for (const rule of ruleCatalog) process.stdout.write(`${rule.id.padEnd(34)} ${rule.defaultSeverity.padEnd(21)} ${rule.title}\n`);
  });

await program.parseAsync(process.argv);

function parseFormat(value: string): OutputFormat {
  if (['table', 'json', 'markdown', 'html'].includes(value)) return value as OutputFormat;
  throw new InvalidArgumentError('format must be table, json, markdown, or html');
}

function parseFailOn(value: string): FailOn {
  if (['breaking', 'potentially-breaking', 'never'].includes(value)) return value as FailOn;
  throw new InvalidArgumentError('level must be breaking, potentially-breaking, or never');
}

export function thresholdReached(summary: { breaking: number; potentiallyBreaking: number }, failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  if (failOn === 'potentially-breaking') return summary.breaking + summary.potentiallyBreaking > 0;
  return summary.breaking > 0;
}

async function readPolicy(path: string): Promise<RulePolicy> {
  const policyPath = resolve(path);
  const policyStats = await stat(policyPath);
  if (!policyStats.isFile()) throw new Error(`Rule policy is not a regular file: ${terminalSafe(policyPath)}`);
  if (policyStats.size > 64 * 1024) throw new Error('Rule policy exceeds the 65536-byte limit.');
  const contents = await readFile(policyPath, 'utf8');
  if (Buffer.byteLength(contents, 'utf8') > 64 * 1024) {
    throw new Error('Rule policy exceeds the 65536-byte limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Rule policy is not valid JSON: ${terminalSafe(policyPath)}`);
  }
  return validateRulePolicy(parsed);
}
