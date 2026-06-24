import assert from 'node:assert/strict'
import {
  buildRechargeCardExportCsv,
  generateRechargeCardSecrets,
  maskRechargeCardPassword,
  normalizeRechargeCardCredential
} from '../src/services/recharge-cards.js'

async function main(): Promise<void> {
  const generated = generateRechargeCardSecrets(5)
  assert.equal(generated.length, 5)
  assert.equal(new Set(generated.map(card => card.cardNo)).size, 5)
  assert.equal(new Set(generated.map(card => card.password)).size, 5)
  for (const card of generated) {
    assert.match(card.cardNo, /^RC[A-Z0-9]{16}$/)
    assert.match(card.password, /^[A-Z0-9]{20}$/)
  }

  assert.equal(normalizeRechargeCardCredential(' rc ab-12  '), 'RCAB12')
  assert.equal(maskRechargeCardPassword('ABCDEFGH12345678'), 'ABCD********5678')

  const csv = buildRechargeCardExportCsv([
    {
      id: 1,
      cardNo: 'RC0000000000000001',
      passwordMask: 'ABCD********WXYZ',
      amount: 20,
      batchNo: 'RCBATCH001',
      status: 'unused',
      createdBy: 'admin',
      createdAt: '2026-06-23T00:00:00.000Z',
      usedBy: null,
      usedAt: null
    }
  ])
  assert.match(csv, /^cardNo,passwordMask,amount,batchNo,status,createdBy,createdAt,usedBy,usedAt\r?\n/)
  assert.match(csv, /RC0000000000000001/)
  assert.doesNotMatch(csv, /ABCDEFGH12345678/)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
