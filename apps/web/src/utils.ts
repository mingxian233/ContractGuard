import type {
  AiKeyRisk,
  AiMigrationStep,
  AiProviderStatus,
  AiReportOverview,
  AiReviewReport,
  AiRiskLevel,
  AiRiskPriority,
  AiServiceStatus,
  AiTestSuggestion,
  AiTokenUsage,
  AnalysisRecord,
  AnalysisSummary,
  ChangeRecord,
  RuleDefinition,
  Severity,
} from './types.js'

const severityValues: Severity[] = ['breaking', 'potentially-breaking', 'non-breaking', 'info']

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && severityValues.includes(value as Severity)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isAiRiskLevel(value: unknown): value is AiRiskLevel {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
}

function isAiRiskPriority(value: unknown): value is AiRiskPriority {
  return value === 'P0' || value === 'P1' || value === 'P2'
}

export function normalizeChange(value: unknown, index = 0): ChangeRecord {
  const item = objectValue(value)
  const rawSeverity = item.severity
  const severity: Severity = isSeverity(rawSeverity) ? rawSeverity : 'info'

  return {
    id: stringValue(item.id, `${stringValue(item.ruleId, 'change')}-${index}`),
    ruleId: stringValue(item.ruleId, stringValue(item.rule, 'UNCLASSIFIED')),
    severity,
    category: stringValue(item.category, 'general'),
    location: stringValue(item.location, stringValue(item.path, 'OpenAPI document')),
    message: stringValue(item.message, stringValue(item.description, '检测到规范变化')),
    before: item.before,
    after: item.after,
    recommendation: stringValue(item.recommendation) || undefined,
  }
}

function summaryFromChanges(changes: ChangeRecord[]): AnalysisSummary {
  const summary: AnalysisSummary = {
    breaking: 0,
    potentiallyBreaking: 0,
    nonBreaking: 0,
    info: 0,
    total: changes.length,
  }

  for (const change of changes) {
    if (change.severity === 'potentially-breaking') summary.potentiallyBreaking += 1
    else if (change.severity === 'non-breaking') summary.nonBreaking += 1
    else summary[change.severity] += 1
  }

  return summary
}

export function normalizeAnalysis(value: unknown): AnalysisRecord {
  const outer = objectValue(value)
  const item = objectValue(outer.analysis ?? outer.result ?? value)
  const changes = Array.isArray(item.changes)
    ? item.changes.map((change, index) => normalizeChange(change, index))
    : []
  const derived = summaryFromChanges(changes)
  const rawSummary = objectValue(item.summary)
  const source = objectValue(item.source)
  const oldSource = objectValue(source.old)
  const newSource = objectValue(source.new)
  const summary: AnalysisSummary = {
    breaking: numberValue(rawSummary.breaking ?? derived.breaking),
    potentiallyBreaking: numberValue(
      rawSummary.potentiallyBreaking ?? rawSummary['potentially-breaking'] ?? derived.potentiallyBreaking,
    ),
    nonBreaking: numberValue(rawSummary.nonBreaking ?? rawSummary['non-breaking'] ?? derived.nonBreaking),
    info: numberValue(rawSummary.info ?? derived.info),
    total: numberValue(rawSummary.total) || changes.length,
  }
  const createdAt = stringValue(item.createdAt, stringValue(item.generatedAt, new Date().toISOString()))
  const score = Math.max(0, Math.min(100, numberValue(item.score)))

  return {
    id: stringValue(item.id, `analysis-${Date.parse(createdAt) || Date.now()}`),
    baselineName: stringValue(item.baselineName, stringValue(item.oldTitle, 'Baseline API')),
    candidateName: stringValue(item.candidateName, stringValue(item.newTitle, 'Candidate API')),
    baselineVersion:
      stringValue(item.baselineVersion, stringValue(item.oldVersion, stringValue(oldSource.version))) || undefined,
    candidateVersion:
      stringValue(item.candidateVersion, stringValue(item.newVersion, stringValue(newSource.version))) || undefined,
    createdAt,
    score,
    compatible: typeof item.compatible === 'boolean' ? item.compatible : summary.breaking === 0,
    summary,
    changes,
    engineVersion: stringValue(item.engineVersion) || undefined,
  }
}

export function normalizeAnalysisList(value: unknown): AnalysisRecord[] {
  if (Array.isArray(value)) return value.map(normalizeAnalysis)
  const outer = objectValue(value)
  const list = outer.analyses ?? outer.items ?? outer.data
  return Array.isArray(list) ? list.map(normalizeAnalysis) : []
}

export function normalizeRules(value: unknown): RuleDefinition[] {
  const outer = objectValue(value)
  const list = Array.isArray(value) ? value : outer.rules
  if (!Array.isArray(list)) return []

  return list.map((raw, index) => {
    const item = objectValue(raw)
    return {
      id: stringValue(item.id, `RULE-${index + 1}`),
      title: stringValue(item.title, stringValue(item.name, '兼容性规则')),
      description: stringValue(item.description, '用于判断 API 契约变化的影响。'),
      severity: isSeverity(item.severity)
        ? item.severity
        : isSeverity(item.defaultSeverity)
          ? item.defaultSeverity
          : 'info',
      category: stringValue(item.category) || undefined,
      direction: stringValue(item.direction) || undefined,
    }
  })
}

export function normalizeAiStatus(value: unknown): AiServiceStatus {
  const outer = objectValue(value)
  const item = objectValue(outer.status ?? outer.ai ?? value)
  const rawProviders = Array.isArray(item.providers) ? item.providers : []
  const providers = rawProviders
    .map((value): AiProviderStatus | null => {
      const provider = objectValue(value)
      const id = stringValue(provider.id, stringValue(provider.providerId)).trim()
      if (!id) return null
      const providerName = stringValue(provider.provider, id)
      return {
        id,
        displayName: stringValue(
          provider.displayName,
          stringValue(provider.label, providerName),
        ),
        provider: providerName,
        model: stringValue(provider.model),
        enabled: provider.enabled !== false,
        configured: provider.configured === true,
        available: provider.available === true,
        local: typeof provider.local === 'boolean' ? provider.local : undefined,
        reason: stringValue(provider.reason) || undefined,
      }
    })
    .filter((provider): provider is AiProviderStatus => provider !== null)
  const fallbackProvider = stringValue(item.provider, 'ai')
  const defaultProviderId = stringValue(
    item.defaultProviderId,
    stringValue(item.activeProviderId, stringValue(item.activeProfile, stringValue(item.providerId))),
  ) || undefined
  const activeProviderId =
    stringValue(item.activeProviderId, stringValue(item.activeProfile, defaultProviderId)) || undefined

  return {
    enabled: item.enabled === true,
    configured: item.configured === true,
    available: item.available === true,
    provider: fallbackProvider,
    model: stringValue(item.model),
    reason: stringValue(item.reason) || undefined,
    activeProviderId,
    defaultProviderId,
    allowRequestProviderOverride:
      item.allowRequestProviderOverride === true || item.allowRequestProfileOverride === true,
    providers,
    promptVersion: stringValue(item.promptVersion) || undefined,
  }
}

/**
 * Return only profiles the browser is allowed to request. When server-side
 * profile override is disabled, another configured profile must not become an
 * implicit fallback for an unavailable active profile.
 */
export function selectableAiProviders(status: AiServiceStatus): AiProviderStatus[] {
  const available = status.providers.filter(
    (provider) => provider.enabled && provider.configured && provider.available,
  )
  if (status.allowRequestProviderOverride) return available

  const activeProviderId = status.activeProviderId ?? status.defaultProviderId
  return activeProviderId === undefined
    ? []
    : available.filter((provider) => provider.id === activeProviderId)
}

function normalizeAiOverview(value: unknown): AiReportOverview {
  const item = objectValue(value)
  return {
    headline: stringValue(item.headline, 'AI 解读已生成'),
    executiveSummary: stringValue(item.executiveSummary, '本次解读未提供执行摘要。'),
    riskLevel: isAiRiskLevel(item.riskLevel) ? item.riskLevel : 'medium',
  }
}

function normalizeAiRisk(value: unknown, index: number): AiKeyRisk {
  const item = objectValue(value)
  return {
    changeId: stringValue(item.changeId, `risk-${index + 1}`),
    title: stringValue(item.title, `重点风险 ${index + 1}`),
    explanation: stringValue(item.explanation, '模型未提供进一步说明。'),
    affectedConsumers: stringArray(item.affectedConsumers),
    remediation: stringValue(item.remediation, '请结合确定性规则报告制定迁移措施。'),
    priority: isAiRiskPriority(item.priority) ? item.priority : 'P1',
  }
}

function normalizeAiMigrationStep(value: unknown, index: number): AiMigrationStep {
  const item = objectValue(value)
  return {
    order: optionalNumber(item.order) ?? index + 1,
    title: stringValue(item.title, `迁移步骤 ${index + 1}`),
    actions: stringArray(item.actions),
    relatedChangeIds: stringArray(item.relatedChangeIds),
  }
}

function normalizeAiTestSuggestion(value: unknown, index: number): AiTestSuggestion {
  const item = objectValue(value)
  return {
    title: stringValue(item.title, `测试建议 ${index + 1}`),
    details: stringValue(item.details, '请根据关联变更补充回归测试。'),
    relatedChangeIds: stringArray(item.relatedChangeIds),
  }
}

function normalizeAiUsage(value: unknown): AiTokenUsage | undefined {
  const item = objectValue(value)
  const usage: AiTokenUsage = {
    promptTokens: optionalNumber(item.promptTokens),
    completionTokens: optionalNumber(item.completionTokens),
    inputTokens: optionalNumber(item.inputTokens),
    outputTokens: optionalNumber(item.outputTokens),
    totalTokens: optionalNumber(item.totalTokens),
  }
  return Object.values(usage).some((count) => count !== undefined) ? usage : undefined
}

export function normalizeAiReview(value: unknown): AiReviewReport {
  const outer = objectValue(value)
  const item = objectValue(outer.report ?? outer.review ?? outer.result ?? value)
  const keyRisks = Array.isArray(item.keyRisks)
    ? item.keyRisks.map((risk, index) => normalizeAiRisk(risk, index))
    : []
  const migrationPlan = Array.isArray(item.migrationPlan)
    ? item.migrationPlan.map((step, index) => normalizeAiMigrationStep(step, index))
    : []
  const testSuggestions = Array.isArray(item.testSuggestions)
    ? item.testSuggestions.map((suggestion, index) => normalizeAiTestSuggestion(suggestion, index))
    : []

  return {
    schemaVersion: '1.0',
    analysisId: stringValue(item.analysisId),
    provider: stringValue(item.provider, 'ai'),
    providerId: stringValue(item.providerId) || undefined,
    providerLabel:
      stringValue(item.providerLabel, stringValue(item.displayName, stringValue(item.label))) || undefined,
    model: stringValue(item.model),
    generatedAt: stringValue(item.generatedAt, new Date().toISOString()),
    promptVersion: stringValue(item.promptVersion, 'unknown'),
    overview: normalizeAiOverview(item.overview),
    keyRisks,
    migrationPlan,
    testSuggestions,
    caveats: stringArray(item.caveats),
    usage: normalizeAiUsage(item.usage),
  }
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function prettyValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function filterChanges(
  changes: ChangeRecord[],
  severity: Severity | 'all',
  query: string,
): ChangeRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return changes.filter((change) => {
    if (severity !== 'all' && change.severity !== severity) return false
    if (!normalizedQuery) return true
    return [change.message, change.location, change.ruleId, change.category]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  })
}
