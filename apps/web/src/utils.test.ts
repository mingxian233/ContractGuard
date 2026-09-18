import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterChanges,
  normalizeAiReview,
  normalizeAiStatus,
  normalizeAnalysis,
  normalizeAnalysisList,
  normalizeRules,
} from './utils.js'

describe('response normalization', () => {
  it('normalizes a wrapped analysis and derives missing summary values', () => {
    const analysis = normalizeAnalysis({
      analysis: {
        id: 'a-1',
        score: 72,
        changes: [
          { ruleId: 'PATH_REMOVED', severity: 'breaking', message: 'Path removed', path: '/pets' },
          { ruleId: 'DESC', severity: 'info', description: 'Description changed' },
        ],
      },
    })

    assert.equal(analysis.id, 'a-1')
    assert.deepEqual(
      { breaking: analysis.summary.breaking, info: analysis.summary.info, total: analysis.summary.total },
      { breaking: 1, info: 1, total: 2 },
    )
    assert.equal(analysis.compatible, false)
    assert.equal(analysis.changes[0]?.location, '/pets')
  })

  it('accepts list and rule response envelopes', () => {
    assert.equal(normalizeAnalysisList({ items: [{ id: 'x', score: 100 }] }).length, 1)
    const rule = normalizeRules({ rules: [{ id: 'R1', name: 'A rule', defaultSeverity: 'breaking' }] })[0]
    assert.deepEqual(
      { id: rule?.id, title: rule?.title, severity: rule?.severity },
      { id: 'R1', title: 'A rule', severity: 'breaking' },
    )
  })
})

describe('AI response normalization', () => {
  it('normalizes service status without trusting provider input', () => {
    assert.deepEqual(normalizeAiStatus({ enabled: true, configured: true, available: true, provider: 'other', model: 'deepseek-chat' }), {
      enabled: true,
      configured: true,
      available: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      reason: undefined,
    })
  })

  it('keeps structured report fields and supplies safe defaults', () => {
    const report = normalizeAiReview({
      schemaVersion: '1.0',
      analysisId: 'a-1',
      provider: 'deepseek',
      model: 'deepseek-chat',
      generatedAt: '2026-09-17T08:00:00.000Z',
      promptVersion: '2026-09-17',
      overview: { headline: '需要分阶段迁移', executiveSummary: '存在一个阻断风险。', riskLevel: 'high' },
      keyRisks: [{ changeId: 'c-1', title: '路径移除', affectedConsumers: ['Web'], priority: 'P0' }],
      migrationPlan: [{ order: 2, title: '提供兼容层', actions: ['恢复旧路径'], relatedChangeIds: ['c-1'] }],
      testSuggestions: [{ title: '契约回归', details: '验证旧客户端。', relatedChangeIds: ['c-1'] }],
      caveats: ['未读取运行时流量。'],
      usage: { totalTokens: 321 },
    })

    assert.equal(report.overview.riskLevel, 'high')
    assert.equal(report.keyRisks[0]?.priority, 'P0')
    assert.equal(report.keyRisks[0]?.explanation, '模型未提供进一步说明。')
    assert.deepEqual(report.migrationPlan[0]?.actions, ['恢复旧路径'])
    assert.equal(report.usage?.totalTokens, 321)
  })
})

describe('change filtering', () => {
  const changes = normalizeAnalysis({
    changes: [
      { id: '1', ruleId: 'PATH_REMOVED', severity: 'breaking', message: 'Removed operation', location: 'GET /users' },
      { id: '2', ruleId: 'INFO_CHANGED', severity: 'info', message: 'Updated title', location: 'info.title' },
    ],
  }).changes

  it('filters by severity and free text', () => {
    assert.equal(filterChanges(changes, 'breaking', '').length, 1)
    assert.deepEqual(filterChanges(changes, 'all', 'users'), [changes[0]])
    assert.equal(filterChanges(changes, 'info', 'removed').length, 0)
  })
})
