# 验证记录 / Verification Record

本记录说明当前交付截至 2026-09-18 的本地验证范围，便于复现，也明确哪些结论没有被夸大。

## 环境

- Windows 11（受限桌面沙箱）
- Node.js 24.19.0
- pnpm 11.19.0
- TypeScript 5.9.3

项目最低运行版本为 Node.js 22.13，与 pnpm 11.19 的运行要求一致；CI 使用 Node.js 22 验证主流 LTS 环境。

## 已通过项目

| 检查 | 结果 |
| --- | --- |
| Core TypeScript typecheck/build | 通过 |
| API TypeScript typecheck/build | 通过 |
| CLI TypeScript typecheck/build | 通过 |
| Vue application + Vite config typecheck | 通过 |
| Core unit tests | 29/29 通过 |
| API tests | 18/18 通过 |
| CLI formatter/security tests | 3/3 通过 |
| Frontend data-processing tests | 5/5 通过 |
| End-to-end manifest smoke test | 2/2 case 通过 |
| 静态 Web、API、历史、规则与 HTML 报告链路 | 通过 |
| AI 默认关闭、缺失配置与状态接口 | 通过 |
| AI 请求裁剪、响应校验、超时和安全错误降级 | 通过（fake provider） |
| AI 前端状态与结构化响应归一化 | 通过 |
| Web → API → AI 适配器 → 结构化展示完整流程 | 通过（本机 mock DeepSeek） |
| 文档本地链接、AI 示例 JSON、Compose YAML 与变量覆盖 | 通过（静态校验） |

冒烟测试会真正启动已编译 API，确认 Web 静态资源可访问，再读取 `fixtures/evaluation-manifest.json`，逐条创建分析并验证 `mustContain`、`forbiddenSeverities` 与兼容性结论，最后检查 HTML 报告包含证据。

AI API 测试通过注入 fake `fetch` 验证 DeepSeek 请求格式、Bearer key 不进入正文、原始 OpenAPI 不被发送、finding 有界、change ID 必须可追溯、JSON 结构严格校验、响应体挂起时仍能超时，以及上游错误不会泄露 key 或响应正文。默认测试没有调用真实 DeepSeek，因此不会产生云端费用，也不声称验证了当前账号配额、外网连通性或模型自然语言质量。

另用仅监听本机的 mock DeepSeek HTTP 服务完成浏览器端联调：加载内置 Campus Events 规范、生成确定性报告、填写关注点、调用 AI 路由，并确认页面展示摘要、P0 风险、迁移步骤、测试建议、caveat、关联 `changeId` 与 token 用量。该验证覆盖真实前后端数据流，但不替代拿到用户 key 后的云端连通性测试。

## Fixture 结果

| Candidate | Score | Compatible | Breaking | Potential | Non-breaking | Info | Total |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `petstore-v2-breaking.yaml` | 0 | false | 22 | 8 | 1 | 1 | 32 |
| `petstore-v2-compatible.yaml` | 100 | true | 0 | 0 | 14 | 1 | 15 |

## 构建说明

仓库的标准生产构建命令是 `pnpm build`，GitHub Actions 会在干净的 Node.js 22 环境中执行它。本次本地验收环境限制 esbuild 启动子进程，因此同时保留并执行了 portable builder 作为后备验证：

1. `vue-tsc` 与 Vite 配置 typecheck 全部通过；
2. 使用项目内 `build:portable`（Vue SFC compiler + Rollup）生成等价的本地 ESM 构建；
3. 由已编译 API 托管该构建，并验证 HTML、应用 JS、Vue runtime 与 REST 请求链路。

普通开发机与 CI 应使用标准 `pnpm build` / Vite 流程；portable build 只是在受限环境中的可复现后备路径。首次推送后应以 GitHub Actions 的干净构建结果作为最终依据。当前主机没有完成 Docker daemon 级的镜像构建，因此 Dockerfile 与 Compose 已做静态和路径审计，容器运行仍应在具备 Docker 的机器上复核。

## 仍然成立的边界

通过上述测试不代表覆盖所有 OpenAPI/JSON Schema 语义。外部 `$ref`、业务行为、流量兼容性、组合 Schema 的一般包含关系等仍需消费者契约测试与人工评审。对于已识别但无法精确证明的 Schema 关键字变化，引擎会发出 `potentially-breaking`，避免静默给出 100 分。
