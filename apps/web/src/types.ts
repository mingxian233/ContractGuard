export type Severity = 'breaking' | 'potentially-breaking' | 'non-breaking' | 'info'

export interface ChangeRecord {
  id: string
  ruleId: string
  severity: Severity
  category: string
  location: string
  message: string
  before?: unknown
  after?: unknown
  recommendation?: string
}

export interface AnalysisSummary {
  breaking: number
  potentiallyBreaking: number
  nonBreaking: number
  info: number
  total: number
}

export interface AnalysisRecord {
  id: string
  baselineName: string
  candidateName: string
  baselineVersion?: string
  candidateVersion?: string
  createdAt: string
  score: number
  compatible: boolean
  summary: AnalysisSummary
  changes: ChangeRecord[]
  engineVersion?: string
}

export interface RuleDefinition {
  id: string
  title: string
  description: string
  severity: Severity
  category?: string
  direction?: string
}

export type AiRiskLevel = 'critical' | 'high' | 'medium' | 'low'
export type AiRiskPriority = 'P0' | 'P1' | 'P2'

export interface AiProviderStatus {
  id: string
  displayName: string
  provider: string
  model: string
  enabled: boolean
  configured: boolean
  available: boolean
  local?: boolean
  reason?: string
}

export interface AiServiceStatus {
  enabled: boolean
  configured: boolean
  available: boolean
  provider: string
  model: string
  reason?: string
  activeProviderId?: string
  defaultProviderId?: string
  allowRequestProviderOverride: boolean
  providers: AiProviderStatus[]
  promptVersion?: string
}

export interface AiReportOverview {
  headline: string
  executiveSummary: string
  riskLevel: AiRiskLevel
}

export interface AiKeyRisk {
  changeId: string
  title: string
  explanation: string
  affectedConsumers: string[]
  remediation: string
  priority: AiRiskPriority
}

export interface AiMigrationStep {
  order: number
  title: string
  actions: string[]
  relatedChangeIds: string[]
}

export interface AiTestSuggestion {
  title: string
  details: string
  relatedChangeIds: string[]
}

export interface AiTokenUsage {
  promptTokens?: number
  completionTokens?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface AiReviewReport {
  schemaVersion: '1.0'
  analysisId: string
  provider: string
  providerId?: string
  providerLabel?: string
  model: string
  generatedAt: string
  promptVersion: string
  overview: AiReportOverview
  keyRisks: AiKeyRisk[]
  migrationPlan: AiMigrationStep[]
  testSuggestions: AiTestSuggestion[]
  caveats: string[]
  usage?: AiTokenUsage
}

export type ViewName = 'analyze' | 'history'
export type SeverityFilter = 'all' | Severity
export type ExportFormat = 'json' | 'markdown' | 'html'
