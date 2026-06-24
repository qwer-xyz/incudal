<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import SkeletonLoader from '@/components/SkeletonLoader.vue'

interface RechargeCard {
  id: number
  cardNo: string
  passwordMask: string
  amount: number
  batchNo: string
  status: 'unused' | 'used'
  createdBy: { id: number; username: string } | null
  createdAt: string
  usedBy: { id: number; username: string } | null
  usedAt: string | null
  rechargeRecordId: number | null
}

interface GeneratedRechargeCard {
  cardNo: string
  password: string
  amount: number
}

const props = withDefaults(defineProps<{
  embedded?: boolean
}>(), {
  embedded: false
})

const { t } = useI18n()
const toast = useToast()

const cards = ref<RechargeCard[]>([])
const loading = ref(true)
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const selectedIds = ref<number[]>([])

const filters = ref({
  status: '',
  search: '',
  batchNo: '',
  createdById: '' as number | '',
  usedById: '' as number | '',
  minAmount: '' as number | '',
  maxAmount: '' as number | '',
  createdFrom: '',
  createdTo: '',
  usedFrom: '',
  usedTo: '',
  sortBy: 'createdAt',
  sortOrder: 'desc'
})

const showGenerateModal = ref(false)
const generateLoading = ref(false)
const generateForm = ref({
  amount: 10,
  count: 1
})
const generatedBatchNo = ref('')
const generatedCards = ref<GeneratedRechargeCard[]>([])

const deletingId = ref<number | null>(null)
const exportLoading = ref(false)
const bulkDeleteLoading = ref(false)

const pageSizeOptions = [20, 50, 100]
const totalPages = computed(() => Math.ceil(total.value / pageSize.value))
const selectedIdSet = computed(() => new Set(selectedIds.value))
const currentPageIds = computed(() => cards.value.map(card => card.id))
const allCurrentPageSelected = computed(() =>
  currentPageIds.value.length > 0 && currentPageIds.value.every(id => selectedIdSet.value.has(id))
)
const selectedCount = computed(() => selectedIds.value.length)

function formatMoney(amount: number): string {
  return `¥${Number(amount || 0).toFixed(2)}`
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function getStatusClass(status: RechargeCard['status']): string {
  return status === 'used' ? 'badge-success' : 'badge-warning'
}

function resetFilters() {
  filters.value = {
    status: '',
    search: '',
    batchNo: '',
    createdById: '',
    usedById: '',
    minAmount: '',
    maxAmount: '',
    createdFrom: '',
    createdTo: '',
    usedFrom: '',
    usedTo: '',
    sortBy: 'createdAt',
    sortOrder: 'desc'
  }
  page.value = 1
  loadCards()
}

function buildListParams() {
  return {
    page: page.value,
    pageSize: pageSize.value,
    status: filters.value.status || undefined,
    search: filters.value.search.trim() || undefined,
    batchNo: filters.value.batchNo.trim() || undefined,
    createdById: filters.value.createdById || undefined,
    usedById: filters.value.usedById || undefined,
    minAmount: filters.value.minAmount === '' ? undefined : filters.value.minAmount,
    maxAmount: filters.value.maxAmount === '' ? undefined : filters.value.maxAmount,
    createdFrom: filters.value.createdFrom || undefined,
    createdTo: filters.value.createdTo || undefined,
    usedFrom: filters.value.usedFrom || undefined,
    usedTo: filters.value.usedTo || undefined,
    sortBy: filters.value.sortBy,
    sortOrder: filters.value.sortOrder
  }
}

async function loadCards() {
  loading.value = true
  try {
    const res = await api.admin.getRechargeCards(buildListParams())
    cards.value = res.cards || []
    total.value = res.total
  } catch (err: any) {
    toast.error(t('admin.rechargeCards.loadFailed') + ': ' + err.message)
  } finally {
    loading.value = false
  }
}

function openGenerateModal() {
  generateForm.value = { amount: 10, count: 1 }
  generatedBatchNo.value = ''
  generatedCards.value = []
  showGenerateModal.value = true
}

async function generateCards() {
  if (generateForm.value.amount <= 0) {
    toast.warning(t('admin.rechargeCards.invalidAmount'))
    return
  }
  if (generateForm.value.count < 1 || generateForm.value.count > 1000) {
    toast.warning(t('admin.rechargeCards.invalidCount'))
    return
  }

  generateLoading.value = true
  try {
    const res = await api.admin.createRechargeCards({
      amount: generateForm.value.amount,
      count: generateForm.value.count
    })
    generatedBatchNo.value = res.batchNo
    generatedCards.value = res.cards
    toast.success(t('admin.rechargeCards.generateSuccess'))
    page.value = 1
    await loadCards()
  } catch (err: any) {
    toast.error(t('admin.rechargeCards.generateFailed') + ': ' + err.message)
  } finally {
    generateLoading.value = false
  }
}

function formatGeneratedCard(card: GeneratedRechargeCard): string {
  return t('admin.rechargeCards.generatedCopyLine', {
    cardNo: card.cardNo,
    password: card.password,
    amount: Number(card.amount || 0).toFixed(2)
  })
}

function generatedCardsText(): string {
  return generatedCards.value.map(formatGeneratedCard).join('\n')
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
  toast.success(t('common.copied'))
}

function escapeCsvField(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function generatedCardsCsv(): string {
  const rows = [
    [
      t('admin.rechargeCards.cardNo'),
      t('admin.rechargeCards.password'),
      t('admin.rechargeCards.amount')
    ],
    ...generatedCards.value.map(card => [
      card.cardNo,
      card.password,
      Number(card.amount || 0).toFixed(2)
    ])
  ]

  return `\uFEFF${rows.map(row => row.map(escapeCsvField).join(',')).join('\r\n')}`
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportGeneratedCards() {
  if (generatedCards.value.length === 0) return
  const batchPart = generatedBatchNo.value || Date.now()
  downloadTextFile(
    `recharge-cards-${batchPart}.csv`,
    generatedCardsCsv(),
    'text/csv;charset=utf-8'
  )
  toast.success(t('admin.rechargeCards.exportSuccess'))
}

function toggleSelectCard(id: number) {
  const selected = new Set(selectedIds.value)
  if (selected.has(id)) {
    selected.delete(id)
  } else {
    selected.add(id)
  }
  selectedIds.value = Array.from(selected)
}

function toggleSelectCurrentPage() {
  const selected = new Set(selectedIds.value)
  if (allCurrentPageSelected.value) {
    for (const id of currentPageIds.value) selected.delete(id)
  } else {
    for (const id of currentPageIds.value) selected.add(id)
  }
  selectedIds.value = Array.from(selected)
}

async function exportSelected() {
  if (selectedIds.value.length === 0) {
    toast.warning(t('admin.rechargeCards.selectForExport'))
    return
  }

  exportLoading.value = true
  try {
    const csv = await api.admin.exportRechargeCards(selectedIds.value)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recharge-cards-${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(t('admin.rechargeCards.exportSuccess'))
  } catch (err: any) {
    toast.error(t('admin.rechargeCards.exportFailed') + ': ' + err.message)
  } finally {
    exportLoading.value = false
  }
}

async function deleteSelected() {
  if (selectedIds.value.length === 0) {
    toast.warning(t('admin.rechargeCards.selectForDelete'))
    return
  }
  if (!window.confirm(t('admin.rechargeCards.deleteSelectedConfirm', { count: selectedCount.value }))) return

  bulkDeleteLoading.value = true
  try {
    const res = await api.admin.deleteRechargeCards(selectedIds.value)
    const deletedIdSet = new Set(res.deletedIds || [])
    selectedIds.value = selectedIds.value.filter(id => !deletedIdSet.has(id))
    toast.success(t('admin.rechargeCards.deleteSelectedSuccess', {
      deleted: res.deleted,
      skipped: res.skippedUsed + res.notFound
    }))
    await loadCards()
  } catch (err: any) {
    toast.error(t('admin.rechargeCards.deleteSelectedFailed') + ': ' + err.message)
  } finally {
    bulkDeleteLoading.value = false
  }
}

async function deleteCard(card: RechargeCard) {
  if (card.status === 'used') return
  if (!window.confirm(t('admin.rechargeCards.deleteConfirm', { cardNo: card.cardNo }))) return

  deletingId.value = card.id
  try {
    await api.admin.deleteRechargeCard(card.id)
    selectedIds.value = selectedIds.value.filter(id => id !== card.id)
    toast.success(t('admin.rechargeCards.deleteSuccess'))
    await loadCards()
  } catch (err: any) {
    toast.error(t('admin.rechargeCards.deleteFailed') + ': ' + err.message)
  } finally {
    deletingId.value = null
  }
}

function changeSort(sortBy: string) {
  if (filters.value.sortBy === sortBy) {
    filters.value.sortOrder = filters.value.sortOrder === 'asc' ? 'desc' : 'asc'
  } else {
    filters.value.sortBy = sortBy
    filters.value.sortOrder = 'desc'
  }
  page.value = 1
  loadCards()
}

onMounted(() => {
  loadCards()
})
</script>

<template>
  <div :class="['animate-fade-in', props.embedded ? 'space-y-4' : '']">
    <div class="page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="page-title">{{ $t('admin.rechargeCards.title') }}</h1>
        <p class="text-sm text-themed-muted mt-1">{{ $t('admin.rechargeCards.description') }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-ghost" :disabled="exportLoading || selectedCount === 0" @click="exportSelected">
          {{ exportLoading ? $t('common.processing') : $t('admin.rechargeCards.exportSelected', { count: selectedCount }) }}
        </button>
        <button
          class="btn btn-ghost text-red-500"
          :disabled="bulkDeleteLoading || selectedCount === 0"
          @click="deleteSelected"
        >
          {{ bulkDeleteLoading ? $t('common.processing') : $t('admin.rechargeCards.deleteSelected', { count: selectedCount }) }}
        </button>
        <button class="btn btn-primary" @click="openGenerateModal">
          {{ $t('admin.rechargeCards.generate') }}
        </button>
      </div>
    </div>

    <div class="card p-4 md:p-5">
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input v-model="filters.search" class="input w-full" :placeholder="$t('admin.rechargeCards.searchPlaceholder')" @keyup.enter="page = 1; loadCards()" />
        <input v-model="filters.batchNo" class="input w-full" :placeholder="$t('admin.rechargeCards.batchNo')" @keyup.enter="page = 1; loadCards()" />
        <select v-model="filters.status" class="input w-full" @change="page = 1; loadCards()">
          <option value="">{{ $t('admin.rechargeCards.allStatus') }}</option>
          <option value="unused">{{ $t('admin.rechargeCards.status.unused') }}</option>
          <option value="used">{{ $t('admin.rechargeCards.status.used') }}</option>
        </select>
        <select v-model="filters.sortBy" class="input w-full" @change="page = 1; loadCards()">
          <option value="createdAt">{{ $t('admin.rechargeCards.sort.createdAt') }}</option>
          <option value="amount">{{ $t('admin.rechargeCards.sort.amount') }}</option>
          <option value="usedAt">{{ $t('admin.rechargeCards.sort.usedAt') }}</option>
          <option value="status">{{ $t('admin.rechargeCards.sort.status') }}</option>
        </select>
        <input v-model.number="filters.minAmount" type="number" min="0" step="0.01" class="input w-full" :placeholder="$t('admin.rechargeCards.minAmount')" />
        <input v-model.number="filters.maxAmount" type="number" min="0" step="0.01" class="input w-full" :placeholder="$t('admin.rechargeCards.maxAmount')" />
        <input v-model.number="filters.createdById" type="number" min="1" class="input w-full" :placeholder="$t('admin.rechargeCards.createdById')" />
        <input v-model.number="filters.usedById" type="number" min="1" class="input w-full" :placeholder="$t('admin.rechargeCards.usedById')" />
        <div class="space-y-1 sm:col-span-2">
          <label class="text-xs font-medium text-themed-muted">{{ $t('admin.rechargeCards.createdTimeRange') }}</label>
          <div class="grid gap-2 sm:grid-cols-2">
            <input v-model="filters.createdFrom" type="datetime-local" class="input w-full" :aria-label="$t('admin.rechargeCards.createdFrom')" />
            <input v-model="filters.createdTo" type="datetime-local" class="input w-full" :aria-label="$t('admin.rechargeCards.createdTo')" />
          </div>
        </div>
        <div class="space-y-1 sm:col-span-2">
          <label class="text-xs font-medium text-themed-muted">{{ $t('admin.rechargeCards.usedTimeRange') }}</label>
          <div class="grid gap-2 sm:grid-cols-2">
            <input v-model="filters.usedFrom" type="datetime-local" class="input w-full" :aria-label="$t('admin.rechargeCards.usedFrom')" />
            <input v-model="filters.usedTo" type="datetime-local" class="input w-full" :aria-label="$t('admin.rechargeCards.usedTo')" />
          </div>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div class="text-sm text-themed-muted">{{ $t('admin.billing.totalCount', { count: total }) }}</div>
        <div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" @click="resetFilters">{{ $t('common.reset') }}</button>
          <button class="btn btn-primary btn-sm" @click="page = 1; loadCards()">{{ $t('common.search') }}</button>
        </div>
      </div>
    </div>

    <SkeletonLoader v-if="loading" :count="5" />

    <div v-else-if="cards.length > 0" class="card overflow-hidden">
      <div class="flex items-center justify-between gap-4 border-b border-themed px-5 py-4">
        <div>
          <div class="text-sm font-medium text-themed">{{ $t('admin.rechargeCards.title') }}</div>
          <div class="mt-1 text-xs text-themed-muted">{{ $t('admin.rechargeCards.selectedCount', { count: selectedCount }) }}</div>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1080px] text-sm">
          <thead class="bg-themed-secondary/80">
            <tr>
              <th class="p-3 text-left">
                <input type="checkbox" class="checkbox" :checked="allCurrentPageSelected" @change="toggleSelectCurrentPage" />
              </th>
              <th class="p-3 text-left whitespace-nowrap">{{ $t('admin.rechargeCards.cardNo') }}</th>
              <th class="p-3 text-left whitespace-nowrap">{{ $t('admin.rechargeCards.passwordMask') }}</th>
              <th class="p-3 text-left whitespace-nowrap cursor-pointer" @click="changeSort('amount')">{{ $t('admin.rechargeCards.amount') }}</th>
              <th class="p-3 text-left whitespace-nowrap">{{ $t('admin.rechargeCards.batchNo') }}</th>
              <th class="p-3 text-left whitespace-nowrap">{{ $t('admin.rechargeCards.createdBy') }}</th>
              <th class="p-3 text-left whitespace-nowrap cursor-pointer" @click="changeSort('createdAt')">{{ $t('admin.rechargeCards.createdAt') }}</th>
              <th class="p-3 text-left whitespace-nowrap">{{ $t('admin.rechargeCards.usedBy') }}</th>
              <th class="p-3 text-left whitespace-nowrap cursor-pointer" @click="changeSort('usedAt')">{{ $t('admin.rechargeCards.usedAt') }}</th>
              <th class="p-3 text-left whitespace-nowrap cursor-pointer" @click="changeSort('status')">{{ $t('admin.rechargeCards.statusLabel') }}</th>
              <th class="p-3 text-left whitespace-nowrap">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in cards" :key="card.id" class="border-t border-themed hover:bg-themed-secondary/40">
              <td class="p-3">
                <input type="checkbox" class="checkbox" :checked="selectedIdSet.has(card.id)" @change="toggleSelectCard(card.id)" />
              </td>
              <td class="p-3 font-mono text-xs whitespace-nowrap">
                <button class="hover:text-blue-500" @click="copyText(card.cardNo)">{{ card.cardNo }}</button>
              </td>
              <td class="p-3 font-mono text-xs whitespace-nowrap">{{ card.passwordMask }}</td>
              <td class="p-3 whitespace-nowrap">{{ formatMoney(card.amount) }}</td>
              <td class="p-3 font-mono text-xs whitespace-nowrap">{{ card.batchNo }}</td>
              <td class="p-3 whitespace-nowrap">{{ card.createdBy?.username || '-' }}</td>
              <td class="p-3 whitespace-nowrap text-themed-muted">{{ formatDate(card.createdAt) }}</td>
              <td class="p-3 whitespace-nowrap">{{ card.usedBy?.username || '-' }}</td>
              <td class="p-3 whitespace-nowrap text-themed-muted">{{ formatDate(card.usedAt) }}</td>
              <td class="p-3 whitespace-nowrap">
                <span :class="['badge', getStatusClass(card.status)]">{{ $t(`admin.rechargeCards.status.${card.status}`) }}</span>
              </td>
              <td class="p-3 whitespace-nowrap">
                <button
                  class="btn btn-sm btn-ghost text-red-500"
                  :disabled="card.status === 'used' || deletingId === card.id"
                  @click="deleteCard(card)"
                >
                  {{ deletingId === card.id ? $t('common.deleting') : $t('common.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else class="card p-10 text-center">
      <div class="text-base font-medium text-themed">{{ $t('admin.rechargeCards.empty') }}</div>
      <div class="mt-1 text-sm text-themed-muted">{{ $t('admin.rechargeCards.description') }}</div>
      <button class="btn btn-primary mt-4" @click="openGenerateModal">{{ $t('admin.rechargeCards.generate') }}</button>
    </div>

    <div v-if="cards.length > 0" class="card mt-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2 text-sm text-themed-muted">
        <span>{{ $t('admin.billing.perPage') }}</span>
        <select
          :value="pageSize"
          class="input w-20 py-1"
          @change="pageSize = Number(($event.target as HTMLSelectElement).value); page = 1; loadCards()"
        >
          <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
        </select>
        <span>{{ $t('admin.billing.totalCount', { count: total }) }}</span>
      </div>
      <div v-if="totalPages > 1" class="flex items-center gap-2">
        <button class="btn btn-sm btn-ghost" :disabled="page <= 1" @click="page--; loadCards()">{{ $t('common.prevPage') }}</button>
        <span class="text-sm text-themed-muted">{{ page }} / {{ totalPages }}</span>
        <button class="btn btn-sm btn-ghost" :disabled="page >= totalPages" @click="page++; loadCards()">{{ $t('common.nextPage') }}</button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showGenerateModal" class="modal-overlay" @click.self="showGenerateModal = false">
        <div class="modal-content recharge-card-generate-modal flex flex-col">
          <div class="modal-header flex-shrink-0">
            <h3 class="modal-title">{{ $t('admin.rechargeCards.generate') }}</h3>
            <button class="btn btn-ghost btn-sm" @click="showGenerateModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="label">{{ $t('admin.rechargeCards.amount') }}</label>
                <input v-model.number="generateForm.amount" type="number" min="0.01" max="100000" step="0.01" class="input w-full" />
              </div>
              <div>
                <label class="label">{{ $t('admin.rechargeCards.count') }}</label>
                <input v-model.number="generateForm.count" type="number" min="1" max="1000" step="1" class="input w-full" />
              </div>
            </div>

            <div v-if="generatedCards.length > 0" class="flex min-h-0 flex-1 flex-col rounded-lg border border-themed">
              <div class="flex flex-shrink-0 flex-col gap-3 border-b border-themed p-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-themed">{{ $t('admin.rechargeCards.generatedResult') }}</div>
                  <div class="mt-1 truncate font-mono text-xs text-themed-muted">{{ generatedBatchNo }}</div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button class="btn btn-sm btn-ghost" @click="exportGeneratedCards">
                    {{ $t('admin.rechargeCards.exportGenerated') }}
                  </button>
                  <button class="btn btn-sm btn-primary" @click="copyText(generatedCardsText())">
                    {{ $t('admin.rechargeCards.copyAll') }}
                  </button>
                </div>
              </div>
              <div class="min-h-0 flex-1 overflow-auto">
                <table class="w-full min-w-[720px] text-sm">
                  <thead class="bg-themed-secondary/80">
                    <tr>
                      <th class="p-3 text-left">{{ $t('admin.rechargeCards.cardNo') }}</th>
                      <th class="p-3 text-left">{{ $t('admin.rechargeCards.password') }}</th>
                      <th class="p-3 text-left">{{ $t('admin.rechargeCards.amount') }}</th>
                      <th class="p-3 text-left">{{ $t('common.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="card in generatedCards" :key="card.cardNo" class="border-t border-themed">
                      <td class="p-3 font-mono text-xs">
                        <button class="text-left hover:text-blue-500" @click="copyText(card.cardNo)">
                          {{ card.cardNo }}
                        </button>
                      </td>
                      <td class="p-3 font-mono text-xs">
                        <button class="text-left hover:text-blue-500" @click="copyText(card.password)">
                          {{ card.password }}
                        </button>
                      </td>
                      <td class="p-3">{{ formatMoney(card.amount) }}</td>
                      <td class="p-3">
                        <button class="btn btn-sm btn-ghost" @click="copyText(formatGeneratedCard(card))">{{ $t('common.copy') }}</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="modal-footer flex-shrink-0">
            <button class="btn btn-ghost" @click="showGenerateModal = false">{{ $t('common.close') }}</button>
            <button class="btn btn-primary" :disabled="generateLoading" @click="generateCards">
              {{ generateLoading ? $t('common.processing') : $t('admin.rechargeCards.generate') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.recharge-card-generate-modal {
  width: min(94vw, 1120px);
  max-width: none;
  max-height: 90vh;
  overflow: hidden;
}
</style>
