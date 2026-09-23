import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterChanges,
  normalizeAiReview,
  normalizeAiStatus,
  normalizeAnalysis,
  normalizeAnalysisList,
  normalizeRules,
  selectableAiProviders,
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
  it('keeps the legacy single-provider service status compatible', () => {
    assert.deepEqual(normalizeAiStatus({ enabled: true, configured: true, available: true, provider: 'deepseek', model: 'deepseek-chat' }), {
      enabled: true,
      configured: true,
      available: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      reason: undefined,
      activeProviderId: undefined,
      defaultProviderId: undefined,
      allowRequestProviderOverride: false,
      providers: [],
      promptVersion: undefined,
    })
  })

  it('normalizes selectable multi-provider status and both provider label aliases', () => {
    const status = normalizeAiStatus({
      enabled: true,
      configured: true,
      available: true,
      provider: 'openai',
      model: 'gpt-example',
      activeProfile: 'openai-cloud',
      defaultProviderId: 'deepseek-cloud',
      allowRequestProviderOverride: true,
      providers: [
        {
          id: 'deepseek-cloud',
          label: 'DeepSeek Cloud',
          provider: 'deepseek',
          model: 'deepseek-chat',
          configured: true,
          available: true,
        },
        {
          id: 'openai-cloud',
          displayName: 'OpenAI Cloud',
          provider: 'openai',
          model: 'gpt-example',
          configured: true,
          available: false,
          local: false,
        },
      ],
    })

    assert.equal(status.activeProviderId, 'openai-cloud')
    assert.equal(status.defaultProviderId, 'deepseek-cloud')
    assert.equal(status.allowRequestProviderOverride, true)
    assert.deepEqual(
      status.providers.map(({ id, displayName, provider, available }) => ({ id, displayName, provider, available })),
      [
        { id: 'deepseek-cloud', displayName: 'DeepSeek Cloud', provider: 'deepseek', available: true },
        { id: 'openai-cloud', displayName: 'OpenAI Cloud', provider: 'openai', available: false },
      ],
    )
  })

  it('does not use another provider as an implicit fallback when override is disabled', () => {
    const status = normalizeAiStatus({
      enabled: true,
      configured: false,
      available: false,
      activeProviderId: 'deepseek-cloud',
      allowRequestProfileOverride: false,
      providers: [
        {
          id: 'deepseek-cloud',
          displayName: 'DeepSeek',
          provider: 'deepseek',
          model: 'deepseek-flash',
          enabled: true,
          configured: false,
          available: false,
        },
        {
          id: 'ollama-local',
          displayName: 'Ollama',
          provider: 'ollama',
          model: 'local-model',
          enabled: true,
          configured: true,
          available: true,
        },
      ],
    })

    assert.deepEqual(selectableAiProviders(status), [])
    status.allowRequestProviderOverride = true
    assert.deepEqual(selectableAiProviders(status).map((provider) => provider.id), ['ollama-local'])
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
    assert.equal(report.provider, 'deepseek')
    assert.equal(report.keyRisks[0]?.priority, 'P0')
    assert.equal(report.keyRisks[0]?.explanation, '模型未提供进一步说明。')
    assert.deepEqual(report.migrationPlan[0]?.actions, ['恢复旧路径'])
    assert.equal(report.usage?.totalTokens, 321)
  })

  it('keeps the selected provider identity in a generated report', () => {
    const report = normalizeAiReview({
      analysisId: 'a-2',
      provider: 'ollama',
      providerId: 'ollama-local',
      label: 'Ollama 本地模型',
      model: 'qwen3:8b',
      overview: {},
    })

    assert.equal(report.provider, 'ollama')
    assert.equal(report.providerId, 'ollama-local')
    assert.equal(report.providerLabel, 'Ollama 本地模型')
    assert.equal(report.model, 'qwen3:8b')
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
