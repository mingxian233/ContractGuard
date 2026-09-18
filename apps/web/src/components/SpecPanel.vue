<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  modelValue: string
  title: string
  eyebrow: string
  fileName: string
  accent: 'baseline' | 'candidate'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:fileName': [value: string]
  error: [message: string]
}>()

const input = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

async function loadFile(file?: File): Promise<void> {
  if (!file) return
  const allowed = /\.(ya?ml|json)$/i.test(file.name)
  if (!allowed) {
    emit('error', '请选择 .yaml、.yml 或 .json 格式的 OpenAPI 文件。')
    return
  }
  try {
    emit('update:modelValue', await file.text())
    emit('update:fileName', file.name)
  } catch {
    emit('error', `无法读取文件：${file.name}`)
  }
}

async function onInput(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  await loadFile(target.files?.[0])
  target.value = ''
}

function onDrop(event: DragEvent): void {
  isDragging.value = false
  void loadFile(event.dataTransfer?.files[0])
}
</script>

<template>
  <section
    class="spec-panel"
    :class="[`spec-panel--${accent}`, { 'is-dragging': isDragging }]"
    @dragenter.prevent="isDragging = true"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <header class="spec-panel__header">
      <div>
        <p class="eyebrow">{{ eyebrow }}</p>
        <h3>{{ title }}</h3>
      </div>
      <span class="format-pill">YAML / JSON</span>
    </header>

    <div class="file-row">
      <div class="file-name" :title="fileName">
        <span class="file-icon" aria-hidden="true">⌁</span>
        <span>{{ fileName || '尚未选择文件' }}</span>
      </div>
      <button class="button button--quiet button--small" type="button" @click="input?.click()">
        导入文件
      </button>
      <input
        ref="input"
        class="sr-only"
        type="file"
        accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml"
        :aria-label="`导入${title}`"
        @change="onInput"
      />
    </div>

    <label class="editor-wrap">
      <span class="sr-only">{{ title }}内容</span>
      <textarea
        class="spec-editor"
        spellcheck="false"
        :value="props.modelValue"
        :placeholder="`在此粘贴${title}，或拖拽文件到面板`"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>
    <footer class="spec-panel__footer">
      <span>可拖拽规范文件到此处</span>
      <span>{{ modelValue.length.toLocaleString() }} 字符</span>
    </footer>
  </section>
</template>
