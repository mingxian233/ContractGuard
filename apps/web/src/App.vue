<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AiReportInterpreter from './components/AiReportInterpreter.vue'
import ChangeList from './components/ChangeList.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import RuleDrawer from './components/RuleDrawer.vue'
import SpecPanel from './components/SpecPanel.vue'
import SummaryCards from './components/SummaryCards.vue'
import {
  ApiError,
  checkHealth,
  createAnalysis,
  deleteAnalysis,
  downloadReport,
  getAnalysis,
  listAnalyses,
  listRules,
} from './api'
import { sampleBaseline, sampleCandidate } from './samples'
import type { AnalysisRecord, ExportFormat, RuleDefinition, ViewName } from './types'
import { formatDate } from './utils'

const view = ref<ViewName>('analyze')
const baseline = ref('')
const candidate = ref('')
const baselineName = ref('baseline.yaml')
const candidateName = ref('candidate.yaml')
const activeAnalysis = ref<AnalysisRecord | null>(null)
const history = ref<AnalysisRecord[]>([])
const rules = ref<RuleDefinition[]>([])
const isAnalyzing = ref(false)
const historyLoading = ref(false)
const rulesLoading = ref(false)
const rulesOpen = ref(false)
const apiOnline = ref<boolean | null>(null)
const toast = ref<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
const exportOpen = ref(false)

const hasSpecs = computed(() => Boolean(baseline.value.trim() && candidate.value.trim()))

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  toast.value = { message, type }
  window.setTimeout(() => {
    if (toast.value?.message === message) toast.value = null
  }, 4200)
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message
  return '操作未完成，请检查 API 服务与输入内容。'
}

function loadExample(): void {
  baseline.value = sampleBaseline
  candidate.value = sampleCandidate
  baselineName.value = 'campus-events-v1.4.yaml'
  candidateName.value = 'campus-events-v2.0.yaml'
  activeAnalysis.value = null
  view.value = 'analyze'
  showToast('已载入 Campus Events API 演示规范。', 'success')
}

function clearWorkspace(): void {
  baseline.value = ''
  candidate.value = ''
  baselineName.value = 'baseline.yaml'
  candidateName.value = 'candidate.yaml'
  activeAnalysis.value = null
}

async function runAnalysis(): Promise<void> {
  if (!hasSpecs.value || isAnalyzing.value) return
  isAnalyzing.value = true
  try {
    activeAnalysis.value = await createAnalysis({
      baseline: baseline.value,
      candidate: candidate.value,
      baselineName: baselineName.value,
      candidateName: candidateName.value,
    })
    apiOnline.value = true
    showToast('分析完成，报告已保存到历史记录。', 'success')
    void refreshHistory()
    requestAnimationFrame(() => document.querySelector('#analysis-results')?.scrollIntoView({ behavior: 'smooth' }))
  } catch (error) {
    apiOnline.value = error instanceof ApiError
    showToast(friendlyError(error), 'error')
  } finally {
    isAnalyzing.value = false
  }
}

async function refreshHistory(): Promise<void> {
  historyLoading.value = true
  try {
    history.value = await listAnalyses()
    apiOnline.value = true
  } catch (error) {
    showToast(friendlyError(error), 'error')
  } finally {
    historyLoading.value = false
  }
}

async function openHistory(analysis: AnalysisRecord): Promise<void> {
  try {
    activeAnalysis.value = await getAnalysis(analysis.id)
    view.value = 'analyze'
  } catch (error) {
    showToast(friendlyError(error), 'error')
  }
}

async function removeHistory(analysis: AnalysisRecord): Promise<void> {
  if (!window.confirm(`确认删除分析记录 ${analysis.id}？该操作无法撤销。`)) return
  try {
    await deleteAnalysis(analysis.id)
    history.value = history.value.filter((item) => item.id !== analysis.id)
    if (activeAnalysis.value?.id === analysis.id) activeAnalysis.value = null
    showToast('分析记录已删除。', 'success')
  } catch (error) {
    showToast(friendlyError(error), 'error')
  }
}

async function openRules(): Promise<void> {
  rulesOpen.value = true
  if (rules.value.length) return
  rulesLoading.value = true
  try {
    rules.value = await listRules()
  } catch (error) {
    showToast(friendlyError(error), 'error')
  } finally {
    rulesLoading.value = false
  }
}

async function exportReport(format: ExportFormat): Promise<void> {
  if (!activeAnalysis.value) return
  exportOpen.value = false
  try {
    await downloadReport(activeAnalysis.value, format)
    showToast(`已生成 ${format.toUpperCase()} 报告。`, 'success')
  } catch (error) {
    showToast(friendlyError(error), 'error')
  }
}

function switchView(next: ViewName): void {
  view.value = next
  if (next === 'history') void refreshHistory()
}

onMounted(async () => {
  apiOnline.value = await checkHealth()
  if (apiOnline.value) void refreshHistory()
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="ContractGuard 首页" @click.prevent="switchView('analyze')">
        <span class="brand-mark" aria-hidden="true">CG</span>
        <span><strong>ContractGuard</strong><small>OpenAPI compatibility</small></span>
      </a>

      <nav aria-label="主导航">
        <button :class="{ active: view === 'analyze' }" type="button" @click="switchView('analyze')">
          新建分析
        </button>
        <button :class="{ active: view === 'history' }" type="button" @click="switchView('history')">
          分析历史
          <b v-if="history.length">{{ history.length }}</b>
        </button>
        <button type="button" @click="openRules">
          规则目录
        </button>
      </nav>

      <div class="sidebar-info">
        <span class="status-dot" :class="{ online: apiOnline === true, offline: apiOnline === false }"></span>
        <div>
          <strong>{{ apiOnline === null ? '正在检测服务' : apiOnline ? '分析引擎在线' : '分析引擎离线' }}</strong>
          <small>OpenAPI 3.0 / 3.1</small>
        </div>
      </div>
      <p class="version">规则引擎 v1.0</p>
    </aside>

    <main>
      <header class="topbar">
        <button class="mobile-brand" type="button" aria-label="返回新建分析" @click="switchView('analyze')">
          <span class="brand-mark" aria-hidden="true">CG</span> ContractGuard
        </button>
        <nav class="mobile-nav" aria-label="移动端主导航">
          <button type="button" :aria-current="view === 'analyze' ? 'page' : undefined" :class="{ active: view === 'analyze' }" @click="switchView('analyze')">分析</button>
          <button type="button" :aria-current="view === 'history' ? 'page' : undefined" :class="{ active: view === 'history' }" @click="switchView('history')">历史</button>
          <button type="button" :aria-expanded="rulesOpen" @click="openRules">规则</button>
        </nav>
        <div class="topbar-spacer"></div>
        <button class="text-button" type="button" @click="openRules">规则说明</button>
        <span class="github-link" aria-label="本地运行模式">本地运行</span>
      </header>

      <div class="content">
        <template v-if="view === 'analyze'">
          <section class="page-heading page-heading--hero">
            <div>
              <h1>OpenAPI 兼容性分析</h1>
              <p>上传当前版本和待发布版本，检查可能影响现有调用方的契约变更。</p>
            </div>
            <div class="hero-actions">
              <button class="button button--quiet" type="button" @click="loadExample">载入演示规范</button>
              <button v-if="baseline || candidate || activeAnalysis" class="text-button danger-text" type="button" @click="clearWorkspace">清空</button>
            </div>
          </section>

          <section class="workspace" aria-labelledby="workspace-title">
            <div class="section-heading">
              <div>
                <h2 id="workspace-title">输入规范</h2>
              </div>
              <div class="direction-legend"><span>当前版本</span><i>→</i><span>待发布版本</span></div>
            </div>

            <div class="spec-grid">
              <SpecPanel
                v-model="baseline"
                v-model:file-name="baselineName"
                title="基线规范"
                eyebrow="当前版本"
                accent="baseline"
                @error="showToast($event, 'error')"
              />
              <div class="compare-arrow" aria-hidden="true">→</div>
              <SpecPanel
                v-model="candidate"
                v-model:file-name="candidateName"
                title="候选规范"
                eyebrow="待发布版本"
                accent="candidate"
                @error="showToast($event, 'error')"
              />
            </div>

            <div class="analyze-bar">
              <p>规则分析在本机执行；只有主动生成 AI 解读时才会发送裁剪后的结果。</p>
              <button class="button button--primary" type="button" :disabled="!hasSpecs || isAnalyzing" @click="runAnalysis">
                <span v-if="isAnalyzing" class="spinner"></span>
                {{ isAnalyzing ? '正在分析…' : '运行兼容性分析' }}
              </button>
            </div>
          </section>

          <section v-if="activeAnalysis" id="analysis-results" class="results">
            <div class="section-heading report-heading">
              <div>
                <p class="eyebrow">分析报告 · {{ formatDate(activeAnalysis.createdAt) }}</p>
                <h2>{{ activeAnalysis.baselineName }} <span>→</span> {{ activeAnalysis.candidateName }}</h2>
              </div>
              <div class="export-menu">
                <button class="button button--quiet" type="button" :aria-expanded="exportOpen" @click="exportOpen = !exportOpen">
                  导出报告 <span aria-hidden="true">⌄</span>
                </button>
                <div v-if="exportOpen" class="export-popover">
                  <button type="button" @click="exportReport('markdown')">Markdown <small>便于评审</small></button>
                  <button type="button" @click="exportReport('html')">HTML <small>独立分享</small></button>
                  <button type="button" @click="exportReport('json')">JSON <small>CI 集成</small></button>
                </div>
              </div>
            </div>
            <SummaryCards :analysis="activeAnalysis" />
            <ChangeList :key="activeAnalysis.id" :analysis="activeAnalysis" />
            <AiReportInterpreter :key="activeAnalysis.id" :analysis-id="activeAnalysis.id" />
          </section>
        </template>

        <HistoryPanel
          v-else
          :analyses="history"
          :loading="historyLoading"
          @open="openHistory"
          @remove="removeHistory"
          @refresh="refreshHistory"
        />
      </div>
    </main>

    <RuleDrawer :open="rulesOpen" :rules="rules" :loading="rulesLoading" @close="rulesOpen = false" />

    <Transition name="toast">
      <div v-if="toast" class="toast" :class="`toast--${toast.type}`" :role="toast.type === 'error' ? 'alert' : 'status'" aria-live="polite">
        <span>{{ toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i' }}</span>
        {{ toast.message }}
        <button type="button" aria-label="关闭通知" @click="toast = null">×</button>
      </div>
    </Transition>
  </div>
</template>
