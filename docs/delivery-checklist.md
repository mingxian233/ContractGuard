# ContractGuard 交付清单 / Delivery Checklist

更新日期：2026-09-18

本清单用于确认公开仓库包含哪些内容、已经完成哪些验证，以及哪些本机内容被明确排除。

## 1. 源码与功能

- [x] `packages/core/`：OpenAPI 3.0/3.1 解析、本地 `$ref` 解析、兼容性规则、评分和公共类型。
- [x] `apps/api/`：REST API、文件持久化、JSON/Markdown/HTML 报告及 DeepSeek 适配器。
- [x] `apps/cli/`：本地和 CI 命令行入口、输出格式及阈值退出码。
- [x] `apps/web/`：Vue 3 工作台、规范输入、结果筛选、历史记录和 AI 解读界面。
- [x] `fixtures/`：基线、兼容候选、破坏性候选及评估清单。
- [x] `examples/`：GitHub Actions 和 AI Review 请求示例。

## 2. 文档与治理

- [x] 中文 GitHub 主页：`README.md`。
- [x] English GitHub overview: `README.en.md`。
- [x] 项目背景与实际场景：`docs/project-overview.md`。
- [x] 用户指南、架构、兼容性规则、REST API、DeepSeek、开发和评估文档。
- [x] OpenAPI 3.0.4、3.1.2 及官方版本索引链接。
- [x] MIT License：`LICENSE`。
- [x] 安全与公网部署边界：`SECURITY.md`。
- [x] 无真实凭据的配置模板：`.env.example`。

## 3. 启动与部署

- [x] pnpm workspace 与锁文件。
- [x] Windows 启动脚本；可留空 DeepSeek Key，仅运行确定性规则引擎。
- [x] Dockerfile 与 Docker Compose 配置。
- [x] GitHub Actions CI 工作流。
- [x] Node.js 最低版本与 pnpm 版本要求保持一致。

## 4. 本地验证结果

- [x] Core、API、CLI、Web 四个工作区 TypeScript 类型检查通过。
- [x] Core 测试 29/29 通过。
- [x] API 测试 18/18 通过。
- [x] CLI 测试 3/3 通过。
- [x] Web 测试 5/5 通过。
- [x] 两组 manifest 端到端冒烟测试通过。
- [x] portable Web production build 通过。
- [x] Windows 无 AI Key 启动路径通过。
- [x] 本地 Markdown 链接与 YAML 配置解析通过。

标准 Vite 构建由 GitHub Actions 在干净的 Node.js 22 环境中执行。本地 portable builder 是受限 Windows 环境的后备验证路径，不替代远程 CI。

## 5. 公开发布排除项

以下内容不属于源码交付，也不得进入公开仓库：

- [x] `node_modules/` 和包管理器缓存。
- [x] `dist/`、coverage、测试编译目录及其他生成物。
- [x] 本地分析历史 JSON。
- [x] `.env`、真实 DeepSeek API Key 或其他凭据。
- [x] 日志、临时报告和本机 Git 元数据。
- [x] 用户目录绝对路径和其他机器特定信息。

## 6. 发布后验收

公开仓库建立后应检查：

- 默认分支为 `main`；
- 仓库可见性为 Public；
- README 中英文入口、Mermaid 图和文档链接可正常打开；
- GitHub Actions 首次构建通过；
- 仓库 About 描述和 Topics 已设置；
- `git status` 保持干净，后续运行产生的历史和 Key 不会被跟踪。
