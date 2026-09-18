import type { StoredAnalysis } from '../types.js';

export type AiReviewLanguage = 'zh-CN' | 'en';
export type AiRiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type AiRiskPriority = 'P0' | 'P1' | 'P2';

export interface AiReviewRequest {
  language: AiReviewLanguage;
  focus?: string;
}

export interface AiReview {
  schemaVersion: '1.0';
  analysisId: string;
  provider: 'deepseek';
  model: string;
  generatedAt: string;
  promptVersion: 'ai-explainer-v1';
  overview: {
    headline: string;
    executiveSummary: string;
    riskLevel: AiRiskLevel;
  };
  keyRisks: Array<{
    changeId: string;
    title: string;
    explanation: string;
    affectedConsumers: string[];
    remediation: string;
    priority: AiRiskPriority;
  }>;
  migrationPlan: Array<{
    order: number;
    title: string;
    actions: string[];
    relatedChangeIds: string[];
  }>;
  testSuggestions: Array<{
    title: string;
    details: string;
    relatedChangeIds: string[];
  }>;
  caveats: string[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AiServiceStatus {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  provider: 'deepseek';
  model: string;
  promptVersion: 'ai-explainer-v1';
}

export interface AiReviewService {
  status(): AiServiceStatus;
  review(analysis: StoredAnalysis, request: AiReviewRequest): Promise<AiReview>;
}

export class AiServiceError extends Error {
  readonly status: 502 | 503 | 504;
  readonly code: string;

  constructor(status: 502 | 503 | 504, code: string, message: string) {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
    this.code = code;
  }
}
