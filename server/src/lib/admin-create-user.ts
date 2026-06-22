import type { User } from '../types/database.js'
import { ErrorCode, type ErrorCodeType } from './errors.js'

export type AdminCreateUserRole = 'admin' | 'user'
export type AdminCreateUserStatus = 'active' | 'banned'
export type AdminCreateUserPasswordDelivery = 'display' | 'email'

export interface AdminCreateUserInput {
  username: string
  email: string
  role: AdminCreateUserRole
  status: AdminCreateUserStatus
  verifyEmail: boolean
  emailCode?: string
}

export interface AdminCreateUserResponse {
  user: {
    id: number
    username: string
    email: string | null
    role: AdminCreateUserRole
    status: AdminCreateUserStatus
    avatarStyle?: string
    avatarBadgeId?: string | null
    created_at: string
    updated_at: string
    createdAt: string
  }
  passwordDelivery: AdminCreateUserPasswordDelivery
  initialPassword?: string
}

type NormalizeResult =
  | { ok: true; data: AdminCreateUserInput }
  | { ok: false; errorCode: ErrorCodeType; message?: string }

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const EMAIL_CODE_PATTERN = /^\d{6}$/

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

export function normalizeAdminCreateUserInput(raw: Record<string, unknown>): NormalizeResult {
  const username = typeof raw.username === 'string' ? raw.username.trim() : ''
  if (username.length < 3 || username.length > 32 || !USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      errorCode: ErrorCode.INVALID_PARAMS,
      message: 'Username must be 3-32 characters, start with a letter, and contain only letters, numbers, hyphens or underscores'
    }
  }

  const email = typeof raw.email === 'string' ? raw.email.toLowerCase().trim() : ''
  if (!email || !email.includes('@')) {
    return { ok: false, errorCode: ErrorCode.INVALID_EMAIL }
  }

  const role = raw.role === 'admin' ? 'admin' : raw.role === 'user' ? 'user' : null
  if (!role) {
    return { ok: false, errorCode: ErrorCode.INVALID_PARAMS, message: 'Invalid role' }
  }

  const status = raw.status === 'banned' ? 'banned' : raw.status === 'active' ? 'active' : null
  if (!status) {
    return { ok: false, errorCode: ErrorCode.INVALID_PARAMS, message: 'Invalid status' }
  }

  const verifyEmail = normalizeBoolean(raw.verifyEmail)
  const emailCode = typeof raw.emailCode === 'string' ? raw.emailCode.trim() : undefined
  if (verifyEmail) {
    if (!emailCode) {
      return { ok: false, errorCode: ErrorCode.EMAIL_CODE_REQUIRED }
    }
    if (!EMAIL_CODE_PATTERN.test(emailCode)) {
      return { ok: false, errorCode: ErrorCode.INVALID_EMAIL_CODE }
    }
  }

  return {
    ok: true,
    data: {
      username,
      email,
      role,
      status,
      verifyEmail,
      ...(emailCode ? { emailCode } : {})
    }
  }
}

export function buildAdminCreateUserResponse(
  user: User,
  passwordDelivery: AdminCreateUserPasswordDelivery,
  initialPassword: string
): AdminCreateUserResponse {
  const response: AdminCreateUserResponse = {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      avatarStyle: user.avatar_style,
      avatarBadgeId: user.avatar_badge_id ?? null,
      created_at: user.created_at,
      updated_at: user.updated_at,
      createdAt: user.created_at
    },
    passwordDelivery
  }

  if (passwordDelivery === 'display') {
    response.initialPassword = initialPassword
  }

  return response
}
