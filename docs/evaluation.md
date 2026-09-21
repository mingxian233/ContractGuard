# 评估方案与实验记录 / Evaluation

## 1. 目的

本文件定义一个可复现的评估方法，用来回答 ContractGuard 是否“找得对、说得清、跑得稳”。它不是营销材料。除非实际命令已运行、原始结果已保存，否则不得填写或引用准确率、性能等数字。

## 2. 研究问题

- **RQ1 — Detection correctness：** 对已标注的契约变化，工具识别 breaking 与 potentially-breaking 风险的 precision/recall 如何？
- **RQ2 — Directionality：** 同一 schema 改动位于 request 与 response 时，风险方向是否正确？
- **RQ3 — Consistency：** 核心包、REST API 和 CLI 对同一输入是否给出相同语义结果？
- **RQ4 — Reproducibility：** 相同引擎版本与输入重复运行，除 ID/时间戳外是否一致？
- **RQ5 — Performance：** 随规范规模增长，运行时间和峰值内存如何变化？
- **RQ6 — Explainability：** 结果是否给出足够的位置、证据与建议，使评审者能独立复核？

## 3. 评估单位

不能只把“一对文件是否被判为不兼容”作为样本，因为一个文件对中可能包含十余种变化。主要评估单位应是一个人工构造或真实提取的**原子契约变化**，标签至少包含：

```json
{
  "caseId": "request-required-parameter-001",
  "direction": "request",
  "expectedRuleId": "PARAMETER_REQUIRED",
  "expectedSeverity": "breaking",
  "expectedLocationContains": "limit",
  "rationale": "A previously valid request can omit the parameter."
}
```

组合 fixture（例如 Petstore）用于端到端回归；原子 fixture 用于计算指标。不要把同一组合文件触发的十条变化算成十个完全独立的真实系统样本而忽略相关性。

## 4. 数据集设计

### 4.1 最低覆盖矩阵

每条规则至少准备以下用例：

1. 预期触发的标准正例；
2. 不应触发的相邻反例；
3. request 与 response（若适用）；
4. 内联 schema 与本地 `$ref`；
5. 缺省字段与显式缺省值；
6. 一个实现无法可靠判断的边界例，用于确认不会产生过度确定结论。

优先覆盖：路径/操作、参数 required、请求体、媒体类型、响应状态、类型、枚举、required properties、约束、security 和 operationId。

### 4.2 当前演示 fixture

| Baseline | Candidate | 用途 |
| --- | --- | --- |
| `petstore-v1.yaml` | `petstore-v2-breaking.yaml` | 多类高风险变化的集成演示 |
| `petstore-v1.yaml` | `petstore-v2-compatible.yaml` | 新增可选能力、避免“所有差异都报错” |

这三份文件方便演示，但规模太小、来源单一，**不能单独支持泛化准确率结论**。若要公开报告指标，应另建至少几十个原子变化，并由两名标注者独立复核一部分样本。

`fixtures/evaluation-manifest.json` 保存这两组集成样例的最低预期。它适合 smoke test：检查若干关键规则必须出现、兼容样例不应出现高风险；它不包含足够样本来计算有意义的 precision/recall。

### 4.3 真实样本

可从版本化的公开 OpenAPI 仓库提取相邻发布版，但需：

- 记录仓库、commit/tag、许可证和提取日期；
- 先确认差异不是生成器排序或格式噪声；
- 将无法从公开上下文判断的行为标为 `uncertain`，不强行放入正/负类；
- 防止同一项目大量相似变化导致数据泄漏；按项目划分训练/调试与最终测试集（即使本项目不是机器学习模型，也能避免围绕单一代码库过拟合规则）。

## 5. Gold label 流程

1. 标注者先阅读 baseline/candidate 和兼容方向定义，但不看工具输出；
2. 独立填写 ruleId、severity、location 与理由；
3. 对分歧样本记录双方理由，再由第三次评审或规则维护者裁决；
4. 保存原始标注和裁决记录，而不是只保留最终答案；
5. 在修改规则后，不得静默重写旧标签；应记录标签版本和变更理由。

可选报告 Cohen's kappa 作为标注一致性参考，但对类别极不均衡的数据还应展示原始混淆矩阵。

## 6. 指标

### 6.1 检出指标

把 `breaking` 和 `potentially-breaking` 分开报告，同时可以提供“需要人工处理”的合并视图。

```text
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2 * precision * recall / (precision + recall)
```

匹配不能只看 severity；至少同时匹配 `ruleId` 与规范位置。位置允许标准化后的等价形式，但规则要预先固定，避免人工挑选最有利匹配。

应按规则类别报告 macro 平均与样本加权结果。只报告总体 accuracy 容易被大量“无变化/兼容”样本掩盖。

### 6.2 严重等级混淆矩阵

报告四级标签的混淆矩阵，并重点检查：

- breaking 被预测为 non-breaking/info（高成本漏报）；
- non-breaking 被预测为 breaking（阻塞发布的误报）；
- potentially-breaking 被强行归为确定类别（过度自信）。

### 6.3 解释完整度

对每条检出结果自动检查字段：

- `ruleId` 非空；
- `location` 能定位到变更；
- `message` 说明影响而非重复标题；
- `before/after` 在适用时存在；
- breaking/potential 条目具有可执行 `recommendation`。

此外可抽样进行人工评分（1–5）：评审者是否能只凭报告解释风险并提出迁移方案。

### 6.4 性能

按 operation 数、schema 节点数和文件字节数记录，而不只写“小/中/大”。每个样本至少预热一次、正式运行多次，报告中位数与 p95；同时记录 Node 版本、CPU、内存和操作系统。

不把 YAML 读取时间与远程下载混在一起。默认禁用网络引用，因此基准不受网络波动影响。

## 7. 可复现实验步骤

### 7.1 固定环境

```bash
node --version
pnpm --version
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

保存以上输出，并记录操作系统、CPU 与可用内存。

### 7.2 运行演示用例

```bash
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-breaking.yaml --format json --output artifacts/petstore-breaking.json --fail-on never
pnpm contractguard compare fixtures/petstore-v1.yaml fixtures/petstore-v2-compatible.yaml --format json --output artifacts/petstore-compatible.json --fail-on never
```

### 7.3 一致性检查

对同一 fixture：

1. 直接调用核心分析函数；
2. 通过 `POST /api/analyses`；
3. 通过 CLI 输出 JSON；
4. 删除 `id`、`generatedAt`、持久化时间等非语义字段；
5. 对 `changes` 按 `ruleId + location + severity` 排序后深比较。

差异必须解释。不能简单把不一致字段加入忽略列表。

### 7.4 重复性检查

对同一输入连续运行 20 次，规范化非确定字段后计算输出哈希。预期只有一个唯一哈希。若结果顺序依赖对象遍历或并行调度，应在引擎中稳定排序。

## 8. 预期断言（演示集）

breaking 候选至少应检出：

- `PATH_REMOVED` 或等价的 `/health` 操作删除；
- `PARAMETER_REQUIRED`（`limit`）；
- `PARAMETER_ADDED_REQUIRED`（`tenantId`）；
- `REQUEST_MEDIA_TYPE_REMOVED`（`application/x-www-form-urlencoded`）；
- `SCHEMA_REQUIRED_PROPERTY_ADDED`（请求中的 `ownerId`）；
- `SCHEMA_TYPE_CHANGED`（响应中的 `id`，以及错误结构中的 `code`）；
- `SCHEMA_PROPERTY_REMOVED`（响应中的 `name`）；
- `SECURITY_STRENGTHENED`；
- `OPERATION_ID_CHANGED`。

兼容候选不应产生 `breaking`。它可以包含 `non-breaking` 与 `info` 变化；若对新增响应字段采用严格客户端口径，也可以出现有明确说明的 `potentially-breaking`。

这些断言用于端到端回归，不等于所有规则的完整评估。

### 8.1 当前 smoke test 记录

2026-09-21 使用引擎 `1.0.1`、Node `v24.21.0` 和 pnpm `11.19.0`，从项目根目录运行当前 manifest 冒烟测试，得到：

| Candidate | Score | Compatible | Breaking | Potential | Non-breaking | Info | Total |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `petstore-v2-breaking.yaml` | 0 | false | 22 | 8 | 1 | 1 | 32 |
| `petstore-v2-compatible.yaml` | 100 | true | 0 | 0 | 14 | 1 | 15 |

同时确认 breaking 样例包含 manifest 中列出的九类关键结果，compatible 样例没有 high-risk 结果。该记录证明 bundled fixtures 与当前引擎能够协同运行；它不是 precision/recall 实验，也不能代表真实项目上的泛化能力。规则扩展后总数可能合理变化，但 manifest 的最低断言不应静默失效。

## 9. 实验记录模板

> 下表故意不预填结果。运行后应附上原始 JSON/日志的相对路径和 SHA-256。

| 字段 | 记录 |
| --- | --- |
| 日期 / 时区 | 未测量 |
| Git commit | 未测量 |
| Engine version | 未测量 |
| Node / pnpm | 未测量 |
| OS / CPU / RAM | 未测量 |
| Dataset label version | 未测量 |
| Cases / atomic changes | 未测量 |
| Breaking precision / recall / F1 | 未测量 |
| Potential precision / recall / F1 | 未测量 |
| Macro F1 | 未测量 |
| Median / p95 latency | 未测量 |
| Peak memory | 未测量 |
| Raw artifact path + SHA-256 | 未测量 |
| Known false positives | 未测量 |
| Known false negatives | 未测量 |

## 10. 失败案例登记

每个误报/漏报建议记录：

```text
case id:
engine version:
expected / actual:
minimal reproducer:
root cause:
user impact:
workaround:
planned rule or explicit non-goal:
```

失败案例是评估结果的一部分，不应从演示材料中删除。尤其应保留组合 schema、循环引用、外部引用和工具无法理解的业务约束样本。

## 11. 有效性威胁

- **构念有效性：** OpenAPI 结构兼容不等于运行时或业务兼容；
- **内部有效性：** 人工标签可能受标注者经验和既有实现影响；
- **外部有效性：** Petstore 与公开仓库不能代表私有微服务、生成 SDK 和所有语言生态；
- **样本独立性：** 一个组件被多个端点引用时会产生相关结果；
- **类别不平衡：** 真实版本中 info/non-breaking 变化可能远多于 breaking；
- **实现偏差：** 若在看过测试集后反复调规则，会高估泛化表现。

因此对外陈述时应写“在版本 X 的 N 个标注原子变化上”，并同时报告数据集构成与限制，而不是笼统声称“准确率达到某数字”。

## 12. 对外呈现评估结果

对外说明评估结果时，应同时提供架构图、方向性规则的推理、可复现实验、失败案例及改进方案。相比笼统声称“使用 AI 自动判断全部 API 风险”，公开规则覆盖、证据链、数据集构成和评估方法更有助于使用者判断结论是否可信。
