import assert from 'node:assert/strict'
import { createI18n } from 'vue-i18n'
import en from '../src/locales/en'
import zhCN from '../src/locales/zh-CN'
import zhTW from '../src/locales/zh-TW'

const locales = [
  ['zh-CN', zhCN],
  ['zh-TW', zhTW],
  ['en', en]
] as const

const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const diagnostics: string[] = []

console.error = (...args: unknown[]) => {
  diagnostics.push(args.map(String).join(' '))
}
console.warn = (...args: unknown[]) => {
  diagnostics.push(args.map(String).join(' '))
}

try {
  for (const [locale, messages] of locales) {
    const placeholder = (messages as any).admin.users.createUserPage.emailPlaceholder
    const i18n = createI18n({
      legacy: false,
      locale,
      messages: {
        [locale]: {
          placeholder
        }
      }
    })

    assert.equal(i18n.global.t('placeholder'), 'user@example.com', `${locale} create user email placeholder should render safely`)
  }
} finally {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
}

assert.deepEqual(diagnostics, [], `create user i18n messages should compile without diagnostics:\n${diagnostics.join('\n')}`)

console.log('create user i18n messages: ok')
