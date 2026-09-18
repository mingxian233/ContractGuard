import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { analyzeCompatibility, ContractGuardError, ruleCatalog } from '@contractguard/core';
import { createDeepSeekAiService, type DeepSeekAiConfig } from './ai/deepseek.js';
import { AiServiceError, type AiReviewLanguage, type AiReviewService } from './ai/types.js';
import { renderReport, type ReportFormat } from './reports.js';
import { AnalysisStore } from './store.js';
import type { ApiErrorBody, StoredAnalysis } from './types.js';

export interface AppOptions {
  dataDirectory?: string;
  corsOrigin?: string;
  maxSpecBytes?: number;
  serveWeb?: boolean;
  aiService?: AiReviewService;
  aiFetch?: typeof globalThis.fetch;
  aiConfig?: Partial<DeepSeekAiConfig>;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const dataDirectory = options.dataDirectory ?? process.env.CONTRACTGUARD_DATA_DIR ?? './data/analyses';
  const maxSpecBytes = options.maxSpecBytes ?? numberFromEnv('CONTRACTGUARD_MAX_SPEC_BYTES', 5 * 1024 * 1024);
  const store = new AnalysisStore(dataDirectory);
  const allowedOrigins = corsOrigins(options.corsOrigin ?? process.env.CORS_ORIGIN);
  const aiService = options.aiService ?? createDeepSeekAiService({
    ...(options.aiFetch === undefined ? {} : { fetch: options.aiFetch }),
    ...(options.aiConfig === undefined ? {} : { config: options.aiConfig }),
  });

  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has('*') || allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }));
  app.use(express.json({ limit: maxSpecBytes * 2 + 64 * 1024 }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'contractguard-api', version: '1.0.0' });
  });

  app.get('/api/rules', (_request, response) => {
    response.json({ rules: ruleCatalog });
  });

  app.get('/api/ai/status', (_request, response) => {
    response.json(aiService.status());
  });

  app.get('/api/analyses', asyncHandler(async (_request, response) => {
    response.json({ analyses: await store.list() });
  }));

  app.get('/api/analyses/:id', asyncHandler(async (request, response) => {
    const analysis = await store.get(routeId(request.params.id));
    if (!analysis) throw httpError(404, 'ANALYSIS_NOT_FOUND', 'The requested analysis does not exist.');
    response.json(analysis);
  }));

  app.post('/api/analyses', asyncHandler(async (request, response) => {
    if (!isPlainObject(request.body)) {
      throw httpError(400, 'INVALID_REQUEST', 'The request body must be a JSON object. Set Content-Type to application/json.');
    }
    const { baseline, candidate, baselineName, candidateName } = request.body;
    validateSpecInput(baseline, 'baseline', maxSpecBytes);
    validateSpecInput(candidate, 'candidate', maxSpecBytes);
    validateName(baselineName, 'baselineName');
    validateName(candidateName, 'candidateName');

    const createdAt = new Date().toISOString();
    const result = analyzeCompatibility(baseline as string | Record<string, unknown>, candidate as string | Record<string, unknown>);
    const analysis: StoredAnalysis = {
      ...result,
      id: randomUUID(),
      baselineName: typeof baselineName === 'string' && baselineName.trim() ? baselineName.trim() : 'baseline.yaml',
      candidateName: typeof candidateName === 'string' && candidateName.trim() ? candidateName.trim() : 'candidate.yaml',
      createdAt,
    };
    await store.save(analysis);
    response.status(201).json(analysis);
  }));

  app.post('/api/analyses/:id/ai-review', asyncHandler(async (request, response) => {
    const analysis = await store.get(routeId(request.params.id));
    if (!analysis) throw httpError(404, 'ANALYSIS_NOT_FOUND', 'The requested analysis does not exist.');
    const aiRequest = validateAiReviewRequest(request.body);
    response.json(await aiService.review(analysis, aiRequest));
  }));

  app.get('/api/analyses/:id/report', asyncHandler(async (request, response) => {
    const format = String(request.query.format ?? 'json') as ReportFormat;
    if (!['json', 'markdown', 'html'].includes(format)) {
      throw httpError(400, 'INVALID_REPORT_FORMAT', 'Report format must be json, markdown, or html.');
    }
    const analysis = await store.get(routeId(request.params.id));
    if (!analysis) throw httpError(404, 'ANALYSIS_NOT_FOUND', 'The requested analysis does not exist.');
    const contentTypes: Record<ReportFormat, string> = {
      json: 'application/json; charset=utf-8',
      markdown: 'text/markdown; charset=utf-8',
      html: 'text/html; charset=utf-8',
    };
    const extensions: Record<ReportFormat, string> = { json: 'json', markdown: 'md', html: 'html' };
    response.setHeader('Content-Type', contentTypes[format]);
    response.setHeader('Content-Disposition', `attachment; filename="contractguard-${analysis.id}.${extensions[format]}"`);
    response.send(renderReport(analysis, format));
  }));

  app.delete('/api/analyses/:id', asyncHandler(async (request, response) => {
    if (!(await store.delete(routeId(request.params.id)))) {
      throw httpError(404, 'ANALYSIS_NOT_FOUND', 'The requested analysis does not exist.');
    }
    response.status(204).send();
  }));

  if (options.serveWeb !== false) {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const webDist = resolve(currentDirectory, '../../web/dist');
    if (existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(resolve(webDist, 'index.html')));
    }
  }

  app.use('/api', (_request, response) => {
    response.status(404).json(errorBody('ROUTE_NOT_FOUND', 'The requested API route does not exist.'));
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const normalized = normalizeError(error);
    if (normalized.status >= 500) console.error(error);
    response.status(normalized.status).json(errorBody(normalized.code, normalized.message, normalized.details));
  };
  app.use(errorHandler);

  return app;
}

function asyncHandler(handler: (request: express.Request, response: express.Response) => Promise<void>): RequestHandler {
  return (request, response, next) => void handler(request, response).catch(next);
}

function validateSpecInput(value: unknown, field: string, maxBytes: number): asserts value is string | Record<string, unknown> {
  if (typeof value !== 'string' && !isPlainObject(value)) {
    throw httpError(400, 'INVALID_REQUEST', `${field} must be an OpenAPI document encoded as YAML/JSON text or a JSON object.`);
  }
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (!serialized.trim()) throw httpError(400, 'INVALID_REQUEST', `${field} cannot be empty.`);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw httpError(413, 'SPEC_TOO_LARGE', `${field} exceeds the configured ${maxBytes}-byte limit.`);
  }
}

function routeId(value: string | string[] | undefined): string {
  if (typeof value !== 'string') throw httpError(400, 'INVALID_ANALYSIS_ID', 'Invalid analysis identifier.');
  return value;
}

function validateName(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.length > 200)) {
    throw httpError(400, 'INVALID_REQUEST', `${field} must be a string no longer than 200 characters.`);
  }
}

function validateAiReviewRequest(value: unknown): { language: AiReviewLanguage; focus?: string } {
  if (value === undefined) return { language: 'zh-CN' };
  if (!isPlainObject(value)) {
    throw httpError(400, 'INVALID_AI_REVIEW_REQUEST', 'The AI review request body must be a JSON object.');
  }
  const unexpected = Object.keys(value).find((key) => key !== 'language' && key !== 'focus');
  if (unexpected !== undefined) {
    throw httpError(400, 'INVALID_AI_REVIEW_REQUEST', `Unsupported AI review field: ${unexpected}.`);
  }
  const language = value.language ?? 'zh-CN';
  if (language !== 'zh-CN' && language !== 'en') {
    throw httpError(400, 'INVALID_AI_REVIEW_REQUEST', 'language must be zh-CN or en.');
  }
  if (value.focus !== undefined && (typeof value.focus !== 'string' || value.focus.length > 500)) {
    throw httpError(400, 'INVALID_AI_REVIEW_REQUEST', 'focus must be a string no longer than 500 characters.');
  }
  const focus = typeof value.focus === 'string' ? value.focus.trim() : undefined;
  return { language, ...(focus ? { focus } : {}) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpError(status: number, code: string, message: string, details?: unknown): Error {
  return Object.assign(new Error(message), { status, code, details });
}

function normalizeError(error: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'The request body is not valid JSON.' };
  }
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    return { status: 413, code: 'REQUEST_TOO_LARGE', message: 'The request body exceeds the configured size limit.' };
  }
  if (error instanceof ContractGuardError) {
    return { status: 400, code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
  }
  if (error instanceof AiServiceError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    const candidate = error as Error & { status?: number; code?: string; details?: unknown };
    const status = candidate.status && candidate.status >= 400 && candidate.status < 600 ? candidate.status : 500;
    if (status >= 500) {
      return { status, code: 'INTERNAL_ERROR', message: 'The server could not complete the request.' };
    }
    return {
      status,
      code: candidate.code ?? 'INVALID_OPENAPI_DOCUMENT',
      message: candidate.message || 'The request could not be processed.',
      ...(candidate.details === undefined ? {} : { details: candidate.details }),
    };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
}

function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

function numberFromEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function corsOrigins(configured: string | undefined): Set<string> {
  const value = configured ?? 'http://localhost:5173,http://127.0.0.1:5173';
  return new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean));
}
