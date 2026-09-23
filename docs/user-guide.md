# 用户指南 / User Guide

本指南面向希望在本机演示、在项目评审中使用，或把 ContractGuard 接入 CI 的用户。

## 1. 环境要求

- Node.js 22.13 或更高版本；
- pnpm 11（项目锁定并验证于 pnpm 11.19）；
- 可选：Docker 与 Docker Compose。
- 可选：一个受支持的云端 LLM API key，或本机 Ollama/OpenAI-compatible 服务。

确定性分析默认在本地进行，不需要模型 API key 或第三方账号。只有显式启用 AI 报告解释器并选择云端档案时，裁剪后的分析结果才会发送到对应数据边界。

## 2. 安装与启动

在项目根目录执行：

```bash
pnpm install
pnpm build
pnpm dev
```

开发模式默认提供：

- Web：`http://localhost:5173`
- REST API：`http://localhost:8080`
- 健康检查：`http://localhost:8080/api/health`

若端口被占用，请通过项目提供的环境变量或开发服务器配置调整；不要在代码中硬编码新的 API 地址。

### 使用 Docker

```bash
docker compose up --build
```

首次构建需要下载基础镜像。启动后访问 `http://localhost:8080`；API 与编译后的 Web 共用该端口，并默认只绑定宿主机 `127.0.0.1`。若要停止服务，按 `Ctrl+C`，或在另一个终端执行 `docker compose down`。分析历史保存在命名卷 `contractguard-data` 中，普通的 `docker compose down` 不会删除该卷。

## 3. 五分钟 Web 演示

1. 打开 Web 工作台。
2. 将 `fixtures/petstore-v1.yaml` 作为 Baseline。
3. 将 `fixtures/petstore-v2-breaking.yaml` 作为 Candidate。
4. 点击“开始分析 / Run analysis”。
5. 查看顶部摘要，再把风险筛选为 `breaking`。
6. 展开一条结果，确认规则 ID、位置、before/after 和建议。
7. 导出 Markdown 或 HTML 报告。
8. 将 Candidate 换成 `petstore-v2-compatible.yaml`，观察风险组成的差异。

基线应当是当前已发布或调用方正在使用的契约，候选应当是准备发布的契约。二者放反会改变兼容性结论。

## 4. 可选：生成多 LLM AI 解读

AI 解释器默认关闭，并且绝不参与严重等级、得分、`compatible` 或 CI 退出码的计算。若希望使用：

1. 复制 `config/llm-providers.example.json`，设置 `CONTRACTGUARD_LLM_CONFIG`，并只在 API 服务端注入档案 `secretEnv` 指向的 key；
2. 重启服务并访问 `GET /api/ai/status`，确认 `available` 为 `true`；
3. 先完成一次普通分析，取得响应中的 `id`；
4. 调用 `POST /api/analyses/{id}/ai-review`，请求体使用 `{"language":"zh-CN","providerId":"deepseek-cloud"}`，`providerId` 和 `focus` 均可省略。

在 Web 工作台中无需手工调用接口：完成分析后向下滚动到“AI 报告解释器”。如果管理员允许档案覆盖，可先从服务端公布的可用档案中选择，再填写不超过 500 字符的“本次特别关注”并生成解读。页面会展示实际 Provider/模型、重点风险、迁移计划、测试建议与解读局限，并保留 `changeId` 供你回到原始 finding 核对。

PowerShell 快速调用：

```powershell
$status = Invoke-RestMethod 'http://localhost:8080/api/ai/status'
$review = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/api/analyses/$($analysis.id)/ai-review" `
  -ContentType 'application/json; charset=utf-8' `
  -Body '{"language":"zh-CN","focus":"优先说明 breaking 变化和迁移顺序","providerId":"deepseek-cloud"}'
```

完整配置、Docker 操作、响应字段和错误处理见[多 LLM AI 报告解释器](./ai-report-interpreter.md)。云端调用会产生数据传输、延迟和可能的费用；ContractGuard 默认不发送原始 OpenAPI，只发送有数量上限的结构化 finding。V1.1 不会在失败时自动切换 Provider。

## 5. 输入规范

ContractGuard 支持 OpenAPI 3.0/3.1 的 YAML 或 JSON 文本。建议在分析前先用团队现有的 OpenAPI 校验器确认文档本身有效。

为了获得可复现结果：

- 尽量先把跨文件 `$ref` 打包成单文件；
- 不要依赖运行时模板变量替换；
- 为每个 operation 提供稳定的 `operationId`；
- 把请求与响应 schema 分开建模，避免一个组件同时表达输入和输出的不同语义；
- 将实际发布的文件作为 baseline，而不是只保留手工复制的片段。

若文档包含凭据、内部域名或样例中的个人数据，请先脱敏。历史记录会保存在本地数据目录中。

## 6. 阅读结果

### 先看严重等级，不要只看分数

得分是用于排序的摘要。一条关键端点删除即使没有把分数降到很低，也足以阻止发布。建议按以下顺序阅读：

1. `breaking`：是否可以恢复兼容，或必须发布新主版本；
2. `potentially-breaking`：结合 SDK、客户端容错与业务语义验证；
3. `non-breaking`：确认它确实是有意的扩展；
4. `info`：检查 operationId、弃用和文档变化是否已通知使用方。

如果同时生成了 AI 解读，应先用 `changeId` 回到确定性 finding 核对证据。AI 的 `riskLevel`、`priority`、迁移步骤和测试建议是沟通辅助，不是发布授权。

### 位置与证据

`location` 指向规范中的逻辑位置，而不是编辑器的行号。`before` 和 `after` 给出触发规则的关键值。若同一个组件在多个操作中使用，可能出现多个带有不同请求/响应上下文的结果，这是为了保留真实影响范围。

### 处理常见 breaking 变化

| 变化 | 较安全的迁移方式 |
| --- | --- |
| 新增必填参数/字段 | 先作为 optional 发布；客户端迁移完成后再考虑强制 |
| 删除字段 | 先标记 deprecated，观察使用情况，跨主版本删除 |
| 枚举收窄 | 保留旧值并在业务层逐步停止产生/接受 |
| 响应类型改变 | 新增字段或端点，不原位复用不同类型 |
| 增加鉴权 | 提供迁移期、明确错误响应并更新 SDK/文档 |
| operationId 改名 | 保留旧 SDK 方法别名，或记录生成 SDK 的破坏性升级 |

## 7. 使用 CLI

运行内置 breaking 样例的快捷命令是 `pnpm demo`；该命令固定使用 `--fail-on never`，因此展示风险后仍正常退出。

基本语法：

```bash
pnpm contractguard compare <baseline> <candidate> [options]
```

示例：

```bash
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-breaking.yaml
```

输出 Markdown 文件，并在出现 breaking 时使用非零退出码：

```bash
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-breaking.yaml --format markdown --output artifacts/api-compatibility.md --fail-on breaking
```

常用选项：

| 参数 | 可选值 | 作用 |
| --- | --- | --- |
| `--format` | `table`、`json`、`markdown`、`html` | 选择输出格式 |
| `--output` | 文件路径 | 将输出写入文件；未提供时写到终端 |
| `--fail-on` | `breaking`、`potentially-breaking`、`never` | 设置 CI 失败阈值 |
| `--policy` | JSON 文件路径 | 应用规则启停、severity 与评分权重策略 |

输入无法解析、文件不存在或程序异常时，不论 `--fail-on` 如何设置都应返回非零退出码；`never` 只表示“不要因为发现兼容性风险而失败”。

使用策略时，新报告会记录策略、baseline 与 candidate 的 SHA-256 指纹，便于复核输入和治理口径。完整格式与安全建议见[规则策略与输入指纹](./rule-policy.md)。

## 8. CI 示例

以下是通用思路，具体命令应结合仓库工作流：

```yaml
- name: Install dependencies
  run: pnpm install --frozen-lockfile

- name: Build ContractGuard
  run: pnpm build

- name: Check API compatibility
  run: >-
    pnpm contractguard compare
    api/openapi-released.yaml
    api/openapi.yaml
    --format markdown
    --output contractguard-report.md
    --fail-on breaking
```

CI 必须使用可信的 baseline。常见做法是从默认分支、上一发布 tag 或内部制品库获取；不要用 pull request 同时修改后的两个文件互相比对，否则可能掩盖变化。

建议把 JSON 报告保存为构建制品，把 Markdown 摘要放入评审流程。自动发布 PR 评论或外部状态检查不属于本地核心版本的默认能力。

AI 解释不应成为 CI 是否通过的依据，也不建议在每次流水线中自动调用付费模型。CI 应继续读取 CLI 退出码或确定性 JSON；需要人员解读时再按需调用 AI。

## 9. 历史与报告

Web 界面中的历史记录来自 API 的本地数据目录。可以重新打开分析并导出报告。删除操作只移除 ContractGuard 的分析记录，不会删除原始 OpenAPI 文件。

报告格式选择建议：

- JSON：机器处理、质量统计、后续可视化；
- Markdown：代码评审、课程/项目归档；
- HTML：无需运行服务即可阅读的演示材料；
- Table：终端快速判断。

HTML 报告由输入规范生成，分享前仍应检查其中是否含有内部 URL 或敏感描述。

## 10. 常见问题

### 为什么“响应枚举增加值”被提示风险？

旧客户端可能把枚举映射为封闭类型，或使用没有 default 分支的 switch。服务端开始返回新值时会触发解析或逻辑错误，因此与“请求枚举增加可接受值”方向不同。

### 为什么文本变化也出现在结果里？

元数据变化通常是 `info`，用于形成完整审计线索。可以用风险筛选隐藏它们。

### 为什么两个看似相同的 schema 仍出现差异？

检查 `$ref` 解析、缺省值、path-level 参数合并以及输入是否被预处理。若涉及 `allOf`/`oneOf` 等高级语义，请查看已知限制，不要仅依赖自动结论。

### 可以直接分析线上 URL 吗？

核心流程以本地文本/文件为主，并默认不抓取外部引用。这既提高可复现性，也避免 SSRF 与凭据泄漏。先用受信任工具下载并打包规范，再交给 ContractGuard。

### 分析结果能证明发布安全吗？

不能。它是发布评审的一条证据，还应结合消费者契约测试、集成测试、监控、灰度和回滚方案。

### LLM 会改变兼容性分数吗？

不会。模型只接收确定性结果的裁剪副本并返回自然语言解释。规则等级、得分、`compatible` 和 CLI/CI 行为在调用 AI 前已经确定。

### 关闭 AI 后还能用吗？

可以。默认配置就是关闭状态；普通分析、历史、报告导出和 CLI 均不依赖任何 LLM。AI 失败时应保留并继续使用确定性报告。

## 11. 故障排查

| 现象 | 检查项 |
| --- | --- |
| 页面无法连接 API | 确认 `/api/health` 可访问、端口和前端 API base URL 一致 |
| YAML 解析失败 | 检查缩进、Tab、重复键和未加引号的特殊值 |
| `$ref` 未解析 | 确认引用是同一文档内合法 JSON Pointer，或先 bundle 外部文件 |
| 历史无法保存 | 检查数据目录权限和磁盘空间 |
| CI 意外通过 | 检查 `--fail-on`、输入顺序与命令退出码是否被 shell 忽略 |
| 结果与业务认知冲突 | 对照规则位置，并补充消费者测试；必要时记录为已知误报/漏报 |
| 策略加载失败 | 检查 `CONTRACTGUARD_POLICY_CONFIG`、JSON Schema、规则 ID 与 64 KiB 上限 |
| AI 状态为不可用 | 检查配置路径、总开关、档案开关、活动档案、`secretEnv` 与模型名；修改后重启进程 |
| AI 返回 502/504 | 检查所选 Provider 的端点、账号/配额、网络和超时；确定性报告仍可继续使用 |
| 担心云端泄露 | 不启用 AI，或先脱敏 finding；不要把服务无鉴权暴露到公网 |

更多接口细节见 [API Reference](./api-reference.md)，AI 完整教程见 [ai-report-interpreter.md](./ai-report-interpreter.md)，策略见 [rule-policy.md](./rule-policy.md)，开发流程见 [development.md](./development.md)。
