<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AnalysisRecord, ChangeRecord, SeverityFilter } from '../types'
import { filterChanges, prettyValue } from '../utils'

const props = defineProps<{ analysis: AnalysisRecord }>()
const severity = ref<SeverityFilter>('all')
const query = ref('')
const expanded = ref<string | null>(null)

const severityOptions: { value: SeverityFilter; label: string; count: () => number }[] = [
  { value: 'all', label: '全部', count: () => props.analysis.changes.length },
  { value: 'breaking', label: '破坏性', count: () => props.analysis.summary.breaking },
  {
    value: 'potentially-breaking',
    label: '潜在风险',
    count: () => props.analysis.summary.potentiallyBreaking,
  },
  { value: 'non-breaking', label: '兼容', count: () => props.analysis.summary.nonBreaking },
  { value: 'info', label: '信息', count: () => props.analysis.summary.info },
]

const visibleChanges = computed(() => filterChanges(props.analysis.changes, severity.value, query.value))
const hasActiveFilters = computed(() => severity.value !== 'all' || Boolean(query.value.trim()))

const labels: Record<ChangeRecord['severity'], string> = {
  breaking: '破坏性',
  'potentially-breaking': '潜在风险',
  'non-breaking': '兼容',
  info: '信息',
}

function toggle(id: string): void {
  expanded.value = expanded.value === id ? null : id
}

function clearFilters(): void {
  severity.value = 'all'
  query.value = ''
}
</script>

<template>
  <section class="changes-section">
    <div class="section-heading section-heading--stack">
      <div>
        <h2>变更明细</h2>
      </div>
      <label class="search-field">
        <span aria-hidden="true">⌕</span>
        <span class="sr-only">搜索变更</span>
        <input v-model="query" type="search" placeholder="搜索路径、规则或描述" />
      </label>
    </div>

    <div class="filter-tabs" role="group" aria-label="按严重度筛选">
      <button
        v-for="option in severityOptions"
        :key="option.value"
        type="button"
        aria-controls="change-list"
        :aria-pressed="severity === option.value"
        :class="{ active: severity === option.value }"
        @click="severity = option.value"
      >
        {{ option.label }} <span>{{ option.count() }}</span>
      </button>
    </div>

    <div id="change-list">
      <div v-if="visibleChanges.length" class="change-list">
        <article
          v-for="(change, index) in visibleChanges"
          :key="change.id"
          class="change-card"
          :class="`change-card--${change.severity}`"
        >
          <button
            class="change-card__summary"
            type="button"
            :aria-expanded="expanded === change.id"
            :aria-controls="`change-details-${index}`"
            @click="toggle(change.id)"
          >
            <span class="severity-dot" aria-hidden="true"></span>
            <span class="change-card__body">
              <span class="change-card__topline">
                <span class="severity-label">{{ labels[change.severity] }}</span>
                <code>{{ change.ruleId }}</code>
                <span>{{ change.category }}</span>
              </span>
              <strong>{{ change.message }}</strong>
              <code class="location">{{ change.location }}</code>
            </span>
            <span class="chevron" aria-hidden="true">⌄</span>
          </button>

          <div v-if="expanded === change.id" :id="`change-details-${index}`" class="change-card__details" role="region" :aria-label="`${change.message} 的变更详情`">
            <div class="diff-grid">
              <div>
                <span>变更前</span>
                <pre>{{ prettyValue(change.before) }}</pre>
              </div>
              <div>
                <span>变更后</span>
                <pre>{{ prettyValue(change.after) }}</pre>
              </div>
            </div>
            <div v-if="change.recommendation" class="recommendation">
              <span aria-hidden="true">→</span>
              <p><strong>迁移建议</strong>{{ change.recommendation }}</p>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="empty-state empty-state--compact">
        <span aria-hidden="true">⌕</span>
        <h3>{{ analysis.changes.length ? '没有匹配的变更' : '未检测到契约变更' }}</h3>
        <p>{{ analysis.changes.length ? '调整搜索词或严重度筛选条件。' : '两份规范在当前规则集下没有产生差异。' }}</p>
        <button v-if="hasActiveFilters" class="button button--quiet button--small" type="button" @click="clearFilters">清除筛选</button>
      </div>
    </div>
  </section>
</template>
