<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { generateAiReview, getAiStatus } from '../api'
import type { AiReviewReport, AiRiskLevel, AiServiceStatus } from '../types'
import { formatDate } from '../utils'

const props = defineProps<{ analysisId: string }>()

const focus = ref('')
const status = ref<AiServiceStatus | null>(null)
const report = ref<AiReviewReport | null>(null)
const statusLoading = ref(true)
const generating = ref(false)
const statusError = ref('')
const reviewError = ref('')
let requestSequence = 0

const riskLabels: Record<AiRiskLevel, string> = {
  critical: '严重风险',
  high: '高风险',
  medium: '中等风险',
  low: '低风险',
}

const focusLength = computed(() => focus.value.length)
const canGenerate = computed(() => status.value?.available === true && !generating.value)
const statusLabel = computed(() => {
  if (statusLoading.value) return '正在检测 AI 服务'
  if (statusError.value) return '状态检测失败'
  if (!status.value?.enabled) return '功能未启用'
  if (!status.value.configured) return '等待 API 配置'
  if (!status.value.available) return '服务暂不可用'
  return 'DeepSeek 已就绪'
})
const statusTone = computed(() => {
  if (statusLoading.value) return 'checking'
  if (statusError.value || (status.value?.enabled && status.value.configured && !status.value.available)) return 'error'
  if (!status.value?.enabled || !status.value.configured) return 'inactive'
  return 'ready'
})
const tokenTotal = computed(() => {
  const usage = report.value?.usage
  if (!usage) return undefined
  return usage.totalTokens ??
    ((usage.promptTokens ?? usage.inputTokens) !== undefined &&
    (usage.completionTokens ?? usage.outputTokens) !== undefined
      ? (usage.promptTokens ?? usage.inputTokens ?? 0) +
        (usage.completionTokens ?? usage.outputTokens ?? 0)
      : undefined)
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求未完成，请稍后重试。'
}

async function loadStatus(): Promise<void> {
  statusLoading.value = true
  statusError.value = ''
  try {
    status.value = await getAiStatus()
  } catch (error) {
    status.value = null
    statusError.value = errorMessage(error)
  } finally {
    statusLoading.value = false
  }
}

async function generate(): Promise<void> {
  if (!canGenerate.value) return
  const sequence = ++requestSequence
  const analysisId = props.analysisId
  generating.value = true
  reviewError.value = ''
  report.value = null

  try {
    const trimmedFocus = focus.value.trim()
    const result = await generateAiReview(analysisId, {
      language: 'zh-CN',
      ...(trimmedFocus ? { focus: trimmedFocus } : {}),
    })
    if (sequence === requestSequence && analysisId === props.analysisId) report.value = result
  } catch (error) {
    if (sequence === requestSequence && analysisId === props.analysisId) {
      reviewError.value = errorMessage(error)
    }
  } finally {
    if (sequence === requestSequence) generating.value = false
  }
}

watch(
  () => props.analysisId,
  () => {
    requestSequence += 1
    focus.value = ''
    report.value = null
    reviewError.value = ''
    generating.value = false
  },
)

onMounted(() => void loadStatus())
</script>

<template>
  <section class="ai-interpreter" aria-labelledby="ai-interpreter-title">
    <header class="ai-interpreter__header">
      <div class="ai-title-block">
        <div>
          <h2 id="ai-interpreter-title">DeepSeek 解读 <span>可选</span></h2>
          <p>基于规则结果生成风险摘要、迁移步骤和测试建议，不影响兼容性结论。</p>
        </div>
      </div>
      <span class="ai-status" :class="`ai-status--${statusTone}`" role="status" aria-live="polite">
        <i aria-hidden="true"></i>{{ statusLabel }}
      </span>
    </header>

    <div v-if="statusLoading" class="ai-state-card" aria-busy="true" aria-live="polite">
      <span class="spinner"></span>
      <div><strong>正在读取 AI 服务配置</strong><p>这不会发起模型请求，也不会发送分析数据。</p></div>
    </div>

    <div v-else-if="statusError" class="ai-state-card ai-state-card--error" role="alert">
      <span aria-hidden="true">!</span>
      <div><strong>无法获取 AI 服务状态</strong><p>{{ statusError }}</p></div>
      <button class="button button--quiet button--small" type="button" @click="loadStatus">重新检测</button>
    </div>

    <div v-else-if="!status?.available" class="ai-state-card ai-state-card--setup">
      <span aria-hidden="true">⌁</span>
      <div>
        <strong>{{ status?.enabled ? (status.configured ? 'DeepSeek 暂不可用' : '还差一步：配置 DeepSeek API') : 'AI 解释器当前未启用' }}</strong>
        <p v-if="status?.reason">{{ status.reason }}</p>
        <p v-else>在 API 服务端启用 <code>CONTRACTGUARD_AI_ENABLED</code> 并设置 <code>DEEPSEEK_API_KEY</code>，重启后即可使用。</p>
        <small>密钥只保存在服务端，浏览器不会读取或保存 API Key。</small>
      </div>
      <button class="button button--quiet button--small" type="button" @click="loadStatus">重新检测</button>
    </div>

    <template v-else>
      <div class="ai-controls">
        <div class="ai-focus-field">
          <div class="ai-focus-field__label">
            <label for="ai-review-focus">本次特别关注 <span>可选</span></label>
            <span :class="{ 'is-limit': focusLength >= 500 }">{{ focusLength }} / 500</span>
          </div>
          <textarea
            id="ai-review-focus"
            v-model="focus"
            maxlength="500"
            rows="3"
            aria-describedby="ai-focus-hint"
            placeholder="例如：重点评估移动端 v1 客户端的升级成本，以及无停机迁移方案。"
          ></textarea>
          <p id="ai-focus-hint">仅发送裁剪后的规则结果及此关注点；请勿填写密钥、个人信息或其他敏感数据。</p>
        </div>
        <div class="ai-generate-action">
          <p>{{ status.provider }} · {{ status.model }}</p>
          <button
            class="button button--ai"
            type="button"
            :disabled="!canGenerate"
            :aria-busy="generating"
            @click="generate"
          >
            <span v-if="generating" class="spinner"></span>
            {{ generating ? '正在生成解读…' : report ? '重新生成 AI 解读' : '生成 AI 解读' }}
          </button>
        </div>
      </div>

      <div v-if="generating" class="ai-generating" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <div>
          <strong>DeepSeek 正在整理报告</strong>
          <p>正在归纳重点风险、迁移次序与测试覆盖建议，请稍候。</p>
        </div>
      </div>

      <div v-else-if="reviewError" class="ai-review-error" role="alert">
        <div><strong>AI 解读生成失败</strong><p>{{ reviewError }}</p></div>
        <button class="button button--quiet button--small" type="button" @click="generate">重试</button>
      </div>

      <article v-else-if="report" class="ai-report" aria-labelledby="ai-report-headline">
        <header class="ai-report__summary">
          <div class="ai-report__meta">
            <span class="ai-risk-level" :class="`ai-risk-level--${report.overview.riskLevel}`">
              {{ riskLabels[report.overview.riskLevel] }}
            </span>
            <span>{{ report.provider }} · {{ report.model }}</span>
            <span>{{ formatDate(report.generatedAt) }}</span>
          </div>
          <h3 id="ai-report-headline">{{ report.overview.headline }}</h3>
          <p>{{ report.overview.executiveSummary }}</p>
        </header>

        <section class="ai-report__section" aria-labelledby="ai-key-risks-title">
          <div class="ai-report__section-heading">
            <div><h3 id="ai-key-risks-title">重点风险</h3></div>
            <small>{{ report.keyRisks.length }} 项</small>
          </div>
          <div v-if="report.keyRisks.length" class="ai-risk-list">
            <article v-for="risk in report.keyRisks" :key="`${risk.changeId}-${risk.title}`" class="ai-risk-card">
              <header>
                <div><span class="ai-priority" :class="`ai-priority--${risk.priority.toLowerCase()}`">{{ risk.priority }}</span><code>{{ risk.changeId }}</code></div>
                <h4>{{ risk.title }}</h4>
              </header>
              <p>{{ risk.explanation }}</p>
              <div v-if="risk.affectedConsumers.length" class="ai-chip-row" aria-label="受影响的消费者">
                <span v-for="consumer in risk.affectedConsumers" :key="consumer">{{ consumer }}</span>
              </div>
              <div class="ai-remediation"><strong>建议处置</strong><p>{{ risk.remediation }}</p></div>
            </article>
          </div>
          <p v-else class="ai-empty-copy">模型没有识别出需要单独强调的重点风险，请继续以规则报告为准。</p>
        </section>

        <section class="ai-report__section" aria-labelledby="ai-migration-title">
          <div class="ai-report__section-heading">
            <div><h3 id="ai-migration-title">建议迁移计划</h3></div>
            <small>{{ report.migrationPlan.length }} 步</small>
          </div>
          <ol v-if="report.migrationPlan.length" class="ai-plan-list">
            <li v-for="step in report.migrationPlan" :key="`${step.order}-${step.title}`">
              <span class="ai-plan-order">{{ step.order }}</span>
              <div>
                <h4>{{ step.title }}</h4>
                <ul v-if="step.actions.length">
                  <li v-for="action in step.actions" :key="action">{{ action }}</li>
                </ul>
                <div v-if="step.relatedChangeIds.length" class="ai-related-ids">
                  <span>关联变更</span><code v-for="id in step.relatedChangeIds" :key="id">{{ id }}</code>
                </div>
              </div>
            </li>
          </ol>
          <p v-else class="ai-empty-copy">本次解读没有生成迁移步骤。</p>
        </section>

        <section class="ai-report__section" aria-labelledby="ai-tests-title">
          <div class="ai-report__section-heading">
            <div><h3 id="ai-tests-title">测试建议</h3></div>
            <small>{{ report.testSuggestions.length }} 项</small>
          </div>
          <div v-if="report.testSuggestions.length" class="ai-test-grid">
            <article v-for="suggestion in report.testSuggestions" :key="suggestion.title">
              <span aria-hidden="true">✓</span>
              <div>
                <h4>{{ suggestion.title }}</h4>
                <p>{{ suggestion.details }}</p>
                <div v-if="suggestion.relatedChangeIds.length" class="ai-related-ids">
                  <code v-for="id in suggestion.relatedChangeIds" :key="id">{{ id }}</code>
                </div>
              </div>
            </article>
          </div>
          <p v-else class="ai-empty-copy">本次解读没有生成额外测试建议。</p>
        </section>

        <section v-if="report.caveats.length" class="ai-caveats" aria-labelledby="ai-caveats-title">
          <h3 id="ai-caveats-title">解读局限</h3>
          <ul><li v-for="caveat in report.caveats" :key="caveat">{{ caveat }}</li></ul>
        </section>

        <footer class="ai-report__footer">
          <span>Schema {{ report.schemaVersion }}</span>
          <span>Prompt {{ report.promptVersion }}</span>
          <span v-if="tokenTotal !== undefined">{{ tokenTotal }} tokens</span>
          <strong>AI 生成内容，请结合原始规则结果复核。</strong>
        </footer>
      </article>
    </template>
  </section>
</template>
