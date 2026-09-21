<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { RuleDefinition } from '../types'

const props = defineProps<{
  open: boolean
  rules: RuleDefinition[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{ close: []; retry: [] }>()
const drawer = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null
let previousBodyOverflow: string | null = null

function restoreBodyScroll(): void {
  if (previousBodyOverflow === null) return
  document.body.style.overflow = previousBodyOverflow
  previousBodyOverflow = null
}

watch(() => props.open, async (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick()
    if (props.open) closeButton.value?.focus()
  } else {
    restoreBodyScroll()
    previouslyFocused?.focus()
    previouslyFocused = null
  }
})

onBeforeUnmount(() => {
  restoreBodyScroll()
  previouslyFocused?.focus()
})

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
        <aside ref="drawer" class="rule-drawer" aria-modal="true" role="dialog" aria-labelledby="rule-title" aria-describedby="rule-description" tabindex="-1" @keydown="onKeydown">
          <header>
            <div>
              <h2 id="rule-title">规则目录</h2>
              <p id="rule-description">每个结论均可追溯到确定性的兼容性规则。</p>
            </div>
            <button ref="closeButton" class="icon-button" type="button" aria-label="关闭规则目录" @click="emit('close')">×</button>
          </header>
          <div v-if="loading" class="loading-card" aria-busy="true" aria-live="polite"><span class="spinner"></span> 正在加载规则…</div>
          <div v-else-if="error" class="inline-error inline-error--drawer" role="alert">
            <div><strong>规则目录加载失败</strong><p>{{ error }}</p></div>
            <button class="button button--quiet button--small" type="button" @click="emit('retry')">重试</button>
          </div>
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
