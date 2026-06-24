<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { normalizeCountryCodeForFlag } from '@/utils/countryDisplay'

/**
 * 国旗图标组件
 * 使用 flag-icons 库，本地 SVG 国旗，无需网络请求
 * CSS 懒加载：仅在组件首次使用时导入 flag-icons CSS，避免全量加载到首屏
 */

// 确保 flag-icons CSS 只加载一次
let cssLoaded = false
async function ensureFlagCssLoaded() {
  if (!cssLoaded) {
    cssLoaded = true
    await import('flag-icons/css/flag-icons.min.css')
  }
}

interface Props {
  code: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm'
})

// 尺寸映射
const sizeClasses = {
  xs: 'w-4 h-3',
  sm: 'w-5 h-4',
  md: 'w-6 h-4',
  lg: 'w-8 h-6'
}

// 生成 flag-icons 类名
const resolvedCode = computed(() => normalizeCountryCodeForFlag(props.code))
const flagClass = computed(() => `fi fi-${resolvedCode.value}`)

// 组件挂载时懒加载 flag-icons CSS
onMounted(() => {
  ensureFlagCssLoaded()
})
</script>

<template>
  <span
    :class="[flagClass, sizeClasses[size], 'inline-block bg-cover bg-center rounded-sm']"
    :title="resolvedCode.toUpperCase()"
  ></span>
</template>
