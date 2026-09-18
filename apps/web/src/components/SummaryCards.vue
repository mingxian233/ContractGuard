<script setup lang="ts">
import type { AnalysisRecord } from '../types'

defineProps<{ analysis: AnalysisRecord }>()
</script>

<template>
  <div class="summary-grid" aria-label="分析摘要">
    <article class="score-card" :class="analysis.compatible ? 'is-pass' : 'is-fail'">
      <div class="score-ring" :style="{ '--score': `${analysis.score * 3.6}deg` }">
        <div>
          <strong>{{ analysis.score }}</strong>
          <span>/ 100</span>
        </div>
      </div>
      <div>
        <p class="eyebrow">兼容性评分</p>
        <h3>{{ analysis.compatible ? '通过兼容性门禁' : '发现阻断性变更' }}</h3>
        <p>评分用于风险排序；最终决策应结合调用方使用方式。</p>
      </div>
    </article>

    <article class="metric-card metric-card--danger">
      <div><strong>{{ analysis.summary.breaking }}</strong><span>破坏性变更</span></div>
    </article>
    <article class="metric-card metric-card--warning">
      <div><strong>{{ analysis.summary.potentiallyBreaking }}</strong><span>潜在风险</span></div>
    </article>
    <article class="metric-card metric-card--success">
      <div><strong>{{ analysis.summary.nonBreaking }}</strong><span>兼容变更</span></div>
    </article>
    <article class="metric-card metric-card--neutral">
      <div><strong>{{ analysis.summary.info }}</strong><span>信息提示</span></div>
    </article>
  </div>
</template>
