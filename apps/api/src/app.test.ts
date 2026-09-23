import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { ENGINE_VERSION } from '@contractguard/core';
import { createApp } from './app.js';
import { AiConfigurationError, parseAiConfiguration, type AiRuntimeConfig } from './ai/config.js';
import { createMultiProviderAiService } from './ai/service.js';

const baseline = {
  openapi: '3.1.0',
  info: { title: 'Example', version: '1.0.0' },
  paths: {
    '/pets/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

const candidate = {
  ...baseline,
  info: { title: 'Example', version: '2.0.0' },
  paths: {},
};

const minimalAiReview = {
  overview: {
    headline: '检测到兼容性风险',
    executiveSummary: '发布前需要核对确定性分析结果。',
    riskLevel: 'high',
  },
  keyRisks: [],
  migrationPlan: [],
  testSuggestions: [],
  caveats: ['该说明不替代人工评审。'],
};

function multiProviderConfig(overrides: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    schemaVersion: 1,
    enabled: true,
    activeProfile: 'deepseek-cloud',
    allowRequestProfileOverride: true,
    defaults: {
      timeoutMs: 30_000,
      maxChanges: 50,
      maxOutputTokens: 8_192,
      maxResponseBytes: 128 * 1024,
    },
    profiles: [
      {
        id: 'deepseek-cloud',
        enabled: true,
        displayName: 'DeepSeek Cloud',
        provider: 'deepseek',
        adapter: 'openai-chat',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        auth: { type: 'bearer', secretEnv: 'TEST_DEEPSEEK_API_KEY' },
        capabilities: { structuredOutput: 'json-object', thinkingControl: 'disabled' },
        dataBoundary: 'deepseek-cloud',
      },
      {
        id: 'openai-cloud',
        enabled: true,
        displayName: 'OpenAI Cloud',
        provider: 'openai',
        adapter: 'openai-chat',
        baseUrl: 'https://api.openai.com/v1',
        model: 'test-openai-model',
        auth: { type: 'bearer', secretEnv: 'TEST_OPENAI_API_KEY' },
        capabilities: {
          structuredOutput: 'json-schema',
          thinkingControl: 'none',
          tokenLimitParameter: 'max_completion_tokens',
        },
        dataBoundary: 'openai-cloud',
      },
      {
        id: 'ollama-local',
        enabled: true,
        displayName: 'Ollama Local',
        provider: 'ollama',
        adapter: 'openai-chat',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'qwen-test',
        auth: { type: 'none' },
        capabilities: { structuredOutput: 'prompt-only', thinkingControl: 'none' },
        dataBoundary: 'local',
      },
    ],
    ...overrides,
  };
}

describe('ContractGuard API', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'contractguard-api-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports health and the rule catalog', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const health = await request(app).get('/api/health').expect(200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.version, ENGINE_VERSION);
    const rules = await request(app).get('/api/rules').expect(200);
    assert.ok(rules.body.rules.length > 5);
  });

  it('reports AI as disabled by default without exposing configuration secrets', async () => {
    const secret = 'test-key-never-return-this-value';
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiConfig: { apiKey: secret },
    });
    const response = await request(app).get('/api/ai/status').expect(200);
    assert.equal(response.body.enabled, false);
    assert.equal(response.body.configured, true);
    assert.equal(response.body.available, false);
    assert.equal(response.body.provider, 'deepseek');
    assert.equal(response.body.activeProfile, 'deepseek');
    assert.equal(response.body.defaultProviderId, 'deepseek');
    assert.equal(response.body.allowRequestProfileOverride, false);
    assert.deepEqual(response.body.providers, [{
      id: 'deepseek',
      label: 'DeepSeek',
      displayName: 'DeepSeek',
      provider: 'deepseek',
      model: 'deepseek-flash',
      enabled: true,
      configured: true,
      available: false,
      local: false,
    }]);
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(secret));
  });

  it('allows the local development origin without reflecting arbitrary origins', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
    const blocked = await request(app).get('/api/health').set('Origin', 'https://evil.example').expect(200);
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);
  });

  it('creates, retrieves, exports, lists, and deletes an analysis', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const created = await request(app)
      .post('/api/analyses')
      .send({ baseline, candidate, baselineName: 'v1.yaml', candidateName: 'v2.yaml' })
      .expect(201);

    assert.match(created.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(created.body.summary.breaking > 0);
    const id = created.body.id as string;

    const loaded = await request(app).get(`/api/analyses/${id}`).expect(200);
    assert.equal(loaded.body.id, id);
    const history = await request(app).get('/api/analyses').expect(200);
    assert.equal(history.body.analyses.length, 1);
    await request(app).get(`/api/analyses/${id}/report?format=markdown`).expect(200).expect('Content-Type', /markdown/);
    await request(app).delete(`/api/analyses/${id}`).expect(204);
    await request(app).get(`/api/analyses/${id}`).expect(404);
  });

  it('loads and applies a validated rule policy from CONTRACTGUARD_POLICY_CONFIG', async () => {
    const policyPath = join(directory, 'rule-policy.json');
    await writeFile(policyPath, JSON.stringify({
      schemaVersion: 1,
      id: 'api-test-policy',
      rules: { PATH_REMOVED: { enabled: false } },
    }), 'utf8');
    const previous = process.env.CONTRACTGUARD_POLICY_CONFIG;
    process.env.CONTRACTGUARD_POLICY_CONFIG = policyPath;
    let app;
    try {
      app = createApp({ dataDirectory: directory, serveWeb: false });
    } finally {
      if (previous === undefined) delete process.env.CONTRACTGUARD_POLICY_CONFIG;
      else process.env.CONTRACTGUARD_POLICY_CONFIG = previous;
    }
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    assert.equal(created.body.policy.id, 'api-test-policy');
    assert.equal(created.body.changes.some((change: { ruleId: string }) => change.ruleId === 'PATH_REMOVED'), false);
  });

  it('returns structured validation errors', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const response = await request(app).post('/api/analyses').send({ baseline: '', candidate }).expect(400);
    assert.equal(response.body.error.code, 'INVALID_REQUEST');
    const unsafeName = await request(app)
      .post('/api/analyses')
      .send({ baseline, candidate, baselineName: 'baseline\n# injected heading' })
      .expect(400);
    assert.equal(unsafeName.body.error.code, 'INVALID_REQUEST');
  });

  it('rejects malformed analysis identifiers before accessing storage', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const response = await request(app).get('/api/analyses/------------------------------------').expect(400);
    assert.equal(response.body.error.code, 'INVALID_ANALYSIS_ID');
  });

  it('returns 503 when AI review is disabled for a saved analysis', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false, aiConfig: { enabled: false } });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(503);
    assert.deepEqual(response.body, {
      error: { code: 'AI_DISABLED', message: 'AI review is disabled on this server.' },
    });
  });

  it('reports enabled-but-unconfigured AI and returns a safe 503 error', async () => {
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiConfig: { enabled: true, apiKey: '' },
    });
    const status = await request(app).get('/api/ai/status').expect(200);
    assert.equal(status.body.enabled, true);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.available, false);
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).expect(503);
    assert.equal(response.body.error.code, 'AI_NOT_CONFIGURED');
  });

  it('strictly validates LLM configuration and permits HTTP only for loopback profiles', () => {
    const valid = parseAiConfiguration({
      schemaVersion: 1,
      enabled: true,
      activeProfile: 'local',
      allowRequestProfileOverride: true,
      defaults: { timeoutMs: 30_000, maxChanges: 50, maxOutputTokens: 8_192, maxResponseBytes: 131_072 },
      profiles: {
        local: {
          enabled: true,
          displayName: 'Local',
          provider: 'lm-studio',
          adapter: 'openai-chat',
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'qwen-test',
          auth: { type: 'none' },
          capabilities: { structuredOutput: 'prompt-only', thinkingControl: 'none' },
          dataBoundary: 'local',
        },
      },
    });
    assert.equal(valid.profiles[0]?.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(valid.profiles[0]?.provider, 'lm-studio');

    const serialized = JSON.parse(JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      activeProfile: 'remote',
      allowRequestProfileOverride: true,
      defaults: { timeoutMs: 30_000, maxChanges: 50, maxOutputTokens: 8_192, maxResponseBytes: 131_072 },
      profiles: {
        remote: {
          enabled: true,
          displayName: 'Remote',
          provider: 'openai',
          adapter: 'openai-chat',
          baseUrl: 'http://api.example.com/v1',
          model: 'model',
          auth: { type: 'bearer', secretEnv: 'REMOTE_API_KEY' },
          capabilities: { structuredOutput: 'json-schema', thinkingControl: 'none' },
          dataBoundary: 'remote',
          apiKey: 'must-never-be-accepted',
        },
      },
    })) as unknown;
    assert.throws(() => parseAiConfiguration(serialized), AiConfigurationError);
    const remote = serialized as { profiles: { remote: Record<string, unknown> } };
    delete remote.profiles.remote.apiKey;
    assert.throws(() => parseAiConfiguration(remote), /HTTP is allowed only/i);
    remote.profiles.remote.baseUrl = 'https://10.0.0.1/v1';
    assert.throws(() => parseAiConfiguration(remote), /IP literal/i);
    remote.profiles.remote.baseUrl = 'https://api.openrouter.example/v1';
    remote.profiles.remote.provider = 'openrouter';
    assert.equal(parseAiConfiguration(remote).profiles[0]?.provider, 'openrouter');
  });

  it('loads a server-owned multi-provider JSON file and returns only redacted profile metadata', async () => {
    const configPath = join(directory, 'llm-providers.json');
    await writeFile(configPath, JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      activeProfile: 'openai-cloud',
      allowRequestProfileOverride: true,
      defaults: { timeoutMs: 30_000, maxChanges: 50, maxOutputTokens: 8_192, maxResponseBytes: 131_072 },
      profiles: {
        'openai-cloud': {
          enabled: true,
          displayName: 'OpenAI Cloud',
          provider: 'openai',
          adapter: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          model: 'test-model',
          auth: { type: 'bearer', secretEnv: 'OPENAI_TEST_SECRET' },
          capabilities: { structuredOutput: 'json-schema', thinkingControl: 'none' },
          dataBoundary: 'openai-cloud',
        },
      },
    }), 'utf8');
    const secret = 'never-return-profile-secret';
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiConfigPath: configPath,
      aiEnvironment: { OPENAI_TEST_SECRET: secret },
    });
    const status = await request(app).get('/api/ai/status').expect(200);
    assert.equal(status.body.activeProfile, 'openai-cloud');
    assert.equal(status.body.providers[0].configured, true);
    assert.equal(status.body.providers[0].available, true);
    assert.doesNotMatch(JSON.stringify(status.body), /never-return-profile-secret|api\.openai\.com|OPENAI_TEST_SECRET/);
  });

  it('selects only configured profiles and adapts structured output without accepting client URLs or models', async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(minimalAiReview) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiRuntimeConfig: multiProviderConfig(),
      aiEnvironment: {
        TEST_DEEPSEEK_API_KEY: 'deepseek-test-secret',
        TEST_OPENAI_API_KEY: 'openai-test-secret',
      },
      aiFetch: fakeFetch,
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const id = created.body.id as string;

    const openai = await request(app)
      .post(`/api/analyses/${id}/ai-review`)
      .send({ providerId: 'openai-cloud', language: 'en' })
      .expect(200);
    assert.equal(openai.body.provider, 'openai');
    assert.equal(openai.body.providerId, 'openai-cloud');
    assert.equal(openai.body.providerLabel, 'OpenAI Cloud');
    assert.equal(calls[0]?.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0]?.headers.get('authorization'), 'Bearer openai-test-secret');
    assert.equal((calls[0]?.body.response_format as { type: string }).type, 'json_schema');
    const responseFormat = calls[0]?.body.response_format as {
      json_schema: { strict: boolean; schema: Record<string, unknown> };
    };
    assert.equal(responseFormat.json_schema.strict, true);
    assert.equal(responseFormat.json_schema.schema.additionalProperties, false);
    assert.doesNotMatch(
      JSON.stringify(responseFormat.json_schema.schema),
      /maxLength|minLength|maxItems|minimum|maximum/,
    );
    assert.equal(calls[0]?.body.max_completion_tokens, 8_192);
    assert.equal(calls[0]?.body.max_tokens, undefined);
    assert.equal(calls[0]?.body.thinking, undefined);

    const ollama = await request(app)
      .post(`/api/analyses/${id}/ai-review`)
      .send({ providerId: 'ollama-local' })
      .expect(200);
    assert.equal(ollama.body.provider, 'ollama');
    assert.equal(calls[1]?.url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(calls[1]?.headers.get('authorization'), null);
    assert.equal(calls[1]?.body.max_tokens, 8_192);
    assert.equal(calls[1]?.body.max_completion_tokens, undefined);
    assert.equal(calls[1]?.body.response_format, undefined);
    assert.equal(calls[1]?.body.thinking, undefined);

    const unknown = await request(app)
      .post(`/api/analyses/${id}/ai-review`)
      .send({ providerId: 'attacker-profile' })
      .expect(400);
    assert.equal(unknown.body.error.code, 'AI_PROVIDER_NOT_FOUND');
    await request(app)
      .post(`/api/analyses/${id}/ai-review`)
      .send({ providerId: 'openai-cloud', baseUrl: 'https://attacker.example', model: 'attacker-model' })
      .expect(400);
    assert.equal(calls.length, 2);
  });

  it('does not permit profile override or silently fall back to another provider', async () => {
    let calls = 0;
    const failedFetch: typeof fetch = async () => {
      calls += 1;
      return new Response('unavailable', { status: 503 });
    };
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiRuntimeConfig: multiProviderConfig({ allowRequestProfileOverride: false }),
      aiEnvironment: {
        TEST_DEEPSEEK_API_KEY: 'deepseek-test-secret',
        TEST_OPENAI_API_KEY: 'openai-test-secret',
      },
      aiFetch: failedFetch,
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const blocked = await request(app)
      .post(`/api/analyses/${created.body.id as string}/ai-review`)
      .send({ providerId: 'openai-cloud' })
      .expect(400);
    assert.equal(blocked.body.error.code, 'AI_PROVIDER_OVERRIDE_DISABLED');
    assert.equal(calls, 0);

    const failed = await request(app)
      .post(`/api/analyses/${created.body.id as string}/ai-review`)
      .send({})
      .expect(502);
    assert.equal(failed.body.error.code, 'AI_UPSTREAM_ERROR');
    assert.equal(calls, 1);
  });

  it('generates and validates a DeepSeek explanation without sending raw specifications', async () => {
    const secret = 'test-key-secret';
    let expectedChangeId = '';
    let capturedUrl = '';
    let capturedRequest: Record<string, unknown> | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${secret}`);
      const generated = {
        overview: {
          headline: '检测到破坏性变更',
          executiveSummary: '候选版本删除了现有接口，发布前需要迁移调用方。',
          riskLevel: 'critical',
        },
        keyRisks: [{
          changeId: expectedChangeId,
          title: '接口删除',
          explanation: '现有调用方将无法继续调用该接口。',
          affectedConsumers: ['仍在调用旧接口的客户端'],
          remediation: '保留旧接口并提供迁移期。',
          priority: 'P0',
        }],
        migrationPlan: [{
          order: 1,
          title: '盘点调用方',
          actions: ['检索旧接口调用并确认负责人'],
          relatedChangeIds: [expectedChangeId],
        }],
        testSuggestions: [{
          title: '旧客户端回归测试',
          details: '验证旧客户端在迁移窗口内仍可使用。',
          relatedChangeIds: [expectedChangeId],
        }],
        caveats: ['分析结果不包含运行时流量信息。'],
      };
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(generated) } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: fakeFetch,
      aiConfig: {
        enabled: true,
        apiKey: secret,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        maxChanges: 10,
      },
    });
    const created = await request(app).post('/api/analyses').send({
      baseline: { ...baseline, 'x-raw-only-secret': 'DO_NOT_SEND_RAW_SPEC' },
      candidate,
      baselineName: 'v1.yaml',
      candidateName: 'v2.yaml',
    }).expect(201);
    expectedChangeId = created.body.changes[0].id as string;

    const response = await request(app)
      .post(`/api/analyses/${created.body.id as string}/ai-review`)
      .send({ language: 'zh-CN', focus: '突出迁移风险' })
      .expect(200);

    assert.equal(capturedUrl, 'https://api.deepseek.com/chat/completions');
    assert.equal(capturedRequest?.model, 'deepseek-flash');
    assert.deepEqual(capturedRequest?.thinking, { type: 'disabled' });
    assert.deepEqual(capturedRequest?.response_format, { type: 'json_object' });
    assert.equal(capturedRequest?.max_tokens, 8_192);
    assert.doesNotMatch(JSON.stringify(capturedRequest), /DO_NOT_SEND_RAW_SPEC|test-key-secret/);
    assert.equal(response.body.schemaVersion, '1.0');
    assert.equal(response.body.analysisId, created.body.id);
    assert.equal(response.body.keyRisks[0].changeId, expectedChangeId);
    assert.deepEqual(response.body.usage, { promptTokens: 120, completionTokens: 80, totalTokens: 200 });
  });

  it('accepts a complete JSON review wrapped in a Markdown JSON fence', async () => {
    const fencedFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: `\uFEFF\n\`\`\`json\n${JSON.stringify(minimalAiReview)}\n\`\`\`` },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: fencedFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(200);
    assert.equal(response.body.overview.headline, minimalAiReview.overview.headline);
    assert.deepEqual(response.body.caveats, minimalAiReview.caveats);
  });

  it('recovers a valid review when DeepSeek surrounds the JSON with brief prose', async () => {
    const proseFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: `Here is the requested review:\n${JSON.stringify(minimalAiReview)}\nEnd of review.` },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: proseFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(200);
    assert.equal(response.body.overview.headline, minimalAiReview.overview.headline);
  });

  it('skips unrelated JSON in surrounding prose and selects the schema-valid review', async () => {
    const proseFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: `Metadata: {"source":"deepseek"}\n${JSON.stringify(minimalAiReview)}` },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: proseFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(200);
    assert.equal(response.body.overview.headline, minimalAiReview.overview.headline);
  });

  it('rejects an ambiguous response containing multiple schema-valid reviews', async () => {
    const ambiguousFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: `${JSON.stringify(minimalAiReview)}\n${JSON.stringify({
        ...minimalAiReview,
        overview: { ...minimalAiReview.overview, headline: 'Second review' },
      })}` } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: ambiguousFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(502);
    assert.equal(response.body.error.code, 'AI_INVALID_RESPONSE');
    assert.match(response.body.error.message, /multiple valid JSON review objects/i);
  });

  it('normalizes singleton strings returned for list-valued AI review fields', async () => {
    let expectedChangeId = '';
    const singletonFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({
          overview: minimalAiReview.overview,
          keyRisks: [{
            changeId: expectedChangeId,
            title: '接口删除',
            explanation: '旧调用方会受到影响。',
            affectedConsumers: '仍使用旧接口的客户端',
            remediation: '提供迁移窗口。',
            priority: 'P0',
          }],
          migrationPlan: [{
            order: 1,
            title: '迁移调用方',
            actions: '盘点并升级旧客户端',
            relatedChangeIds: expectedChangeId,
          }],
          testSuggestions: [{
            title: '回归测试',
            details: '验证旧客户端迁移路径。',
            relatedChangeIds: expectedChangeId,
          }],
          caveats: '未获得运行时流量数据。',
        }) },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: singletonFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    expectedChangeId = created.body.changes[0].id as string;
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(200);
    assert.deepEqual(response.body.keyRisks[0].affectedConsumers, ['仍使用旧接口的客户端']);
    assert.deepEqual(response.body.migrationPlan[0].actions, ['盘点并升级旧客户端']);
    assert.deepEqual(response.body.migrationPlan[0].relatedChangeIds, [expectedChangeId]);
    assert.deepEqual(response.body.testSuggestions[0].relatedChangeIds, [expectedChangeId]);
    assert.deepEqual(response.body.caveats, ['未获得运行时流量数据。']);
  });

  it('safely truncates overlong AI-generated lists instead of failing the entire review', async () => {
    let expectedChangeId = '';
    const overlongFetch: typeof fetch = async () => {
      const risk = {
        changeId: expectedChangeId,
        title: '接口删除',
        explanation: '旧调用方会受到影响。',
        affectedConsumers: Array.from({ length: 25 }, (_, index) => `consumer-${index}`),
        remediation: '提供迁移窗口。',
        priority: 'P0',
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          ...minimalAiReview,
          keyRisks: Array.from({ length: 10 }, () => risk),
          caveats: Array.from({ length: 10 }, (_, index) => `caveat-${index}`),
        }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: overlongFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    expectedChangeId = created.body.changes[0].id as string;
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(200);
    assert.equal(response.body.keyRisks.length, 8);
    assert.equal(response.body.keyRisks[0].affectedConsumers.length, 20);
    assert.equal(response.body.caveats.length, 6);
  });

  it('reports a truncated DeepSeek JSON response using finish_reason', async () => {
    const truncatedFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { content: JSON.stringify(minimalAiReview) },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: truncatedFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(502);
    assert.equal(response.body.error.code, 'AI_INVALID_RESPONSE');
    assert.match(response.body.error.message, /truncated the JSON review/i);
  });

  it('rejects malformed or ungrounded DeepSeek output as an upstream error', async () => {
    const invalidFetch: typeof fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        overview: { headline: 'Risk', executiveSummary: 'Summary', riskLevel: 'high' },
        keyRisks: [{
          changeId: 'CG-9999',
          title: 'Invented',
          explanation: 'Not grounded',
          affectedConsumers: [],
          remediation: 'None',
          priority: 'P0',
        }],
        migrationPlan: [],
        testSuggestions: [],
        caveats: [],
      }) } }],
    }), { status: 200 });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: invalidFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({ language: 'en' }).expect(502);
    assert.equal(response.body.error.code, 'AI_INVALID_RESPONSE');
  });

  it('does not expose the API key or upstream response body when DeepSeek fails', async () => {
    const secret = 'test-key-upstream-private';
    const failedFetch: typeof fetch = async () => new Response(JSON.stringify({
      error: { message: `authorization failed for ${secret}` },
    }), { status: 429 });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: failedFetch,
      aiConfig: { enabled: true, apiKey: secret },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(502);
    assert.equal(response.body.error.code, 'AI_UPSTREAM_ERROR');
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(response.body), /authorization failed/i);
  });

  it('rejects an oversized DeepSeek response before parsing it', async () => {
    const oversizedFetch: typeof fetch = async () => new Response('x'.repeat(129 * 1024), { status: 200 });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: oversizedFetch,
      aiConfig: { enabled: true, apiKey: 'test-key' },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(502);
    assert.equal(response.body.error.code, 'AI_INVALID_RESPONSE');
    assert.match(response.body.error.message, /oversized response/i);
  });

  it('returns 504 when the DeepSeek request exceeds the configured timeout', async () => {
    const hangingFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: hangingFetch,
      aiConfig: { enabled: true, apiKey: 'test-key', timeoutMs: 5 },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(504);
    assert.equal(response.body.error.code, 'AI_UPSTREAM_TIMEOUT');
  });

  it('keeps the timeout active while reading a stalled DeepSeek response body', async () => {
    const stalledBodyFetch: typeof fetch = async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = (): void => controller.error(new DOMException('aborted', 'AbortError'));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiFetch: stalledBodyFetch,
      aiConfig: { enabled: true, apiKey: 'test-key', timeoutMs: 5 },
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const response = await request(app).post(`/api/analyses/${created.body.id as string}/ai-review`).send({}).expect(504);
    assert.equal(response.body.error.code, 'AI_UPSTREAM_TIMEOUT');
  });

  it('propagates caller cancellation to the upstream LLM request', async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let upstreamAborted = false;
    const hangingFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      notifyStarted();
      const abort = (): void => {
        upstreamAborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    });
    const analysisApp = createApp({ dataDirectory: directory, serveWeb: false });
    const created = await request(analysisApp).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const service = createMultiProviderAiService({
      config: multiProviderConfig(),
      environment: { TEST_DEEPSEEK_API_KEY: 'test-key' },
      fetch: hangingFetch,
    });
    const controller = new AbortController();
    const pending = service.review(
      created.body,
      { language: 'zh-CN' },
      { signal: controller.signal },
    );
    await started;
    controller.abort();
    await assert.rejects(pending, (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'AI_REQUEST_CANCELLED');
      assert.equal((error as { status?: number }).status, 499);
      return true;
    });
    assert.equal(upstreamAborted, true);
  });

  it('cancels the upstream LLM request when the HTTP client disconnects', async () => {
    let notifyStarted!: () => void;
    let notifyAborted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const aborted = new Promise<void>((resolve) => { notifyAborted = resolve; });
    const hangingFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      notifyStarted();
      const abort = (): void => {
        notifyAborted();
        reject(new DOMException('aborted', 'AbortError'));
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    });
    const app = createApp({
      dataDirectory: directory,
      serveWeb: false,
      aiRuntimeConfig: multiProviderConfig(),
      aiEnvironment: { TEST_DEEPSEEK_API_KEY: 'test-key' },
      aiFetch: hangingFetch,
    });
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Could not determine test server port.');
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${address.port}/api/analyses/${created.body.id as string}/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      await started;
      controller.abort();
      await assert.rejects(pending, (error: unknown) => (error as { name?: string }).name === 'AbortError');
      await aborted;
    } finally {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
  });

  it('validates AI review input and requires a saved analysis', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const missingId = '00000000-0000-4000-8000-000000000000';
    await request(app).post(`/api/analyses/${missingId}/ai-review`).send({}).expect(404);
    const created = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(201);
    const invalid = await request(app)
      .post(`/api/analyses/${created.body.id as string}/ai-review`)
      .send({ language: 'fr', focus: 'x'.repeat(501) })
      .expect(400);
    assert.equal(invalid.body.error.code, 'INVALID_AI_REVIEW_REQUEST');
  });

  it('rejects a non-JSON body as a client error', async () => {
    const app = createApp({ dataDirectory: directory, serveWeb: false });
    const response = await request(app).post('/api/analyses').set('Content-Type', 'text/plain').send('hello').expect(400);
    assert.equal(response.body.error.code, 'INVALID_REQUEST');
  });

  it('does not expose filesystem details for an internal storage error', async () => {
    const blockedPath = join(directory, 'not-a-directory');
    await writeFile(blockedPath, 'occupied', 'utf8');
    const app = createApp({ dataDirectory: blockedPath, serveWeb: false });
    const response = await request(app).post('/api/analyses').send({ baseline, candidate }).expect(500);
    assert.deepEqual(response.body, { error: { code: 'INTERNAL_ERROR', message: 'The server could not complete the request.' } });
    assert.doesNotMatch(JSON.stringify(response.body), /not-a-directory|EEXIST/i);
  });
});
