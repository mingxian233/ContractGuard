# ContractGuard 交付与发布检查 / Delivery Checklist

更新日期：2026-09-21

公开仓库：[mingxian233/ContractGuard](https://github.com/mingxian233/ContractGuard)

本清单说明公开仓库已经交付的内容、可复现的验收方式、明确排除的本机数据，以及后续每次发布仍需由维护者确认的事项。它不以勾选项替代 GitHub Actions 或实际运行结果。

## 1. 发布基线

| 项目 | 当前约定 |
| --- | --- |
| 默认分支 | `main` |
| 许可证 | MIT，见 [`LICENSE`](../LICENSE) |
| Node.js | `>=22.13`，见根目录 `package.json` |
| 包管理器 | pnpm `11.19.0`，由 `packageManager` 与 `pnpm-lock.yaml` 固定 |
| CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| 默认服务地址 | `http://127.0.0.1:8080`；浏览器通常访问 `http://localhost:8080` |
| AI | 默认关闭；核心分析不需要 API Key |
| 数据存储 | 本地 JSON 文件；默认目录为 `data/analyses/` |

## 2. 源码交付

| 交付项 | 位置 | 可验收能力 |
| --- | --- | --- |
| 核心规则引擎 | `packages/core/` | OpenAPI 3.0/3.1 解析、同文档本地 `$ref`、方向感知规则、摘要与评分 |
| REST API | `apps/api/` | 健康检查、规则目录、分析创建/查询/删除、报告导出、AI 状态与 AI review |
| CLI / CI 入口 | `apps/cli/` | 文件比较、四种输出格式、三种失败阈值与稳定退出码 |
| Web 工作台 | `apps/web/` | 规范导入/粘贴、演示数据、结果筛选、规则目录、历史、导出和 AI 解读 |
| 示例与评估 | `fixtures/`、`examples/` | breaking/compatible fixture、manifest、GitHub Actions 与 AI 请求示例 |
| 自动化验证 | `scripts/`、各 workspace 测试 | 单元测试、类型检查、构建与端到端冒烟检查 |
| 部署入口 | `Dockerfile`、`docker-compose.yml` | 单容器构建、本机端口绑定与持久化 volume |
| Windows 启动 | `start-contractguard.bat` | 环境检查、可选安全读取 DeepSeek Key、启动已构建服务 |

## 3. 文档与治理交付

- [x] 中文入口：[`README.md`](../README.md)
- [x] English overview：[`README.en.md`](../README.en.md)
- [x] 产品背景、实际场景与作品集陈述：[`docs/project-overview.md`](./project-overview.md)
- [x] 用户操作：[`docs/user-guide.md`](./user-guide.md)
- [x] 系统设计：[`docs/architecture.md`](./architecture.md)
- [x] 兼容性口径：[`docs/compatibility-rules.md`](./compatibility-rules.md)
- [x] REST API：[`docs/api-reference.md`](./api-reference.md)
- [x] DeepSeek 配置、数据边界与故障排查：[`docs/ai-report-interpreter.md`](./ai-report-interpreter.md)
- [x] 开发、评估与验证：[`docs/development.md`](./development.md)、[`docs/evaluation.md`](./evaluation.md)、[`docs/verification.md`](./verification.md)
- [x] 安全策略与部署边界：[`SECURITY.md`](../SECURITY.md)
- [x] 无真实凭据的配置模板：[`.env.example`](../.env.example)
- [x] OpenAPI 官方规范链接：[3.0.4](https://spec.openapis.org/oas/v3.0.4.html)、[3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[版本索引](https://spec.openapis.org/oas/)

## 4. 推荐验收流程

在干净 clone 中执行：

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 串行执行构建、类型检查、测试、文档链接与示例配置检查，以及端到端冒烟验证；只需定向重跑时可分别使用 `pnpm docs:check`、`pnpm config:check` 和 `pnpm smoke`。精确的历史测试环境和结果记录在 [`docs/verification.md`](./verification.md)；测试数量会随用例增加而变化，因此本清单不硬编码总数。

还应完成一次人工冒烟：

1. 执行 `pnpm start`，打开 `http://localhost:8080`；
2. 点击“载入演示规范”并运行分析；
3. 筛选 breaking finding，展开证据；
4. 分别导出 JSON、Markdown 与 HTML；
5. 打开“分析历史”，重新载入并删除该记录；
6. 未配置 Key 时确认 AI 明确显示不可用，而不影响核心分析。

真实 DeepSeek 调用属于可选验收项。只有在用户主动提供自己的 Key、确认费用与数据政策后，才应执行 [`docs/ai-report-interpreter.md`](./ai-report-interpreter.md) 中的云端连通性步骤。

## 5. CI 验收范围

仓库工作流应至少证明：

- 锁文件可以在 Node.js 22 环境中完成干净安装；
- monorepo 构建、类型检查和测试通过；
- 文档内部链接与示例配置通过静态检查；
- breaking fixture 能按 `--fail-on breaking` 返回退出码 `2`；
- 生成的报告作为 workflow artifact 保留，便于失败复核。

GitHub 页面上的实时 Actions 结果才是远程环境的最终状态；本文不复制一个可能过时的“CI 已通过”结论。

## 6. 公开仓库排除项

以下内容是运行时数据、生成物或凭据，不属于源码交付，也不应进入提交：

- `node_modules/`、包管理器缓存；
- `dist/`、coverage、`.test-dist/` 与其他生成物；
- `data/analyses/` 下的本地分析历史（仅保留 `.gitkeep`）；
- `.env`、真实 DeepSeek API Key 或其他凭据；
- 临时报告、日志与本机编辑器文件；
- 用户目录绝对路径、Git 凭据或其他机器特定信息。

提交前至少运行：

```bash
git status --short
git diff --check
```

如果曾把真实 Key 加入工作区，仅从当前文件删除还不够：应立即轮换 Key，并检查 Git 历史、Actions 日志和已发布 artifact。

## 7. 每次发布前由维护者确认

- [ ] `package.json` 版本、引擎版本与文档描述一致；
- [ ] `pnpm install --frozen-lockfile` 在干净目录成功；
- [ ] `pnpm check`、`pnpm docs:check`、`pnpm smoke` 全部通过；
- [ ] GitHub Actions 对目标 commit 显示成功；
- [ ] README 的中英文入口、徽章、Mermaid 图和文档链接可打开；
- [ ] Docker 镜像在具有 Docker daemon 的环境中完成一次实际构建与健康检查；
- [ ] 未跟踪文件中没有分析历史、报告、日志或凭据；
- [ ] 若规则行为改变，已同步 fixture、测试、规则文档、引擎版本和验证记录；
- [ ] 若 AI schema、模型或默认配置改变，已同步 `.env.example`、启动脚本与 AI 指南；
- [ ] 发布说明诚实列出当前不支持的 OpenAPI/JSON Schema 语义。

## 8. 交付边界

当前交付是可本地运行的单用户工程版本，不是托管 SaaS。它不包含：

- 用户登录、组织/租户隔离和权限管理；
- TLS 终止、WAF、速率限制、配额、计费和审计日志；
- 外部或跨文件 `$ref` 获取；
- 对全部组合 Schema 与业务行为的证明；
- 生产流量回放、消费者自动发现或灰度发布控制。

需要网络部署或多人共享时，应先按 [`SECURITY.md`](../SECURITY.md) 完成安全加固，并将本地文件存储替换为具备访问控制、并发与备份策略的持久化层。
