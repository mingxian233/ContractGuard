export { analyzeCompatibility, ENGINE_VERSION } from "./analyze.js";
export { ContractGuardError, type ContractGuardErrorCode } from "./errors.js";
export { parseOpenApi, resolveLocalRef, resolveNode } from "./parser.js";
export { getRule, ruleCatalog } from "./rules.js";
export type {
  AnalysisResult,
  AnalyzeOptions,
  Change,
  ChangeCategory,
  ChangeSummary,
  OpenApiDocument,
  OpenApiInput,
  ParsedOpenApi,
  RuleDefinition,
  Severity,
  SourceDescription,
} from "./types.js";
