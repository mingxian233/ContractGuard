/** Severity is ordered from release-blocking to informational. */
export type Severity =
  | "breaking"
  | "potentially-breaking"
  | "non-breaking"
  | "info";

export type ChangeCategory =
  | "path"
  | "operation"
  | "parameter"
  | "request-body"
  | "response"
  | "schema"
  | "security"
  | "metadata";

export interface Change {
  /** Stable within a deterministic analysis result, e.g. CG-0001. */
  id: string;
  ruleId: string;
  severity: Severity;
  category: ChangeCategory;
  /** JSONPath-like location intended for both people and tooling. */
  location: string;
  message: string;
  before?: unknown;
  after?: unknown;
  recommendation?: string;
}

export interface ChangeSummary {
  total: number;
  breaking: number;
  potentiallyBreaking: number;
  nonBreaking: number;
  info: number;
}

export interface SourceDescription {
  title?: string;
  version?: string;
  openapi: string;
}

export interface AnalysisResult {
  engineVersion: string;
  generatedAt: string;
  source: {
    old: SourceDescription;
    new: SourceDescription;
  };
  /** Heuristic 0-100 release-risk indicator, not a formal proof. */
  score: number;
  /** True only when no definitely breaking change was found. */
  compatible: boolean;
  summary: ChangeSummary;
  changes: Change[];
}

export interface AnalyzeOptions {
  /** Makes fixtures and snapshots reproducible. Defaults to the current time. */
  generatedAt?: string | Date;
  /** Include non-breaking additions and relaxations. Defaults to true. */
  includeNonBreaking?: boolean;
  /** Include metadata-only changes. Defaults to true. */
  includeInfo?: boolean;
}

export interface RuleDefinition {
  id: string;
  title: string;
  category: ChangeCategory;
  defaultSeverity: Severity;
  description: string;
}

export interface OpenApiDocument {
  openapi: string;
  info?: {
    title?: string;
    version?: string;
    [key: string]: unknown;
  };
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
  security?: unknown[];
  servers?: unknown[];
  [key: string]: unknown;
}

export type OpenApiInput = string | Uint8Array | OpenApiDocument | Record<string, unknown>;

export interface ParsedOpenApi {
  document: OpenApiDocument;
  format: "json" | "yaml" | "object";
}
