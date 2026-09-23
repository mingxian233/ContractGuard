# 开发指南 / Development Guide

## 1. 开发原则

ContractGuard 把“可复现的兼容结论”放在界面表现之前。任何功能修改都应遵守：

- 核心规则不依赖 HTTP、DOM 或文件存储；
- Web、API、CLI 共用类型和规则，不复制判断逻辑；
- 每个新增规则必须有正例、反例和边界测试；
- 无法可靠判断的语义要暴露限制，不能静默当作兼容；
- AI 只能解释已有 finding，不得参与规则等级、计分、`compatible` 或 CLI/CI 退出码；
- 文档中的命令、响应示例和规则表应跟随代码一起修改。

## 2. 初始化工作区

```bash
pnpm install
pnpm build
pnpm test
```

常用根命令：

```bash
pnpm dev        # 同时启动 API 与 Web 开发服务
pnpm build      # 构建所有工作区包
pnpm test       # 运行自动化测试
pnpm typecheck  # 运行 TypeScript 类型检查（若脚本可用）
```

应使用仓库锁文件固定依赖版本。在 CI 中优先使用 `pnpm install --frozen-lockfile`。

## 3. 代码边界

### `packages/core`

核心包负责：

1. 解析 YAML/JSON；
2. 校验最低限度的 OpenAPI 文档结构；
3. 解析本地 `$ref` 与统一参数/响应结构；
4. 比较 baseline 与 candidate；
5. 验证并应用规则策略；
6. 生成 `Change[]`、摘要、得分和输入/策略指纹；
7. 暴露版本化规则目录。

核心函数应尽量是纯函数。时间戳等不可重复值在边界层注入或单独测试。不得在解析过程中抓取远程 URL。

### `apps/api`

API 负责输入上限、状态码、历史 repository、导出内容类型和可选的 AI provider 边界。路由层不应包含类似“新增必填字段就是 breaking”的逻辑。错误应归一为稳定 JSON 结构，服务端日志与公开消息分离。

多 LLM 集成必须遵守：

- 默认关闭，没有 key 时普通 API 仍可启动；
- 只从已保存的分析中提取有上限的 finding，不发送原始 OpenAPI；
- JSON 只保存 `secretEnv` 名称，key 只从服务端环境读取，不能下发到前端或写入公开错误；
- 浏览器只能提交服务端档案 ID，不能提交 URL、模型、请求头或凭据；
- adapter 使用静态注册表，不能从 JSON 动态加载代码；
- 不自动跨 Provider fallback，避免未经批准改变数据边界；
- 使用 `AbortSignal`/超时终止慢请求，并把上游错误映射为稳定错误码；
- 对模型 JSON 做运行时结构校验，不能只依赖 TypeScript 类型断言；
- provider 接口与 HTTP 路由分离，以便测试时注入 fake provider；
- 不允许模型输出回写确定性分析记录或改变 CI 行为。

### `apps/web`

前端以 API 响应为事实来源。筛选和排序可以在浏览器完成，但不得重新计算兼容性等级。对结果中的 message、location 和规范文本按不可信内容处理。

### `apps/cli`

CLI 负责参数解析、文件 I/O、格式渲染与退出码。其分析结果应与 REST API 对相同输入得到的核心结果一致（除时间戳和记录 ID 等边界字段）。

## 4. 增加一条规则

建议按以下顺序工作：

1. 在问题陈述中写出旧客户端可被破坏的具体反例；
2. 明确规则适用于 request、response，还是二者但方向不同；
3. 在规则目录中新增稳定 `ruleId`，不要复用含义不同的旧 ID；
4. 创建最小 baseline/candidate fixture 或内联测试对象；
5. 实现结构差异与风险映射；
6. 断言 `severity`、`location`、`before`、`after` 和建议；
7. 添加一个不会触发该规则的相邻用例，防止误报；
8. 更新 `compatibility-rules.md` 和 evaluation 数据标签；
9. 运行完整测试，确认分数和已有快照变化是有意的。

示例测试思路：

```ts
it('marks an optional request parameter becoming required as breaking', () => {
  const result = analyzeCompatibility(baseline, candidate);
  expect(result.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'PARAMETER_REQUIRED',
        severity: 'breaking'
      })
    ])
  );
});
```

避免只断言变化总数，因为新增其他合理规则时会产生脆弱测试。

## 5. 错误处理约定

错误至少区分：

- 输入不存在或请求格式错误；
- YAML/JSON 语法错误；
- 文档不是受支持的 OpenAPI 版本；
- 引用无法解析或循环超限；
- 记录不存在；
- 存储或内部异常。

客户端错误使用 4xx，意外服务端错误使用 5xx。公开错误体应包含短代码和可执行的说明，不返回堆栈和绝对路径。

## 6. 测试策略

### 单元测试

- 解析 YAML 与 JSON；
- 版本与基础结构校验；
- JSON Pointer 转义和本地 `$ref`；
- 每条规则的 request/response 方向；
- 计分下界与摘要计数；
- 渲染器对 HTML/Markdown 特殊字符的处理。

### API 集成测试

- 健康检查；
- 创建分析并读取同一记录；
- 非法输入返回 4xx 且不落库；
- 列表顺序与删除；
- JSON、Markdown、HTML 的 Content-Type 与核心内容；
- 不存在的 ID 返回 404；
- 超过输入限制的请求被拒绝。
- AI 默认关闭时状态可查询且解读路由返回 `AI_DISABLED`；
- 启用但缺少 key 时返回 `AI_NOT_CONFIGURED`，错误中不含环境变量值；
- fake provider 成功时返回符合 `schemaVersion` 的结构化响应；
- language、focus、超时、上游错误和非法模型响应分别映射到约定状态码；
- 发送给 fake provider 的上下文不含原始 OpenAPI，且 finding 数不超过配置上限；
- 调用 AI 前后，已保存分析的 score、severity、compatible 和 changes 完全一致。

### Web 测试

- 空输入时按钮/错误状态；
- 示例加载和分析请求；
- 四种 severity 筛选、关键字搜索和空结果；
- API 错误可读且可恢复；
- 报告下载与历史打开；
- 窄屏下输入区和结果列表仍可用。

### 端到端一致性

使用同一对 fixture 分别调用核心、API 和 CLI，比较规则 ID、位置、等级和摘要。忽略记录 ID、生成时间等非语义字段。

AI 测试不能对自然语言逐字断言，也不应在默认测试套件中调用真实云端模型。应固定 fake provider 返回，验证档案选择、能力参数、请求裁剪、响应 schema、错误降级和“不会改变确定性结果”的架构不变量。真实云端 smoke test 仅在人工触发、已配置 secret 且明确接受费用时运行。

## 7. 使用 fixtures

三份 Petstore 文件用于快速回归，而不是完整基准集：

```bash
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-breaking.yaml --format json
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-compatible.yaml --format table
```

修改 fixture 时，先记录预期标签。不要为了让现有实现通过而把难例从样例中删除；如果引擎尚未支持，应把它列为明确的 expected miss。

## 8. 评估与性能检查

规则正确性优先于吞吐量。每次发布至少运行：

1. 全部自动化测试；
2. 带标签变更集的 precision/recall 评估；
3. 两份典型规范的 CLI/API 一致性检查；
4. 一个较大规范的运行时间与峰值内存基线；
5. 循环引用、深层 schema 和超大文本的防护测试。

结果记录格式见 [evaluation.md](./evaluation.md)。没有实际运行数据时应填写“未测量”，不能凭经验补数字。

## 9. 环境与配置

配置应由环境变量或启动参数提供。推荐至少允许设置：

- API 监听端口；
- API 监听地址（默认 `127.0.0.1`；容器内显式使用 `0.0.0.0`）；
- 允许的开发 CORS origins（逗号分隔，默认仅 localhost 5173）；
- Web 使用的 API base URL；
- 分析记录数据目录；
- 请求/规范最大尺寸；
- 日志级别和保留条数（若已实现）。

V1.1 的主要配置入口如下：

| 变量 | 默认值 | 约束 |
| --- | --- | --- |
| `CONTRACTGUARD_POLICY_CONFIG` | 空 | 可选规则策略 JSON，API 启动时严格校验；最大 64 KiB |
| `CONTRACTGUARD_LLM_CONFIG` | 空 | 可选多 LLM Profile JSON；设置后优先于旧版 DeepSeek 变量 |
| `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | 空 | 示例 `secretEnv`；实际名称由 Profile 指定，只从服务端环境读取 |

未设置 `CONTRACTGUARD_LLM_CONFIG` 时，以下变量作为 DeepSeek-only 兼容模式：

| 变量 | 默认值 | 约束 |
| --- | --- | --- |
| `CONTRACTGUARD_AI_ENABLED` | `false` | 必须显式为 `true` 才能调用 |
| `DEEPSEEK_API_KEY` | 空 | 只允许由服务端环境或 secret manager 注入 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 应使用 HTTPS；服务端会补齐 `/chat/completions` |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 不应在业务代码中散落硬编码 |
| `CONTRACTGUARD_AI_TIMEOUT_MS` | `30000` | 有效范围 1–120000 毫秒，非法值回退默认值 |
| `CONTRACTGUARD_AI_MAX_CHANGES` | `50` | 有效范围 1–200，非法值回退默认值 |
| `CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS` | `8192` | 有效范围 512–32768，避免结构化 JSON 被中途截断 |
| `CONTRACTGUARD_AI_MAX_RESPONSE_BYTES` | `131072` | 有效范围 1024–1048576，限制上游响应体 |

所有变量都应有安全的开发默认值，并在 README 或 `.env.example` 中记录。不得提交真实密钥或内部服务地址。

各 Provider 的 base URL、模型名和输出能力会演进；修改样例前应核对 [AI 指南列出的官方资料](./ai-report-interpreter.md#2-支持范围)，不要从非官方文章复制过时模型名，也不要在文档或测试中写死价格。规则策略格式与审计语义见 [rule-policy.md](./rule-policy.md)。

## 10. Git 与评审建议

- 一个提交尽量只包含一类规则或一个垂直功能；
- 规则修改在 commit/PR 描述中列出兼容行为变化；
- 不提交生成的历史记录、临时报告、构建目录和依赖目录；
- 依赖升级后运行完整测试并检查锁文件；
- 代码评审重点检查方向性、引用解析和未受信任输入，而不仅是 UI。

## 11. 发布检查清单

- [ ] 构建、类型检查和测试全部通过；
- [ ] CLI、API、Web 使用相同核心版本；
- [ ] 规则目录和本文档一致；
- [ ] fixtures 的预期结果已复核；
- [ ] evaluation 记录包含环境、命令和原始输出；
- [ ] Docker 镜像可从干净环境启动；
- [ ] HTML 报告已验证转义；
- [ ] 数据目录和临时文件不进入发布包；
- [ ] 已知限制与失败案例公开；
- [ ] AI 默认关闭，未设置 key 时核心功能和测试可正常运行；
- [ ] AI 测试使用 fake provider，验证裁剪、schema、超时与错误降级；
- [ ] 浏览器 bundle、日志、错误和示例中不含真实 API key；
- [ ] 公网部署说明包含鉴权、TLS、限流和预算保护；
- [ ] 版本号与变更日志已更新。

## 12. Definition of Done

一个功能只有在实现、测试、错误路径、文档和可复现验证都完成后才算交付。对于兼容性分析器，“能运行”并不足够；还需要说明它为什么得出结论、哪些输入尚不能判断，以及使用者如何独立复核。对于 AI 功能，还必须证明关闭或失败时可安全降级，且模型输出没有进入确定性裁决链路。
