import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AnalysisSummary, StoredAnalysis } from './types.js';

const SAFE_ID = /^[0-9a-f-]{36}$/i;

export class AnalysisStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async save(analysis: StoredAnalysis): Promise<void> {
    await this.initialize();
    this.assertSafeId(analysis.id);
    const target = this.pathFor(analysis.id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }

  async get(id: string): Promise<StoredAnalysis | null> {
    this.assertSafeId(id);
    try {
      return JSON.parse(await readFile(this.pathFor(id), 'utf8')) as StoredAnalysis;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async list(): Promise<AnalysisSummary[]> {
    await this.initialize();
    const entries = (await readdir(this.directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'));

    const analyses = await Promise.all(entries.map(async (entry) => {
      try {
        return JSON.parse(await readFile(join(this.directory, entry.name), 'utf8')) as StoredAnalysis;
      } catch {
        return null;
      }
    }));

    return analyses
      .filter((value): value is StoredAnalysis => value !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ id, baselineName, candidateName, createdAt, score, compatible, summary }) => ({
        id,
        baselineName,
        candidateName,
        createdAt,
        score,
        compatible,
        summary,
      }));
  }

  async delete(id: string): Promise<boolean> {
    this.assertSafeId(id);
    try {
      await rm(this.pathFor(id));
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  private pathFor(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  private assertSafeId(id: string): void {
    if (!SAFE_ID.test(id)) {
      const error = new Error('Invalid analysis identifier.');
      Object.assign(error, { status: 400, code: 'INVALID_ANALYSIS_ID' });
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
