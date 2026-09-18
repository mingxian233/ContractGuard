# 兼容性规则 / Compatibility Rules

## 1. 兼容性的判定方向

ContractGuard 默认回答的是：**已经按照 baseline 编写的调用方，在服务端升级到 candidate 后，是否仍能正常工作？** 这是一种面向 API 提供方发布的向后兼容（provider backward compatibility）判断。

规则建立在两个集合关系上：

- **请求输入：** candidate 应继续接受 baseline 所允许的请求；收窄可接受输入通常会破坏旧客户端。
- **响应输出：** candidate 最好只返回 baseline 客户端已经知道如何处理的结果；扩大可能输出的范围可能破坏严格客户端。

例如，将请求字段的枚举从 `[A, B]` 扩大到 `[A, B, C]` 通常兼容，因为旧客户端仍然只发送 A/B；将响应枚举同样扩大却可能破坏旧客户端的穷举分支。这也是规则必须保留 request/response 上下文的原因。

## 2. 风险等级

| 等级 | 含义 | 推荐动作 |
| --- | --- | --- |
| `breaking` | 从规范层面可明确构造一个曾有效、现在无效的旧客户端交互 | 阻止发布，或采用新版本路径/迁移方案 |
| `potentially-breaking` | 影响取决于客户端生成方式、解析严格度或业务语义 | 人工评审并用消费者契约测试验证 |
| `non-breaking` | 在默认方向和已分析语义下通常保持旧客户端可用 | 可发布，但仍应运行集成测试 |
| `info` | 文档、弃用标记等不直接改变线上的结构契约 | 记录并通知维护者 |

“non-breaking”只表示**当前规则没有发现结构性破坏**，不代表业务行为、性能、授权策略或线上数据一定兼容。

## 3. 规则目录

下表描述核心规则 ID 与默认口径。某些 schema 规则会根据其位于请求还是响应中给出不同等级。

### 3.1 路径与操作

| Rule ID | 变化 | 默认等级 | 理由 |
| --- | --- | --- | --- |
| `PATH_REMOVED` | 删除整个 path | `breaking` | 旧客户端无法再访问该资源 |
| `PATH_ADDED` | 新增 path | `non-breaking` | 不影响原有操作 |
| `OPERATION_REMOVED` | 删除某个 HTTP method | `breaking` | 旧调用方式不再存在 |
| `OPERATION_ADDED` | 在既有/新路径增加 method | `non-breaking` | 原操作仍保留 |

### 3.2 参数与请求体

| Rule ID | 变化 | 默认等级 | 说明 |
| --- | --- | --- | --- |
| `PARAMETER_REMOVED` | 删除既有参数定义 | `potentially-breaking` | 严格服务端可能拒绝旧客户端继续发送的参数 |
| `PARAMETER_ADDED_REQUIRED` | 新增必填参数 | `breaking` | 旧客户端不会发送它 |
| `PARAMETER_ADDED_OPTIONAL` | 新增可选参数 | `non-breaking` | 旧请求仍有效 |
| `PARAMETER_REQUIRED` | 参数由可选变为必填 | `breaking` | 旧请求可能缺失它 |
| `PARAMETER_OPTIONAL` | 参数由必填变为可选 | `non-breaking` | 扩大可接受请求集合 |
| `REQUEST_BODY_REMOVED` | 删除既有请求体 | `potentially-breaking` | 旧客户端仍可能发送 body；具体取决于服务器 |
| `REQUEST_BODY_ADDED_REQUIRED` | 无 body 的操作新增必填 body | `breaking` | 旧请求无法满足新约束 |
| `REQUEST_BODY_ADDED_OPTIONAL` | 新增可选 body | `non-breaking` | 不要求旧客户端改变 |
| `REQUEST_BODY_REQUIRED` | body 由可选变为必填 | `breaking` | 旧请求可能不带 body |
| `REQUEST_BODY_OPTIONAL` | body 由必填变为可选 | `non-breaking` | 放宽请求条件 |
| `REQUEST_MEDIA_TYPE_REMOVED` | 删除一种可接受 Content-Type | `breaking` | 使用该媒体类型的旧请求失效 |
| `REQUEST_MEDIA_TYPE_ADDED` | 新增可接受 Content-Type | `non-breaking` | 扩大输入集合 |

路径参数按 OpenAPI 要求本来就应为 required；不合法的输入文档可能被解析器先拒绝，而不是产生兼容性条目。

### 3.3 响应

| Rule ID | 变化 | 默认等级 | 说明 |
| --- | --- | --- | --- |
| `RESPONSE_STATUS_REMOVED` | 删除已声明状态码 | 2xx 为 `breaking`；其他为 `potentially-breaking` | 可能改变成功/错误流程及生成 SDK 的返回类型 |
| `RESPONSE_STATUS_ADDED` | 新增可能状态码 | 2xx 为 `potentially-breaking`；其他为 `non-breaking` | 新成功分支可能需要客户端处理；补充错误文档本身不缩窄旧契约 |
| `RESPONSE_MEDIA_TYPE_REMOVED` | 删除既有响应媒体类型 | `breaking` | 客户端可能无法获得可解析表示 |
| `RESPONSE_MEDIA_TYPE_ADDED` | 新增响应媒体类型 | `non-breaking` | 在静态契约层面保留旧表示；实际内容协商仍需测试 |

状态码判断是结构性近似。把 `201` 改为 `200`，即使 body 相同，也可能影响依赖状态码的客户端；新增 `500` 声明并不意味着服务刚开始可能失败，因此需要结合运行语义审查。

### 3.4 Schema 类型、枚举与属性

| Rule ID | 请求方向 | 响应方向 |
| --- | --- | --- |
| `SCHEMA_TYPE_CHANGED` | 类型变化通常 `breaking` | 类型变化通常 `breaking` |
| `SCHEMA_PRESENCE_CHANGED` | 从无约束 schema 变为有约束通常 `breaking` | 从有约束 schema 变为未指定通常 `breaking` |
| `SCHEMA_BOOLEAN_CHANGED` | 按 `true`/`false` 所代表的全集/空集方向判断 | 按输出集合的反方向判断 |
| `SCHEMA_ENUM_NARROWED` | `breaking`：曾可发送的值不再允许 | 通常 `non-breaking`：返回范围收窄 |
| `SCHEMA_ENUM_WIDENED` | `non-breaking`：接受更多输入 | `potentially-breaking`：客户端可能未知新值 |
| `SCHEMA_REQUIRED_PROPERTY_ADDED` | `breaking`：旧请求缺少新字段 | 通常 `non-breaking`：服务保证提供更多字段 |
| `SCHEMA_REQUIRED_PROPERTY_REMOVED` | `non-breaking`：放宽请求要求 | `breaking`：客户端依赖的字段可能缺失 |
| `SCHEMA_PROPERTY_REMOVED` | `breaking`：旧客户端可能继续发送 | `breaking`：旧客户端可能读取该字段 |
| `SCHEMA_PROPERTY_ADDED` | 可选属性通常 `non-breaking` | 通常 `non-breaking`，严格解码器场景可人工升级为潜在风险 |
| `SCHEMA_CONSTRAINT_TIGHTENED` | `breaking`：如提高 `minLength`、降低 `maximum` | 通常放宽客户端预期，但需结合关键字判断 |
| `SCHEMA_CONSTRAINT_RELAXED` | `non-breaking`：接受更多输入 | 可能扩大实际输出集合，必要时标为 `potentially-breaking` |
| `SCHEMA_UNSUPPORTED_KEYWORD_CHANGED` | `const`、`format`、`not`、条件 schema 等尚不能精确证明集合关系时标为 `potentially-breaking` | 响应方向同样标为 `potentially-breaking` 并要求评审 |

约束规则只在能够安全比较时触发。不同类型之间、正则表达式包含关系、复杂数组约束等无法仅靠数值大小判定的情况，不应伪装成精确结论。

### 3.5 鉴权与元数据

| Rule ID | 变化 | 默认等级 |
| --- | --- | --- |
| `SECURITY_STRENGTHENED` | 从无鉴权到需要鉴权，或替代方案减少 | `breaking` |
| `SECURITY_RELAXED` | 减少要求或增加无需鉴权/更多可选方案 | `non-breaking` |
| `SECURITY_SCHEME_CHANGED` | 已使用方案的 type、API key 位置/名称或 HTTP scheme 改变时为 `breaking`；bearerFormat、OpenID URL 或 OAuth flows 等变化为 `potentially-breaking` | 动态等级 |
| `OPERATION_ID_CHANGED` | 修改 operationId | `potentially-breaking` |
| `DEPRECATED_ADDED` | 标记为 deprecated | `info` |
| `DEPRECATED_REMOVED` | 取消 deprecated 标记 | `non-breaking` |
| `METADATA_CHANGED` | summary、description、title 等文本变化 | `info` |

`operationId` 不影响裸 HTTP 请求，但会改变很多代码生成器产生的方法名，因此不能简单归为纯文档变化。

服务器 URL 变化暂不作为核心规则承诺：它显然可能影响部署与发现，但 URL 往往被环境配置、反向代理或 SDK base URL 覆盖。平台可展示该差异，发布门禁应由团队策略决定。

## 4. 位置与证据

每条变更应提供机器可读且便于人类定位的 `location`，例如：

```text
paths./pets.get.parameters.query.limit.required
paths./pets.post.requestBody.content.application/json
paths./pets/{petId}.get.responses.200.content.application/json.schema.properties.id
```

`before` 与 `after` 仅保存解释该结论所需的值，避免把整份规范复制进每条结果。`recommendation` 应给出可执行建议，例如“先将字段作为 optional 发布，等待客户端完成迁移后再设为 required”。

## 5. 分数与门禁

当前兼容性分数从 100 开始：每个 `breaking` 扣 12 分，每个 `potentially-breaking` 扣 4 分，最低为 0；`non-breaking` 和 `info` 不扣分。这个权重是可解释的展示启发式，不是经验概率。分数适合用来快速比较多个变更集，但不能用“85 分”抵消一个关键的 breaking 条目。未来调整权重时应提升引擎版本并更新评估记录。

CLI 的 `--fail-on` 决定进程退出状态：

- `breaking`：发现至少一个 `breaking` 时失败；
- `potentially-breaking`：发现 `breaking` 或 `potentially-breaking` 时失败；
- `never`：分析成功即返回成功，风险仅写入报告。

CI 中建议先使用 `breaking`，在规则基准集稳定后再逐步提高门槛。

## 6. 示例解释

用 `fixtures/petstore-v1.yaml` 比较 `fixtures/petstore-v2-breaking.yaml`，预期至少覆盖以下风险：

- `/health` 被删除；
- `GET /pets` 的 `limit` 从 optional 变为 required；
- 新增必填请求头 `tenantId`；
- 请求参数 `tags` 的枚举被收窄；
- `POST /pets` 不再接受 `application/x-www-form-urlencoded`，同时新增 `application/xml`；
- `NewPet.ownerId` 成为新必填字段；
- 响应中的 `Pet.name` 被删除，`Pet.id` 从 integer 改为 string；
- 全局新增 API key 要求；
- `listPets` 的 operationId 被修改。

兼容样例则以新增可选查询参数、新增资源操作、扩大请求枚举和增加可选字段为主。它用于验证规则不会把所有文本差异都误报为 breaking。

## 7. 当前不覆盖或仅部分覆盖

- 外部和跨文件 `$ref`；
- 循环引用的完整语义等价判断；
- `oneOf`、`anyOf`、`allOf`、`not`、discriminator 的一般包含关系；
- 正则表达式语言包含关系；
- 回调、链接、webhook 的客户端影响；
- 业务错误码、速率限制、排序、分页语义和数据含义；
- 实际网关是否忽略未知参数，以及特定 SDK 的序列化/解码行为；
- 非 OpenAPI 描述的身份、权限、SLA 和性能变化。

遇到这些情况应结合消费者契约测试和人工评审。任何未来新增规则都应附带正例、反例和一个“无法确定”的边界用例。

## 8. 规则维护原则

1. 先写能构造反例的判定理由，再实现规则。
2. 对请求与响应分别测试，不能只替换提示文字。
3. 不确定时使用潜在风险或显式跳过，避免虚假精确。
4. 规则行为变化时提升引擎版本并更新 fixtures、测试和本文档。
5. 报告已知漏报和误报，不能只展示成功案例。

权威语法定义应以 [OpenAPI Specification](https://spec.openapis.org/oas/) 为准；本文描述的是 ContractGuard 的兼容策略，而不是 OpenAPI 标准的一部分。
