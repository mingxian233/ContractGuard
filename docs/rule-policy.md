# 规则策略、评分与输入指纹

ContractGuard 1.1.0 支持通过 JSON 策略启用或关闭指定规则、调整 finding 严重等级，并修改各严重等级的评分权重。每次新分析还会记录输入与最终策略的 SHA-256 指纹，便于证明报告对应哪两份规范和哪套策略。

策略是显式治理配置，不是“忽略所有错误”的快捷方式。调整规则前应由 API 所有者、客户端负责人和发布负责人确认影响，并通过代码评审保存变更原因。

## 1. 配置文件

仓库提供：

- [`config/rule-policy.example.json`](../config/rule-policy.example.json)；
- [`config/rule-policy.schema.json`](../config/rule-policy.schema.json)。

复制本地文件：

```powershell
Copy-Item config/rule-policy.example.json config/rule-policy.local.json
```

本地 `config/*.local.json` 已被 `.gitignore` 排除。团队希望版本化策略时，可以另取明确文件名并正常提交；提交前仍应评审每一项覆盖。

## 2. 格式

```json
{
  "schemaVersion": 1,
  "id": "team-api-policy",
  "rules": {
    "OPERATION_ID_CHANGED": {
      "severity": "info"
    },
    "METADATA_CHANGED": {
      "enabled": false
    },
    "SCHEMA_UNSUPPORTED_KEYWORD_CHANGED": {
      "severity": "breaking"
    }
  },
  "scoring": {
    "breaking": 12,
    "potentially-breaking": 4,
    "non-breaking": 0,
    "info": 0
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 必填；当前策略格式版本 |
| `id` | string | 可选；1–100 个字母、数字、点、下划线或连字符，用于报告审计 |
| `rules` | object | 可选；键必须是当前规则目录中的 rule ID |
| `rules.*.enabled` | boolean | `false` 时不产生该规则的 finding |
| `rules.*.severity` | severity | 覆盖该规则 finding 的默认严重等级 |
| `scoring` | object | 可选；覆盖一个或多个严重等级的扣分权重，数值为 0–100 |

允许的严重等级为 `breaking`、`potentially-breaking`、`non-breaking` 和 `info`。未知规则、未知字段、非法 ID 或范围外权重会被拒绝，不会被静默忽略。

默认权重为：

| Severity | 每条 finding 扣分 |
| --- | ---: |
| `breaking` | 12 |
| `potentially-breaking` | 4 |
| `non-breaking` | 0 |
| `info` | 0 |

得分为 `max(0, 100 - finding 权重总和)`。`compatible` 仍只取决于应用策略后是否存在 `breaking` finding。因此把规则重分类会同时改变摘要、得分、`compatible` 和 CLI 门禁结果；这类修改必须被当作发布策略变更审查。

## 3. CLI 使用

```bash
pnpm contractguard compare \
  fixtures/petstore-v1.yaml \
  fixtures/petstore-v2-breaking.yaml \
  --policy config/rule-policy.local.json \
  --format markdown \
  --output contractguard-report.md \
  --fail-on breaking
```

`--policy` 文件最大 64 KiB。文件不可读、JSON 非法或字段未通过验证时，CLI 以执行错误结束，不会退回默认策略继续发布。

`--fail-on` 与规则策略是两个层次：策略决定产生哪些 finding、它们的 severity 及分数；`--fail-on` 决定哪些 severity 触发 CLI 退出码 `2`。

## 4. API 与 Docker

API 进程通过环境变量加载同一格式：

```powershell
$env:CONTRACTGUARD_POLICY_CONFIG = './config/rule-policy.local.json'
pnpm start
```

Docker Compose 会把 `config/` 挂载到 `/app/config`，可在 `.env` 中设置：

```dotenv
CONTRACTGUARD_POLICY_CONFIG=./config/rule-policy.local.json
```

API 在启动时读取并验证策略。修改文件后需要重启服务；当前版本不支持请求级任意策略，也不会让浏览器上传策略文件，从而避免未授权调用方改变门禁口径。

## 5. 指纹与审计

ContractGuard 1.1.0 及之后生成的结果包含：

```json
{
  "engineVersion": "1.1.0",
  "policy": {
    "id": "team-api-policy",
    "fingerprint": {
      "algorithm": "sha256",
      "value": "...64 hexadecimal characters..."
    }
  },
  "source": {
    "old": {
      "openapi": "3.1.0",
      "fingerprint": { "algorithm": "sha256", "value": "..." }
    },
    "new": {
      "openapi": "3.1.0",
      "fingerprint": { "algorithm": "sha256", "value": "..." }
    }
  }
}
```

- 文本输入按实际输入字节计算 SHA-256；对象输入先进行稳定规范化再计算。
- 策略指纹针对补齐审计 ID、空 rules 与空 scoring 后的规范化策略。
- 默认策略也会记录 `contractguard-default` 及其指纹。
- 指纹用于相等性与审计，不表示内容安全、来源可信或已由某人签名。
- 1.0.x 保存的旧历史可能没有 `policy` 或 `source.*.fingerprint`，客户端和集成应容忍这些字段缺失。

Markdown 与 HTML 报告会显示策略和输入 SHA-256。分享报告时，哈希通常不会还原原始规范，但仍应按组织的信息分级规则处理分析内容。

## 6. 推荐治理流程

1. 从默认策略开始，只为已有实际案例的规则创建覆盖；
2. 为每次 `enabled: false` 或 severity 降级记录原因、负责人和复查日期；
3. 在 Pull Request 中同时评审策略 diff 与示例分析结果；
4. 固定策略文件并保存报告中的策略指纹；
5. 升级 ContractGuard 后检查新增规则，再决定是否调整策略；
6. 不要用零权重或大范围禁用替代消费者契约测试和人工评审。
