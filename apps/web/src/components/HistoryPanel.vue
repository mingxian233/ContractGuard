<script setup lang="ts">
import type { AnalysisRecord } from '../types'
import { formatDate } from '../utils'

defineProps<{
  analyses: AnalysisRecord[]
  loading: boolean
}>()

const emit = defineEmits<{
  open: [analysis: AnalysisRecord]
  remove: [analysis: AnalysisRecord]
  refresh: []
}>()
</script>

<template>
  <section class="history-view">
    <div class="page-heading">
      <div>
        <h1>分析历史</h1>
        <p>保留每次契约比较的风险快照，便于复核与团队协作。</p>
      </div>
      <button class="button button--quiet" type="button" :disabled="loading" @click="emit('refresh')">
        {{ loading ? '刷新中…' : '刷新记录' }}
      </button>
    </div>

    <div v-if="loading && !analyses.length" class="loading-card" aria-live="polite">
      <span class="spinner"></span> 正在载入分析记录…
    </div>

    <div v-else-if="analyses.length" class="history-table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>规范对比</th>
            <th>时间</th>
            <th>评分</th>
            <th>变更概览</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="analysis in analyses" :key="analysis.id">
            <td>
              <button class="history-title" type="button" @click="emit('open', analysis)">
                <strong>{{ analysis.baselineName }}</strong>
                <span>→</span>
                <strong>{{ analysis.candidateName }}</strong>
              </button>
              <code>{{ analysis.id }}</code>
            </td>
            <td>{{ formatDate(analysis.createdAt) }}</td>
            <td><span class="score-badge" :class="analysis.compatible ? 'pass' : 'fail'">{{ analysis.score }}</span></td>
            <td>
              <div class="history-counts">
                <span class="danger">{{ analysis.summary.breaking }} 破坏</span>
                <span class="warning">{{ analysis.summary.potentiallyBreaking }} 风险</span>
                <span>{{ analysis.summary.total }} 总计</span>
              </div>
            </td>
            <td class="history-actions">
              <button class="icon-button" type="button" title="查看报告" :aria-label="`查看 ${analysis.candidateName} 的分析报告`" @click="emit('open', analysis)">↗</button>
              <button class="icon-button icon-button--danger" type="button" title="删除记录" :aria-label="`删除 ${analysis.candidateName} 的分析记录`" @click="emit('remove', analysis)">×</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty-state">
      <span aria-hidden="true">◫</span>
      <h3>还没有分析记录</h3>
      <p>完成第一次 OpenAPI 对比后，结果会出现在这里。</p>
    </div>
  </section>
</template>
