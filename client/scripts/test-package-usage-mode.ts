import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canSelectPackageUsageMode,
  getPackageUsageModeFromPlanSummary,
  shouldShowPackageLevelInstanceDefaults
} from '../src/utils/packageUsageMode'

assert.equal(getPackageUsageModeFromPlanSummary(undefined), 'free')
assert.equal(getPackageUsageModeFromPlanSummary({ total: 0 }), 'free')
assert.equal(getPackageUsageModeFromPlanSummary({ total: 2 }), 'paid')

assert.equal(shouldShowPackageLevelInstanceDefaults('free'), true)
assert.equal(shouldShowPackageLevelInstanceDefaults('paid'), false)

assert.equal(canSelectPackageUsageMode({ total: 2 }, 'free'), false)
assert.equal(canSelectPackageUsageMode({ total: 2 }, 'paid'), true)
assert.equal(canSelectPackageUsageMode({ total: 0 }, 'paid'), true)

const scriptDir = dirname(fileURLToPath(import.meta.url))
const formView = readFileSync(resolve(scriptDir, '../src/views/resources/PackageFormView.vue'), 'utf8')

assert.equal(
  formView.includes('v-if="!isEditMode"'),
  false,
  'package usage selector must be visible in edit/config mode'
)
assert.equal(
  formView.includes('watch(packageCreationMode'),
  false,
  'loading an existing paid package must not reset hidden package-level defaults'
)

console.log('package usage mode helpers: ok')
