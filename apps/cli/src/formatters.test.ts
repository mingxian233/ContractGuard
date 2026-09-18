import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AnalysisResult } from '@contractguard/core';
import { formatResult } from './formatters.js';

const result: AnalysisResult = {
  engineVersion: '1.0.0',
  generatedAt: '2026-09-16T00:00:00.000Z',
  source: { old: { title: 'API', version: '1', openapi: '3.1.0' }, new: { title: 'API', version: '2', openapi: '3.1.0' } },
  score: 75,
  compatible: false,
  summary: { breaking: 1, potentiallyBreaking: 0, nonBreaking: 0, info: 0, total: 1 },
  changes: [{ id: '1', ruleId: 'operation.removed', severity: 'breaking', category: 'operation', location: 'GET /pets', message: 'Operation removed.', recommendation: 'Restore it.' }],
};

describe('CLI formatters', () => {
  it('formats a readable table', () => {
    const output = formatResult(result, 'table', { baseline: 'v1.yaml', candidate: 'v2.yaml' });
    assert.match(output, /Score 75\/100/);
    assert.match(output, /operation\.removed/);
  });

  it('formats JSON, Markdown, and standalone HTML', () => {
    assert.equal(JSON.parse(formatResult(result, 'json', { baseline: 'a', candidate: 'b' })).score, 75);
    assert.match(formatResult(result, 'markdown', { baseline: 'a', candidate: 'b' }), /# ContractGuard/);
    assert.match(formatResult(result, 'html', { baseline: 'a', candidate: 'b' }), /<!doctype html>/);
  });

  it('escapes terminal control sequences in table output', () => {
    const hostile = structuredClone(result);
    hostile.changes[0]!.message = 'unsafe\u001b]52;clipboard\u0007message';
    const output = formatResult(hostile, 'table', { baseline: 'a', candidate: 'b' });
    assert.doesNotMatch(output, /\u001b|\u0007/);
    assert.match(output, /\\x1b/);
  });
});
