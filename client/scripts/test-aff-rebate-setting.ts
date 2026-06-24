import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

const systemConfigDb = read('server/src/db/system-config.ts')
const affDb = read('server/src/db/aff.ts')
const billingOperations = read('server/src/db/billing-operations.ts')
const systemConfigRoutes = read('server/src/routes/system-config.ts')
const adminBillingRoutes = read('server/src/routes/admin-billing.ts')
const instanceRoutes = read('server/src/routes/instances.ts')
const mailRoutes = read('server/src/routes/mail.ts')
const configStore = read('client/src/stores/config.ts')
const apiIndex = read('client/src/api/index.ts')
const systemConfigView = read('client/src/views/admin/SystemConfigView.vue')
const walletView = read('client/src/views/WalletView.vue')
const instanceCreateView = read('client/src/views/InstanceCreateView.vue')
const instanceDetailView = read('client/src/views/InstanceDetailView.vue')
const applyAffCodeModal = read('client/src/components/instance/modals/ApplyAffCodeModal.vue')
const mailView = read('client/src/views/MailView.vue')
const zhCN = read('client/src/locales/zh-CN.ts')
const zhTW = read('client/src/locales/zh-TW.ts')
const en = read('client/src/locales/en.ts')

assert.match(
  systemConfigDb,
  /key:\s*'aff_rebate_enabled'[\s\S]*?value:\s*'false'/,
  'AFF rebate system config must exist and default to disabled'
)

assert.match(
  affDb,
  /getSystemConfigBoolean\('aff_rebate_enabled',\s*false\)/,
  'AFF activation must be controlled by aff_rebate_enabled with a false default'
)

assert.match(
  affDb,
  /validateAffCode[\s\S]*?isAffActivated/,
  'Instance AFF code validation must reject when AFF rebate is disabled'
)

assert.match(
  affDb,
  /validateMailAffCode[\s\S]*?isAffActivated/,
  'Mail AFF code validation must reject when AFF rebate is disabled'
)

assert.match(
  billingOperations,
  /isAffRebateEnabled/,
  'Instance renewal and billing previews must honor the AFF rebate setting'
)

assert.match(
  mailRoutes,
  /isAffRebateEnabled/,
  'Mail subscription renewal must honor the AFF rebate setting'
)

assert.doesNotMatch(
  affDb,
  /return true;?\s*(?:\r?\n\s*\/\/ 原来的逻辑)?/,
  'AFF activation must not be hard-coded to true'
)

assert.match(systemConfigRoutes, /affRebateEnabled/, 'public system config must expose AFF rebate setting')
const validKeysMatch = systemConfigRoutes.match(/const validKeys = \[([\s\S]*?)\]\s*\r?\n\s*\/\/ 布尔类型配置键/)
assert.ok(validKeysMatch, 'system config update route must define validKeys before booleanKeys')
assert.match(
  validKeysMatch[1],
  /'aff_rebate_enabled'/,
  'system config update validKeys must allow saving the AFF rebate setting'
)
assert.match(adminBillingRoutes, /isAffActivated/, 'admin instance AFF binding must also honor the AFF rebate setting')
assert.match(adminBillingRoutes, /affCode\.enabled/, 'admin instance AFF binding must reject disabled AFF codes')
assert.doesNotMatch(affDb + '\n' + read('server/src/routes/aff.ts'), /请先充值任意金额/, 'AFF disabled responses must not mention the old recharge activation rule')
assert.match(instanceRoutes, /isAffRebateEnabled/, 'instance detail AFF discount data must honor the AFF rebate setting')
assert.match(apiIndex, /affRebateEnabled/, 'API public config type must include AFF rebate setting')
assert.match(configStore, /affRebateEnabled/, 'public config store must persist AFF rebate setting')
assert.match(systemConfigView, /aff_rebate_enabled/, 'admin settings must expose the AFF rebate switch')
assert.match(walletView, /affDisabledByAdmin/, 'wallet AFF disabled state must use dedicated admin-disabled copy')
assert.match(instanceCreateView, /affRebateEnabled/, 'instance creation promo code UI must honor AFF rebate setting')
assert.match(instanceDetailView, /affRebateEnabled/, 'instance detail AFF binding entry must honor AFF rebate setting')
assert.match(applyAffCodeModal, /disabledReason/, 'AFF binding modal must support a disabled state reason')
assert.match(mailView, /affRebateEnabled/, 'mail checkout AFF code UI must honor AFF rebate setting')

for (const [name, locale] of [['zh-CN', zhCN], ['zh-TW', zhTW], ['en', en]] as const) {
  assert.match(locale, /affRebateEnabled/, `${name} must include AFF rebate setting title`)
  assert.match(locale, /affDisabledByAdmin/, `${name} must include AFF disabled copy`)
  assert.match(locale, /promoCodeDisabledByAdmin/, `${name} must include promo code disabled copy`)
  assert.match(locale, /applyAffDisabledByAdmin/, `${name} must include instance AFF bind disabled copy`)
}

console.log('aff rebate setting guards: ok')
