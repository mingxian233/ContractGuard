# REST API Reference

## 概览

- 默认地址：`http://localhost:8080`
- API 前缀：`/api`
- 请求/响应编码：UTF-8
- 创建分析和 AI 解读时的 Content-Type：`application/json`
- 身份认证：本地版本未提供；默认仅限本机使用，不要直接暴露到不可信公网

API 接受 OpenAPI YAML/JSON **文本**或已经解析的 JSON **对象**。浏览器选择本地文件后由前端读取文本，再作为 JSON 请求发送；当前接口不接受 `multipart/form-data` 上传。

AI 报告解释器是默认关闭的可选服务器端集成。它只解释既有确定性 finding，不改变严重等级、得分、`compatible` 或任何 CLI/CI 结果。启用 AI 后尤其需要在公网入口增加鉴权和限流，以防第三方滥用用户的 DeepSeek 配额。

## 通用错误结构

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "baseline cannot be empty.",
    "details": {}
  }
}
```

`details` 仅在有额外结构化信息时出现。客户端应使用 `code` 处理错误，`message` 用于展示；不要依赖英文 message 的精确文本。

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `200` | 查询或导出成功 |
| `201` | 分析创建并持久化成功 |
| `204` | 删除成功，无响应体 |
| `400` | JSON、请求字段、分析 ID、报告格式或 OpenAPI 文档无效 |
| `404` | 路由或分析记录不存在 |
| `413` | baseline/candidate 超出配置的单份规范大小 |
| `502` | AI 上游失败，或模型响应未通过结构校验 |
| `503` | AI 功能关闭或缺少必要配置 |
| `504` | AI 上游请求超时 |
| `500` | 存储等意外服务端错误 |

## 数据模型

### Severity

```ts
type Severity =
  | 'breaking'
  | 'potentially-breaking'
  | 'non-breaking'
  | 'info';
```

### Change

```json
{
  "id": "CG-0001",
  "ruleId": "PARAMETER_REQUIRED",
  "severity": "breaking",
  "category": "parameter",
  "location": "paths./pets.get.parameters.query.limit",
  "message": "Query parameter limit became required.",
  "before": false,
  "after": true,
  "recommendation": "Keep the parameter optional until existing clients migrate."
}
```

`category` 为 `path`、`operation`、`parameter`、`request-body`、`response`、`schema`、`security` 或 `metadata`。

### StoredAnalysis

```json
{
  "id": "1e7fb7d1-5990-4a68-9f48-1d73e4691134",
  "baselineName": "petstore-v1.yaml",
  "candidateName": "petstore-v2.yaml",
  "createdAt": "2026-09-16T10:00:00.000Z",
  "engineVersion": "1.0.1",
  "generatedAt": "2026-09-16T10:00:00.000Z",
  "source": {
    "old": {
      "title": "ContractGuard Petstore",
      "version": "1.0.0",
      "openapi": "3.0.3"
    },
    "new": {
      "title": "ContractGuard Petstore",
      "version": "2.0.0",
      "openapi": "3.0.3"
    }
  },
  "score": 42,
  "compatible": false,
  "summary": {
    "total": 12,
    "breaking": 8,
    "potentiallyBreaking": 2,
    "nonBreaking": 1,
    "info": 1
  },
  "changes": []
}
```

上例中的分数和计数仅用于解释字段，不是对 fixture 的承诺结果。`compatible` 只在没有明确 `breaking` 时为 `true`；仍可能存在 `potentially-breaking`。

### AiReview

```ts
interface AiReview {
  schemaVersion: '1.0';
  analysisId: string;
  provider: 'deepseek';
  model: string;
  generatedAt: string;
  promptVersion: 'ai-explainer-v1';
  overview: {
    headline: string;
    executiveSummary: string;
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
  };
  keyRisks: Array<{
    changeId: string;
    title: string;
    explanation: string;
    affectedConsumers: string[];
    remediation: string;
    priority: 'P0' | 'P1' | 'P2';
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
```

`overview.riskLevel` 与 `keyRisks.priority` 是模型生成的沟通字段，不是规则引擎 severity。客户端不得用它们替代确定性的发布门禁。`usage` 只在上游提供用量信息时出现。

## `GET /api/health`

读取服务状态。

**Response `200`**

```json
{
  "status": "ok",
  "service": "contractguard-api",
  "version": "1.0.1"
}
```

该端点证明进程可以响应，不检查磁盘可写性或下游依赖，因此不是完整 readiness 保证。

## `GET /api/ai/status`

读取 AI 解释器的本地配置状态。该端点不会调用 DeepSeek，也不会消耗 token。

**Response `200`**

```json
{
  "enabled": true,
  "configured": true,
  "available": true,
  "provider": "deepseek",
  "model": "deepseek-flash",
  "promptVersion": "ai-explainer-v1"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | boolean | `CONTRACTGUARD_AI_ENABLED` 是否显式启用 |
| `configured` | boolean | 必要服务端配置是否完整 |
| `available` | boolean | 当前是否允许发起 AI 请求；不代表已探测上游健康状态 |
| `provider` | `"deepseek"` | 当前 provider |
| `model` | string | 当前配置的模型标识 |
| `promptVersion` | `"ai-explainer-v1"` | 当前提示模板版本 |

此响应永远不包含 API key。不要把 `available: true` 当成 DeepSeek 账号余额、配额或网络连通性的保证。

## `GET /api/rules`

返回当前引擎公开的规则目录。

**Response `200`**

```json
{
  "rules": [
    {
      "id": "PATH_REMOVED",
      "title": "Path removed",
      "category": "path",
      "defaultSeverity": "breaking",
      "description": "A previously documented endpoint path is no longer available."
    }
  ]
}
```

部分 schema 规则会根据 request/response 上下文调整实际 severity；`defaultSeverity` 是目录中的基础值，不保证每次触发都相同。

## `POST /api/analyses`

创建并保存一次兼容性分析。

### Request body

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `baseline` | `string` 或 JSON object | 是 | 已发布/旧版 OpenAPI 文本或对象 |
| `candidate` | `string` 或 JSON object | 是 | 候选/新版 OpenAPI 文本或对象 |
| `baselineName` | `string`，最多 200 字符 | 否 | 报告中显示的名称，默认 `baseline.yaml` |
| `candidateName` | `string`，最多 200 字符 | 否 | 报告中显示的名称，默认 `candidate.yaml` |

以 JSON 对象提交的最小示例：

```json
{
  "baselineName": "v1.json",
  "candidateName": "v2.json",
  "baseline": {
    "openapi": "3.1.0",
    "info": { "title": "Example", "version": "1.0.0" },
    "paths": {}
  },
  "candidate": {
    "openapi": "3.1.0",
    "info": { "title": "Example", "version": "1.1.0" },
    "paths": {}
  }
}
```

以 YAML 文本提交时，`baseline`/`candidate` 是 JSON 字符串；换行必须按 JSON 规则编码。推荐由程序读取文件，而不是手工在 shell 中转义。

**Response `201`：** 完整 `StoredAnalysis`。

可能错误：

- `INVALID_REQUEST`：字段缺失、为空、类型错误或文件名过长；
- `SPEC_TOO_LARGE`：单份规范超过 `CONTRACTGUARD_MAX_SPEC_BYTES`；
- `INVALID_OPENAPI_DOCUMENT`（或更具体解析错误）：规范无法解析、版本不受支持或结构不合法。

## `GET /api/analyses`

列出历史分析的轻量摘要，按 `createdAt` 从新到旧排列。响应不包含完整 `changes`，打开详情时再按 ID 查询。

**Response `200`**

```json
{
  "analyses": [
    {
      "id": "1e7fb7d1-5990-4a68-9f48-1d73e4691134",
      "baselineName": "v1.yaml",
      "candidateName": "v2.yaml",
      "createdAt": "2026-09-16T10:00:00.000Z",
      "score": 74,
      "compatible": false,
      "summary": {
        "total": 5,
        "breaking": 1,
        "potentiallyBreaking": 1,
        "nonBreaking": 2,
        "info": 1
      }
    }
  ]
}
```

当前版本不提供分页或服务端筛选，适合本地、有限历史记录场景。

## `GET /api/analyses/{id}`

读取一次完整分析。

### Path parameter

- `id`：创建分析时返回的 UUID。

- **Response `200`：** `StoredAnalysis`。
- **Response `400`：** `INVALID_ANALYSIS_ID`。
- **Response `404`：** `ANALYSIS_NOT_FOUND`。

## `POST /api/analyses/{id}/ai-review`

让 DeepSeek 对一次已经保存的确定性分析生成结构化解释。调用前必须在服务端显式启用并配置 AI。

该接口不会重新分析 OpenAPI，也不会覆盖已保存记录。服务端不发送 baseline/candidate 原始文本，只发送分析名称和版本元数据、确定性摘要，以及最多 `CONTRACTGUARD_AI_MAX_CHANGES` 条经过裁剪的结构化 finding；finding 不含原始 `before`/`after` 对象。

### Path parameter

- `id`：创建分析时返回的 UUID。

### Request body

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `language` | `"zh-CN"` 或 `"en"` | 否 | AI 解读的目标语言，默认 `zh-CN` |
| `focus` | string，最多 500 字符 | 否 | 希望优先说明的受众、风险或迁移目标 |

```json
{
  "language": "zh-CN",
  "focus": "优先解释 breaking 变化、旧客户端影响，以及可分阶段执行的迁移方案。"
}
```

仓库内的同一请求体见 `examples/ai-review-request.json`。`focus` 只能影响解释角度，不能改变规则等级、分数、兼容性或 CI 行为。

**Response `200`**

```json
{
  "schemaVersion": "1.0",
  "analysisId": "1e7fb7d1-5990-4a68-9f48-1d73e4691134",
  "provider": "deepseek",
  "model": "deepseek-flash",
  "generatedAt": "2026-09-17T08:00:00.000Z",
  "promptVersion": "ai-explainer-v1",
  "overview": {
    "headline": "候选 API 包含需要阻止直接发布的破坏性变化",
    "executiveSummary": "多个既有调用方式将失效，应保留兼容路径并分阶段迁移消费者。",
    "riskLevel": "critical"
  },
  "keyRisks": [
    {
      "changeId": "CG-0001",
      "title": "既有客户端可能无法继续调用端点",
      "explanation": "规则引擎识别到已发布端点被删除。",
      "affectedConsumers": ["仍使用旧路径的 SDK 和直接 HTTP 调用方"],
      "remediation": "恢复旧路径，在迁移窗口内同时提供新旧版本。",
      "priority": "P0"
    }
  ],
  "migrationPlan": [
    {
      "order": 1,
      "title": "恢复兼容入口",
      "actions": ["恢复旧路径", "为旧路径增加弃用提示"],
      "relatedChangeIds": ["CG-0001"]
    }
  ],
  "testSuggestions": [
    {
      "title": "回归旧客户端调用",
      "details": "使用上一发布版 SDK 验证旧路径仍可访问。",
      "relatedChangeIds": ["CG-0001"]
    }
  ],
  "caveats": ["模型未获得运行时流量和客户端版本分布。"],
  "usage": {
    "promptTokens": 1200,
    "completionTokens": 500,
    "totalTokens": 1700
  }
}
```

自然语言、排序和 token 数会随输入与模型变化；上例只演示结构。服务端会解析并验证模型的 JSON 输出，非法或空响应不会以 `200` 返回。

可能错误：

| HTTP | `error.code` | 原因 |
| --- | --- | --- |
| `400` | `INVALID_JSON` | 标记为 JSON 的请求体不是合法 JSON |
| `400` | `INVALID_AI_REVIEW_REQUEST` | 请求体、未知字段、language 或 focus 不符合约束 |
| `404` | `ANALYSIS_NOT_FOUND` | 分析 ID 不存在 |
| `503` | `AI_DISABLED` | AI 开关未启用 |
| `503` | `AI_NOT_CONFIGURED` | 未配置 API key 等必要参数 |
| `504` | `AI_UPSTREAM_TIMEOUT` | 调用 DeepSeek 或读取响应超时 |
| `502` | `AI_UPSTREAM_UNAVAILABLE` | 网络层无法连接 DeepSeek |
| `502` | `AI_UPSTREAM_ERROR` | DeepSeek 返回非成功状态，或响应无法读取 |
| `502` | `AI_INVALID_RESPONSE` | 模型输出无法解析或未通过本地 schema 校验 |

502/504 响应不会使原始 `StoredAnalysis` 失效。客户端应继续展示确定性报告，并允许用户稍后手动重试；不要在无限循环中自动重试付费请求。

## `GET /api/analyses/{id}/report`

下载分析报告。

### Query parameter

| 字段 | 值 | 默认 |
| --- | --- | --- |
| `format` | `json`、`markdown`、`html` | `json` |

响应具有 `Content-Disposition: attachment`，建议文件名为 `contractguard-{id}.{ext}`。

| format | Content-Type |
| --- | --- |
| `json` | `application/json; charset=utf-8` |
| `markdown` | `text/markdown; charset=utf-8` |
| `html` | `text/html; charset=utf-8` |

HTML 为自包含静态报告。输入规范中的文本会被转义，但分享前仍应检查是否含内部信息。

- **Response `400`：** `INVALID_REPORT_FORMAT` 或无效 ID。
- **Response `404`：** `ANALYSIS_NOT_FOUND`。

## `DELETE /api/analyses/{id}`

删除本地分析记录。

- **Response `204`：** 已删除，无响应体。
- **Response `400`：** `INVALID_ANALYSIS_ID`。
- **Response `404`：** `ANALYSIS_NOT_FOUND`。

该操作不可通过 API 撤销，但不会修改 baseline/candidate 的原始文件。

## 调用示例

### PowerShell

```powershell
$body = @{
  baseline = Get-Content -Raw fixtures/petstore-v1.yaml
  candidate = Get-Content -Raw fixtures/petstore-v2-breaking.yaml
  baselineName = 'petstore-v1.yaml'
  candidateName = 'petstore-v2-breaking.yaml'
} | ConvertTo-Json

$analysis = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/api/analyses `
  -ContentType 'application/json' `
  -Body $body

$analysis.summary

# Optional: requires server-side DeepSeek configuration.
$aiReview = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/api/analyses/$($analysis.id)/ai-review" `
  -ContentType 'application/json; charset=utf-8' `
  -Body '{"language":"zh-CN","focus":"优先说明 breaking 变化和迁移顺序"}'

$aiReview.overview
```

PowerShell 在较旧版本中对嵌套对象的默认 JSON 深度较低；本例的规范是字符串，因此不受影响。若直接提交对象，应为 `ConvertTo-Json` 指定足够的 `-Depth`。

### JavaScript

```js
const response = await fetch('http://localhost:8080/api/analyses', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    baseline: baselineText,
    candidate: candidateText,
    baselineName: 'openapi-v1.yaml',
    candidateName: 'openapi-v2.yaml'
  })
});

if (!response.ok) {
  const problem = await response.json();
  throw new Error(problem.error?.message ?? `HTTP ${response.status}`);
}

const analysis = await response.json();
console.log(analysis.summary);
```

## 限制与版本策略

当前 API 是本地项目接口，没有承诺长期稳定的外部 SaaS 版本策略。客户端应至少固定项目版本，并对未知响应字段保持容忍。规则语义发生变化时会提升 `engineVersion`；AI 结构由 `schemaVersion`、提示模板由 `promptVersion` 标识。HTTP 路由或响应发生不兼容变化时应引入显式 API 版本前缀或提升对应 schema 版本，而不是静默替换。

AI 输出含生成式内容，不适合作为稳定字符串接口。自动化系统应读取确定性 `StoredAnalysis`；若消费 AI 响应，只依赖记录在 `schemaVersion` 中的结构，并对缺省 `usage` 和新增字段保持容忍。
