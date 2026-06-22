import assert from 'node:assert/strict'
import {
  buildAdminCreateUserResponse,
  normalizeAdminCreateUserInput
} from '../src/lib/admin-create-user.js'

const normalized = normalizeAdminCreateUserInput({
  username: 'Demo_User',
  email: 'Demo@Example.COM ',
  role: 'admin',
  status: 'banned',
  verifyEmail: true,
  emailCode: '123456'
})

assert.equal(normalized.ok, true)
if (!normalized.ok) {
  throw new Error('Expected valid input')
}

assert.deepEqual(normalized.data, {
  username: 'Demo_User',
  email: 'demo@example.com',
  role: 'admin',
  status: 'banned',
  verifyEmail: true,
  emailCode: '123456'
})

const invalidUsername = normalizeAdminCreateUserInput({
  username: '1bad',
  email: 'user@example.com',
  role: 'user',
  status: 'active',
  verifyEmail: false
})

assert.equal(invalidUsername.ok, false)
if (invalidUsername.ok) {
  throw new Error('Expected invalid username')
}
assert.equal(invalidUsername.errorCode, 'INVALID_PARAMS')

const missingCode = normalizeAdminCreateUserInput({
  username: 'ValidUser',
  email: 'user@example.com',
  role: 'user',
  status: 'active',
  verifyEmail: true
})

assert.equal(missingCode.ok, false)
if (missingCode.ok) {
  throw new Error('Expected missing email code')
}
assert.equal(missingCode.errorCode, 'EMAIL_CODE_REQUIRED')

const invalidCode = normalizeAdminCreateUserInput({
  username: 'ValidUser',
  email: 'user@example.com',
  role: 'user',
  status: 'active',
  verifyEmail: true,
  emailCode: 'abc123'
})

assert.equal(invalidCode.ok, false)
if (invalidCode.ok) {
  throw new Error('Expected invalid email code')
}
assert.equal(invalidCode.errorCode, 'INVALID_EMAIL_CODE')

const displayResponse = buildAdminCreateUserResponse(
  {
    id: 100,
    username: 'Demo_User',
    email: 'demo@example.com',
    role: 'user',
    status: 'active',
    avatar_style: 'initials',
    avatar_badge_id: null,
    ban_reason: null,
    password_hash: 'redacted',
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z'
  },
  'display',
  'Secret123!'
)

assert.equal(displayResponse.initialPassword, 'Secret123!')
assert.equal(displayResponse.passwordDelivery, 'display')
assert.equal(displayResponse.user.username, 'Demo_User')

const emailResponse = buildAdminCreateUserResponse(
  {
    id: 101,
    username: 'Email_User',
    email: 'email@example.com',
    role: 'user',
    status: 'active',
    avatar_style: 'identicon',
    avatar_badge_id: null,
    ban_reason: null,
    password_hash: 'redacted',
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z'
  },
  'email',
  'ShouldNotLeak123!'
)

assert.equal('initialPassword' in emailResponse, false)
assert.equal(emailResponse.passwordDelivery, 'email')

console.log('admin create user helpers: ok')
