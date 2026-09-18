<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { RuleDefinition } from '../types'

const props = defineProps<{
  open: boolean
  rules: RuleDefinition[]
  loading: boolean
}>()

const emit = defineEmits<{ close: [] }>()
const drawer = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

watch(() => props.open, async (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    closeButton.value?.focus()
  } else {
    previouslyFocused?.focus()
    previouslyFocused = null
  }
})

onBeforeUnmount(() => previouslyFocused?.focus())

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !drawer.value) return
  const focusable = [...drawer.value.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hasAttribute('disabled'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

const labels = {
  breaking: '破坏性',
  'potentially-breaking': '潜在风险',
  'non-breaking': '兼容',
  info: '信息',
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-shell" @click.self="emit('close')">
        <aside ref="drawer" class="rule-drawer" aria-modal="true" role="dialog" aria-labelledby="rule-title" tabindex="-1" @keydown="onKeydown">
          <header>
            <div>
              <h2 id="rule-title">规则目录</h2>
              <p>每个结论均可追溯到确定性的兼容性规则。</p>
            </div>
            <button ref="closeButton" class="icon-button" type="button" aria-label="关闭规则目录" @click="emit('close')">×</button>
          </header>
          <div v-if="loading" class="loading-card"><span class="spinner"></span> 正在加载规则…</div>
          <div v-else-if="rules.length" class="rule-list">
            <article v-for="rule in rules" :key="rule.id" class="rule-item">
              <div>
                <code>{{ rule.id }}</code>
                <span class="rule-severity" :class="`severity-${rule.severity}`">{{ labels[rule.severity] }}</span>
              </div>
              <h3>{{ rule.title }}</h3>
              <p>{{ rule.description }}</p>
              <span v-if="rule.category">{{ rule.category }}</span>
            </article>
          </div>
          <div v-else class="empty-state empty-state--compact">
            <h3>暂无规则信息</h3>
            <p>后端恢复连接后可重新打开查看。</p>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
