import type { StoredAnalysis } from './types.js';

type Change = StoredAnalysis['changes'][number];

export type ReportFormat = 'json' | 'markdown' | 'html';

export function renderReport(analysis: StoredAnalysis, format: ReportFormat): string {
  if (format === 'json') return `${JSON.stringify(analysis, null, 2)}\n`;
  if (format === 'markdown') return renderMarkdown(analysis);
  return renderHtml(analysis);
}

function renderMarkdown(analysis: StoredAnalysis): string {
  const lines = [
    `# ContractGuard compatibility report`,
    '',
    `- Analysis ID: \`${analysis.id}\``,
    `- Baseline: **${escapeMarkdown(analysis.baselineName)}**`,
    `- Candidate: **${escapeMarkdown(analysis.candidateName)}**`,
    `- Generated: ${analysis.createdAt}`,
    `- Compatibility score: **${analysis.score}/100**`,
    `- Backward compatible: **${analysis.compatible ? 'Yes' : 'No'}**`,
    '',
    '## Summary',
    '',
    '| Breaking | Potential | Non-breaking | Info | Total |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${analysis.summary.breaking} | ${analysis.summary.potentiallyBreaking} | ${analysis.summary.nonBreaking} | ${analysis.summary.info} | ${analysis.summary.total} |`,
    '',
    '## Changes',
    '',
  ];

  if (analysis.changes.length === 0) {
    lines.push('No contract changes were detected.', '');
  } else {
    for (const [index, change] of analysis.changes.entries()) {
      lines.push(
        `### ${index + 1}. [${change.severity}] ${escapeMarkdown(change.message)}`,
        '',
        `- Rule: \`${change.ruleId}\``,
        `- Location: \`${escapeCode(change.location)}\``,
      );
      appendValue(lines, 'Before', change.before);
      appendValue(lines, 'After', change.after);
      if (change.recommendation) lines.push(`- Recommendation: ${escapeMarkdown(change.recommendation)}`);
      lines.push('');
    }
  }

  lines.push(
    '---',
    '',
    '> This deterministic report identifies changes covered by the configured rule set. It is not a formal proof of compatibility; runtime behavior and external references still require testing.',
    '',
  );
  return lines.join('\n');
}

function appendValue(lines: string[], label: string, value: unknown): void {
  if (value === undefined) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  lines.push(`- ${label}: \`${escapeCode(text)}\``);
}

function renderHtml(analysis: StoredAnalysis): string {
  const rows = analysis.changes.map((change) => `
      <tr>
        <td><span class="badge ${severityClass(change)}">${html(change.severity)}</span></td>
        <td><code>${html(change.ruleId)}</code></td>
        <td><code>${html(change.location)}</code></td>
        <td>${html(change.message)}${change.recommendation ? `<small>${html(change.recommendation)}</small>` : ''}${evidenceHtml(change)}</td>
      </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ContractGuard report — ${html(analysis.candidateName)}</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#18202c;background:#f5f7fb;color-scheme:light}
    body{margin:0;padding:40px}.page{max-width:1100px;margin:auto}.header,.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 8px 30px #1e293b0a}.header{padding:30px}.eyebrow{color:#596579;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}h1{margin:8px 0 10px;font-size:30px}.meta{color:#596579}.score{display:flex;align-items:center;gap:18px;margin-top:24px}.number{font-size:48px;font-weight:800;color:${analysis.compatible ? '#087f5b' : '#c92a2a'}}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.metric{padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px}.metric strong{display:block;font-size:24px}.card{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px;border-bottom:1px solid #edf0f5;vertical-align:top}th{background:#f8fafc;font-size:12px;text-transform:uppercase;color:#596579}.badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}.breaking{color:#a51111;background:#fff0f0}.potential{color:#8a4b08;background:#fff6e6}.safe{color:#087f5b;background:#ebfbee}.info{color:#1554ad;background:#edf5ff}code{font-size:12px}small{display:block;color:#596579;margin-top:5px}.evidence{margin-top:9px}.evidence summary{cursor:pointer;color:#334155;font-size:12px}.evidence dl{display:grid;gap:8px;margin:8px 0 0}.evidence dt{font-weight:700;font-size:11px;color:#596579}.evidence dd{margin:2px 0 0}.evidence pre{max-width:520px;margin:0;padding:8px;border-radius:6px;background:#f8fafc;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.4 ui-monospace,monospace}.note{color:#596579;font-size:13px;margin-top:18px}@media(max-width:700px){body{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}th:nth-child(2),td:nth-child(2){display:none}}
  </style>
</head>
<body><main class="page">
  <section class="header"><div class="eyebrow">ContractGuard compatibility report</div><h1>${html(analysis.baselineName)} → ${html(analysis.candidateName)}</h1><div class="meta">${html(analysis.createdAt)} · ${html(analysis.id)}</div><div class="score"><div class="number">${analysis.score}</div><div><strong>/ 100</strong><br>${analysis.compatible ? 'No covered breaking changes detected' : 'Breaking changes detected'}</div></div></section>
  <section class="metrics"><div class="metric"><strong>${analysis.summary.breaking}</strong>Breaking</div><div class="metric"><strong>${analysis.summary.potentiallyBreaking}</strong>Potential</div><div class="metric"><strong>${analysis.summary.nonBreaking}</strong>Non-breaking</div><div class="metric"><strong>${analysis.summary.info}</strong>Info</div></section>
  <section class="card"><table><thead><tr><th>Severity</th><th>Rule</th><th>Location</th><th>Finding</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No contract changes were detected.</td></tr>'}</tbody></table></section>
  <p class="note">This deterministic report covers the configured static rules and is not a formal proof of compatibility. Runtime behavior and external references still require testing.</p>
</main></body></html>`;
}

function severityClass(change: Change): string {
  if (change.severity === 'breaking') return 'breaking';
  if (change.severity === 'potentially-breaking') return 'potential';
  if (change.severity === 'non-breaking') return 'safe';
  return 'info';
}

function evidenceHtml(change: Change): string {
  const entries: string[] = [];
  if (change.before !== undefined) entries.push(`<div><dt>Before</dt><dd><pre>${html(pretty(change.before))}</pre></dd></div>`);
  if (change.after !== undefined) entries.push(`<div><dt>After</dt><dd><pre>${html(pretty(change.after))}</pre></dd></div>`);
  return entries.length ? `<details class="evidence"><summary>Before / after evidence</summary><dl>${entries.join('')}</dl></details>` : '';
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function html(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1');
}

function escapeCode(value: string): string {
  return value.replace(/`/g, '\\`').replace(/\r?\n/g, ' ');
}
