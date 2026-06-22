<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { translateError } from '@/utils/errorHandler'
import type { AdminCreateUserRequest, AdminCreateUserResponse } from '@/types/api'

type UserRole = 'admin' | 'user'
type UserStatus = 'active' | 'banned'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()

const form = ref({
  username: '',
  email: '',
  role: 'user' as UserRole,
  status: 'active' as UserStatus,
  verifyEmail: false,
  emailCode: ''
})

const sendingCode = ref(false)
const submitting = ref(false)
const codeExpiresAt = ref('')
const resendSeconds = ref(0)
const result = ref<AdminCreateUserResponse | null>(null)
const passwordCopied = ref(false)

let countdownTimer: number | null = null

const normalizedEmail = computed(() => form.value.email.trim().toLowerCase())
const trimmedUsername = computed(() => form.value.username.trim())
const canSendCode = computed(() => {
  return !sendingCode.value && form.value.verifyEmail && normalizedEmail.value.includes('@')
})
const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!trimmedUsername.value || !normalizedEmail.value.includes('@')) return false
  if (form.value.verifyEmail && !form.value.emailCode.trim()) return false
  return true
})
const formattedCodeExpiresAt = computed(() => {
  if (!codeExpiresAt.value) return ''
  const date = new Date(codeExpiresAt.value)
  if (Number.isNaN(date.getTime())) return codeExpiresAt.value
  return date.toLocaleString()
})

watch(() => form.value.verifyEmail, (enabled) => {
  if (!enabled) {
    form.value.emailCode = ''
    codeExpiresAt.value = ''
    stopCountdown()
  }
})

onBeforeUnmount(() => {
  stopCountdown()
})

function startCountdown(seconds: number): void {
  stopCountdown()
  resendSeconds.value = seconds
  countdownTimer = window.setInterval(() => {
    resendSeconds.value = Math.max(0, resendSeconds.value - 1)
    if (resendSeconds.value === 0) {
      stopCountdown()
    }
  }, 1000)
}

function stopCountdown(): void {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
}

async function sendVerificationCode(): Promise<void> {
  if (!canSendCode.value) return
  sendingCode.value = true
  try {
    const response = await api.users.sendCreateVerificationCode(normalizedEmail.value)
    codeExpiresAt.value = response.expiresAt
    startCountdown(60)
    toast.success(t('admin.users.createUserPage.codeSent'))
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    sendingCode.value = false
  }
}

async function submitCreateUser(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const payload: AdminCreateUserRequest = {
      username: trimmedUsername.value,
      email: normalizedEmail.value,
      role: form.value.role,
      status: form.value.status,
      verifyEmail: form.value.verifyEmail,
      ...(form.value.verifyEmail ? { emailCode: form.value.emailCode.trim() } : {})
    }
    result.value = await api.users.create(payload)
    passwordCopied.value = false
    toast.success(t('admin.users.createUserPage.createSuccess'))
  } catch (error) {
    toast.error(translateError(error))
  } finally {
    submitting.value = false
  }
}

async function copyInitialPassword(): Promise<void> {
  const password = result.value?.initialPassword
  if (!password) return
  try {
    await navigator.clipboard.writeText(password)
    passwordCopied.value = true
    toast.success(t('common.copied'))
    window.setTimeout(() => {
      passwordCopied.value = false
    }, 2000)
  } catch {
    toast.error(t('common.copyFailed'))
  }
}

function resetForm(): void {
  result.value = null
  form.value = {
    username: '',
    email: '',
    role: 'user',
    status: 'active',
    verifyEmail: false,
    emailCode: ''
  }
  codeExpiresAt.value = ''
  passwordCopied.value = false
  stopCountdown()
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header flex-col sm:flex-row gap-4 sm:gap-0">
      <div>
        <button class="btn-ghost btn-sm mb-3" @click="router.push({ name: 'admin-users' })">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          {{ t('common.back') }}
        </button>
        <h1 class="page-title">{{ t('admin.users.createUserPage.title') }}</h1>
        <p class="page-description">{{ t('admin.users.createUserPage.description') }}</p>
      </div>
    </div>

    <div v-if="!result" class="card p-5 sm:p-6">
      <form class="space-y-6" @submit.prevent="submitCreateUser">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm font-medium text-themed">
              {{ t('admin.users.createUserPage.username') }}
            </label>
            <input
              v-model="form.username"
              type="text"
              class="input"
              autocomplete="off"
              maxlength="32"
              :placeholder="t('admin.users.createUserPage.usernamePlaceholder')"
            />
            <p class="mt-1.5 text-xs text-themed-muted">{{ t('admin.users.createUserPage.usernameHint') }}</p>
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-themed">
              {{ t('admin.users.createUserPage.email') }}
            </label>
            <input
              v-model="form.email"
              type="email"
              class="input"
              autocomplete="off"
              :placeholder="t('admin.users.createUserPage.emailPlaceholder')"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-themed">
              {{ t('admin.users.role') }}
            </label>
            <select v-model="form.role" class="input">
              <option value="user">{{ t('admin.users.user') }}</option>
              <option value="admin">{{ t('admin.users.admin') }}</option>
            </select>
          </div>

          <div>
            <label class="mb-2 block text-sm font-medium text-themed">
              {{ t('admin.users.status') }}
            </label>
            <select v-model="form.status" class="input">
              <option value="active">{{ t('admin.users.active') }}</option>
              <option value="banned">{{ t('admin.users.banned') }}</option>
            </select>
            <p v-if="form.status === 'banned'" class="mt-1.5 text-xs text-themed-muted">
              {{ t('admin.users.createUserPage.bannedHint') }}
            </p>
          </div>
        </div>

        <div class="rounded-lg bg-themed-secondary/50 p-4">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div class="text-sm font-medium text-themed">{{ t('admin.users.createUserPage.verifyEmail') }}</div>
              <p class="mt-1 text-xs text-themed-muted">{{ t('admin.users.createUserPage.verifyEmailHint') }}</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="form.verifyEmail"
              class="relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="form.verifyEmail ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'"
              @click="form.verifyEmail = !form.verifyEmail"
            >
              <span
                class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                :class="form.verifyEmail ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>

          <div v-if="form.verifyEmail" class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label class="mb-2 block text-sm font-medium text-themed">
                {{ t('admin.users.createUserPage.emailCode') }}
              </label>
              <input
                v-model="form.emailCode"
                type="text"
                inputmode="numeric"
                maxlength="6"
                class="input"
                :placeholder="t('admin.users.createUserPage.emailCodePlaceholder')"
              />
              <p v-if="formattedCodeExpiresAt" class="mt-1.5 text-xs text-themed-muted">
                {{ t('admin.users.createUserPage.codeExpiresAt', { time: formattedCodeExpiresAt }) }}
              </p>
            </div>
            <button
              type="button"
              class="btn-secondary justify-center"
              :disabled="!canSendCode || resendSeconds > 0"
              @click="sendVerificationCode"
            >
              <svg v-if="sendingCode" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span v-if="resendSeconds > 0">{{ t('admin.users.createUserPage.resendIn', { seconds: resendSeconds }) }}</span>
              <span v-else>{{ sendingCode ? t('common.sending') : t('admin.users.createUserPage.sendCode') }}</span>
            </button>
          </div>
        </div>

        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" class="btn-secondary justify-center" @click="router.push({ name: 'admin-users' })">
            {{ t('common.cancel') }}
          </button>
          <button type="submit" class="btn-primary justify-center" :disabled="!canSubmit">
            <svg v-if="submitting" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            {{ submitting ? t('common.creating') : t('admin.users.createUserPage.submit') }}
          </button>
        </div>
      </form>
    </div>

    <div v-else class="card p-5 sm:p-6">
      <div class="mb-5 flex items-start gap-3">
        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-themed">{{ t('admin.users.createUserPage.resultTitle') }}</h2>
          <p class="mt-1 text-sm text-themed-muted">
            {{ result.passwordDelivery === 'email'
              ? t('admin.users.createUserPage.resultEmailDesc')
              : t('admin.users.createUserPage.resultDisplayDesc') }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="rounded-lg bg-themed-secondary/50 p-4">
          <div class="text-xs text-themed-muted">{{ t('admin.users.createUserPage.username') }}</div>
          <div class="mt-1 font-medium text-themed">{{ result.user.username }}</div>
        </div>
        <div class="rounded-lg bg-themed-secondary/50 p-4">
          <div class="text-xs text-themed-muted">{{ t('admin.users.createUserPage.email') }}</div>
          <div class="mt-1 break-all font-medium text-themed">{{ result.user.email }}</div>
        </div>
        <div class="rounded-lg bg-themed-secondary/50 p-4">
          <div class="text-xs text-themed-muted">{{ t('admin.users.role') }}</div>
          <div class="mt-1 font-medium text-themed">
            {{ result.user.role === 'admin' ? t('admin.users.admin') : t('admin.users.user') }}
          </div>
        </div>
        <div class="rounded-lg bg-themed-secondary/50 p-4">
          <div class="text-xs text-themed-muted">{{ t('admin.users.status') }}</div>
          <div class="mt-1 font-medium text-themed">
            {{ result.user.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}
          </div>
        </div>
      </div>

      <div v-if="result.passwordDelivery === 'display' && result.initialPassword" class="mt-4 rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-900/20">
        <div class="text-sm font-medium text-yellow-900 dark:text-yellow-100">
          {{ t('admin.users.createUserPage.initialPassword') }}
        </div>
        <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <code class="min-w-0 flex-1 break-all rounded bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:bg-gray-950 dark:text-gray-100">
            {{ result.initialPassword }}
          </code>
          <button class="btn-secondary justify-center" @click="copyInitialPassword">
            {{ passwordCopied ? t('common.copied') : t('admin.users.createUserPage.copyPassword') }}
          </button>
        </div>
        <p class="mt-2 text-xs text-yellow-800 dark:text-yellow-200">
          {{ t('admin.users.createUserPage.passwordOnceHint') }}
        </p>
      </div>

      <div v-else class="mt-4 rounded-lg bg-themed-secondary/50 p-4 text-sm text-themed-muted">
        {{ t('admin.users.createUserPage.passwordEmailHint') }}
      </div>

      <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button class="btn-secondary justify-center" @click="resetForm">
          {{ t('admin.users.createUserPage.continueCreate') }}
        </button>
        <button class="btn-primary justify-center" @click="router.push({ name: 'admin-users' })">
          {{ t('admin.users.createUserPage.backToUsers') }}
        </button>
      </div>
    </div>
  </div>
</template>
