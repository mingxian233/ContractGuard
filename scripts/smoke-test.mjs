import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../apps/api/dist/app.js';

const dataDirectory = await mkdtemp(join(tmpdir(), 'contractguard-smoke-'));
const server = createApp({ dataDirectory, serveWeb: true }).listen(0, '127.0.0.1');

try {
  await new Promise((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine smoke-test port.');
  const health = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
  const web = await fetch(`http://127.0.0.1:${address.port}/`);
  if (!web.ok || !(await web.text()).includes('ContractGuard')) throw new Error('Web application was not served.');
  const manifest = JSON.parse(await readFile(resolve('fixtures/evaluation-manifest.json'), 'utf8'));
  const results = [];
  for (const evaluationCase of manifest.cases) {
    const [baseline, candidate] = await Promise.all([
      readFile(resolve('fixtures', evaluationCase.baseline), 'utf8'),
      readFile(resolve('fixtures', evaluationCase.candidate), 'utf8'),
    ]);
    const created = await fetch(`http://127.0.0.1:${address.port}/api/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseline, candidate, baselineName: evaluationCase.baseline, candidateName: evaluationCase.candidate }),
    });
    if (created.status !== 201) throw new Error(`Analysis creation failed for ${evaluationCase.id}: ${created.status} ${await created.text()}`);
    const analysis = await created.json();
    if (analysis.compatible !== evaluationCase.expectedCompatible) {
      throw new Error(`${evaluationCase.id}: expected compatible=${evaluationCase.expectedCompatible}, received ${analysis.compatible}.`);
    }
    for (const severity of evaluationCase.forbiddenSeverities ?? []) {
      if (analysis.changes.some((change) => change.severity === severity)) throw new Error(`${evaluationCase.id}: forbidden severity ${severity} was emitted.`);
    }
    for (const expected of evaluationCase.mustContain ?? []) {
      const matched = analysis.changes.some((change) => change.ruleId === expected.ruleId
        && change.severity === expected.severity
        && change.location.includes(expected.locationContains));
      if (!matched) throw new Error(`${evaluationCase.id}: expected ${expected.ruleId} at a location containing ${expected.locationContains}.`);
    }
    results.push({ caseId: evaluationCase.id, analysis });
  }
  const breaking = results.find((result) => result.caseId === 'petstore-breaking')?.analysis;
  if (!breaking) throw new Error('The breaking smoke-test case was not executed.');
  const report = await fetch(`http://127.0.0.1:${address.port}/api/analyses/${breaking.id}/report?format=html`);
  const reportHtml = await report.text();
  if (!report.ok || !reportHtml.includes('ContractGuard report') || !reportHtml.includes('Before / after evidence')) {
    throw new Error('HTML report export did not include the expected report and evidence.');
  }
  process.stdout.write(`Smoke test passed: ${results.length} manifest cases; breaking fixture has ${breaking.summary.breaking} breaking change(s), score ${breaking.score}.\n`);
} finally {
  await new Promise((resolveClosed) => server.close(resolveClosed));
  await rm(dataDirectory, { recursive: true, force: true });
}
