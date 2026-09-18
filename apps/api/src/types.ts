import type { AnalysisResult } from '@contractguard/core';

export interface StoredAnalysis extends AnalysisResult {
  id: string;
  baselineName: string;
  candidateName: string;
  createdAt: string;
}

export interface AnalysisSummary {
  id: string;
  baselineName: string;
  candidateName: string;
  createdAt: string;
  score: number;
  compatible: boolean;
  summary: StoredAnalysis['summary'];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
