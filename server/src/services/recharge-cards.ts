import bcrypt from 'bcryptjs'
import { customAlphabet } from 'nanoid'
import type { Prisma, PrismaClient, RechargeCard } from '@prisma/client'

type PrismaLike = PrismaClient | Prisma.TransactionClient

const CARD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const cardNoNanoid = customAlphabet(CARD_ALPHABET, 16)
const passwordNanoid = customAlphabet(CARD_ALPHABET, 20)
const batchNanoid = customAlphabet(CARD_ALPHABET, 12)
const orderNanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8)

export type RechargeCardStatus = 'unused' | 'used'
export type RechargeCardSortBy = 'createdAt' | 'amount' | 'usedAt' | 'status'
export type RechargeCardSortOrder = 'asc' | 'desc'

export interface GeneratedRechargeCardSecret {
  cardNo: string
  password: string
}

export interface RechargeCardListOptions {
  page?: number
  pageSize?: number
  status?: 'unused' | 'used'
  search?: string
  batchNo?: string
  createdById?: number
  usedById?: number
  minAmount?: number
  maxAmount?: number
  createdFrom?: Date
  createdTo?: Date
  usedFrom?: Date
  usedTo?: Date
  sortBy?: RechargeCardSortBy
  sortOrder?: RechargeCardSortOrder
}

export interface RechargeCardView {
  id: number
  cardNo: string
  passwordMask: string
  amount: number
  batchNo: string
  status: RechargeCardStatus
  createdBy: { id: number; username: string } | null
  createdAt: string
  usedBy: { id: number; username: string } | null
  usedAt: string | null
  rechargeRecordId: number | null
}

export interface RechargeCardExportRow {
  id: number
  cardNo: string
  passwordMask: string
  amount: number
  batchNo: string
  status: RechargeCardStatus
  createdBy: string | null
  createdAt: string
  usedBy: string | null
  usedAt: string | null
}

export interface RedeemRechargeCardResult {
  card: RechargeCardView
  orderNo: string
  amount: number
  balance: number
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

async function getPrisma() {
  const { prisma } = await import('../db/prisma.js')
  return prisma
}

export function normalizeRechargeCardCredential(value: string): string {
  return value.trim().replace(/[\s-]+/g, '').toUpperCase()
}

export function generateRechargeCardSecrets(count: number): GeneratedRechargeCardSecret[] {
  const safeCount = Math.max(1, Math.min(1000, Math.floor(count)))
  const result: GeneratedRechargeCardSecret[] = []
  const seen = new Set<string>()

  while (result.length < safeCount) {
    const cardNo = `RC${cardNoNanoid()}`
    if (seen.has(cardNo)) continue
    seen.add(cardNo)
    result.push({
      cardNo,
      password: passwordNanoid()
    })
  }

  return result
}

export function generateRechargeCardBatchNo(): string {
  return `RCB${Date.now().toString(36).toUpperCase()}${batchNanoid()}`
}

function generateRechargeCardOrderNo(): string {
  return `R${Date.now().toString(36)}${orderNanoid()}`.toUpperCase()
}

export function maskRechargeCardPassword(password: string): string {
  const normalized = normalizeRechargeCardCredential(password)
  if (normalized.length <= 8) {
    return '*'.repeat(normalized.length)
  }
  return `${normalized.slice(0, 4)}${'*'.repeat(Math.max(4, normalized.length - 8))}${normalized.slice(-4)}`
}

function maskStoredRechargeCard(): string {
  return '****'
}

function escapeCsv(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function buildRechargeCardExportCsv(rows: RechargeCardExportRow[]): string {
  const header = ['cardNo', 'passwordMask', 'amount', 'batchNo', 'status', 'createdBy', 'createdAt', 'usedBy', 'usedAt']
  const lines = rows.map(row => [
    row.cardNo,
    row.passwordMask,
    row.amount.toFixed(2),
    row.batchNo,
    row.status,
    row.createdBy,
    row.createdAt,
    row.usedBy,
    row.usedAt
  ].map(escapeCsv).join(','))

  return [header.join(','), ...lines].join('\n')
}

function toRechargeCardView(card: RechargeCard & {
  createdBy?: { id: number; username: string } | null
  usedBy?: { id: number; username: string } | null
}): RechargeCardView {
  return {
    id: card.id,
    cardNo: card.cardNo,
    passwordMask: maskStoredRechargeCard(),
    amount: Number(card.amount),
    batchNo: card.batchNo,
    status: card.usedAt ? 'used' : 'unused',
    createdBy: card.createdBy ? { id: card.createdBy.id, username: card.createdBy.username } : null,
    createdAt: card.createdAt.toISOString(),
    usedBy: card.usedBy ? { id: card.usedBy.id, username: card.usedBy.username } : null,
    usedAt: card.usedAt?.toISOString() || null,
    rechargeRecordId: card.rechargeRecordId
  }
}

function buildWhere(options: RechargeCardListOptions): Prisma.RechargeCardWhereInput {
  const where: Prisma.RechargeCardWhereInput = {}

  if (options.status === 'unused') where.usedAt = null
  if (options.status === 'used') where.usedAt = { not: null }
  if (options.search?.trim()) {
    where.cardNo = { contains: normalizeRechargeCardCredential(options.search) }
  }
  if (options.batchNo?.trim()) {
    where.batchNo = { contains: options.batchNo.trim().toUpperCase() }
  }
  if (options.createdById) where.createdById = options.createdById
  if (options.usedById) where.usedById = options.usedById
  if (options.minAmount !== undefined || options.maxAmount !== undefined) {
    where.amount = {
      ...(options.minAmount !== undefined ? { gte: options.minAmount } : {}),
      ...(options.maxAmount !== undefined ? { lte: options.maxAmount } : {})
    }
  }
  if (options.createdFrom || options.createdTo) {
    where.createdAt = {
      ...(options.createdFrom ? { gte: options.createdFrom } : {}),
      ...(options.createdTo ? { lte: options.createdTo } : {})
    }
  }
  if ((options.usedFrom || options.usedTo) && options.status !== 'unused') {
    where.usedAt = {
      ...(options.status === 'used' ? { not: null } : {}),
      ...(options.usedFrom ? { gte: options.usedFrom } : {}),
      ...(options.usedTo ? { lte: options.usedTo } : {})
    }
  }

  return where
}

function buildOrderBy(sortBy: RechargeCardSortBy, sortOrder: RechargeCardSortOrder): Prisma.RechargeCardOrderByWithRelationInput[] {
  if (sortBy === 'status') {
    return [{ usedAt: sortOrder }, { createdAt: 'desc' }]
  }
  return [{ [sortBy]: sortOrder }, { id: 'desc' }] as Prisma.RechargeCardOrderByWithRelationInput[]
}

export async function createRechargeCards(input: {
  amount: number
  count: number
  adminId: number
}): Promise<{ batchNo: string; cards: Array<GeneratedRechargeCardSecret & { amount: number }> }> {
  const amount = roundMoney(input.amount)
  const count = Math.floor(input.count)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw new Error('INVALID_AMOUNT')
  }
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('INVALID_COUNT')
  }

  const prisma = await getPrisma()
  const batchNo = generateRechargeCardBatchNo()
  const secrets = generateRechargeCardSecrets(count)
  const data = await Promise.all(secrets.map(async secret => ({
    cardNo: secret.cardNo,
    passwordHash: await bcrypt.hash(normalizeRechargeCardCredential(secret.password), 12),
    amount,
    batchNo,
    createdById: input.adminId
  })))

  await prisma.rechargeCard.createMany({ data })

  return {
    batchNo,
    cards: secrets.map(secret => ({ ...secret, amount }))
  }
}

export async function listRechargeCards(options: RechargeCardListOptions): Promise<{
  cards: RechargeCardView[]
  total: number
  page: number
  pageSize: number
}> {
  const prisma = await getPrisma()
  const page = Math.max(1, options.page || 1)
  const pageSize = Math.min(100, Math.max(1, options.pageSize || 20))
  const sortBy = options.sortBy || 'createdAt'
  const sortOrder = options.sortOrder || 'desc'
  const where = buildWhere(options)

  const [cards, total] = await Promise.all([
    prisma.rechargeCard.findMany({
      where,
      include: {
        createdBy: { select: { id: true, username: true } },
        usedBy: { select: { id: true, username: true } }
      },
      orderBy: buildOrderBy(sortBy, sortOrder),
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.rechargeCard.count({ where })
  ])

  return {
    cards: cards.map(toRechargeCardView),
    total,
    page,
    pageSize
  }
}

export async function exportRechargeCards(ids: number[]): Promise<RechargeCardExportRow[]> {
  const prisma = await getPrisma()
  const safeIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0))).slice(0, 1000)
  if (safeIds.length === 0) return []

  const cards = await prisma.rechargeCard.findMany({
    where: { id: { in: safeIds } },
    include: {
      createdBy: { select: { username: true } },
      usedBy: { select: { username: true } }
    },
    orderBy: { createdAt: 'desc' }
  })

  return cards.map(card => ({
    id: card.id,
    cardNo: card.cardNo,
    passwordMask: maskStoredRechargeCard(),
    amount: Number(card.amount),
    batchNo: card.batchNo,
    status: card.usedAt ? 'used' : 'unused',
    createdBy: card.createdBy?.username || null,
    createdAt: card.createdAt.toISOString(),
    usedBy: card.usedBy?.username || null,
    usedAt: card.usedAt?.toISOString() || null
  }))
}

export async function deleteRechargeCard(id: number): Promise<boolean> {
  const prisma = await getPrisma()
  const card = await prisma.rechargeCard.findUnique({
    where: { id },
    select: { id: true, usedAt: true }
  })
  if (!card) return false
  if (card.usedAt) {
    throw new Error('CARD_ALREADY_USED')
  }

  const result = await prisma.rechargeCard.deleteMany({
    where: { id, usedAt: null }
  })
  return result.count > 0
}

export async function deleteRechargeCards(ids: number[]): Promise<{
  deleted: number
  skippedUsed: number
  notFound: number
  deletedIds: number[]
}> {
  const uniqueIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0))).slice(0, 1000)
  if (uniqueIds.length === 0) {
    return { deleted: 0, skippedUsed: 0, notFound: 0, deletedIds: [] }
  }

  const prisma = await getPrisma()
  const cards = await prisma.rechargeCard.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, usedAt: true }
  })

  const foundIds = new Set(cards.map(card => card.id))
  const unusedIds = cards.filter(card => !card.usedAt).map(card => card.id)
  const skippedUsed = cards.length - unusedIds.length
  const notFound = uniqueIds.filter(id => !foundIds.has(id)).length

  if (unusedIds.length === 0) {
    return { deleted: 0, skippedUsed, notFound, deletedIds: [] }
  }

  await prisma.rechargeCard.deleteMany({
    where: { id: { in: unusedIds }, usedAt: null }
  })

  const remaining = await prisma.rechargeCard.findMany({
    where: { id: { in: unusedIds } },
    select: { id: true }
  })
  const remainingIds = new Set(remaining.map(card => card.id))
  const deletedIds = unusedIds.filter(id => !remainingIds.has(id))
  const skippedAfterDelete = unusedIds.length - deletedIds.length

  return {
    deleted: deletedIds.length,
    skippedUsed: skippedUsed + skippedAfterDelete,
    notFound,
    deletedIds
  }
}

async function getActiveRechargeCardProvider(client: PrismaLike) {
  return client.paymentProvider.findFirst({
    where: {
      type: 'recharge_card',
      status: 'active'
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
  })
}

export async function hasActiveRechargeCardProvider(): Promise<boolean> {
  const prisma = await getPrisma()
  const provider = await getActiveRechargeCardProvider(prisma)
  return !!provider
}

export async function redeemRechargeCard(input: {
  userId: number
  cardNo: string
  password: string
  ip?: string
  userAgent?: string
}): Promise<RedeemRechargeCardResult> {
  const prisma = await getPrisma()
  const cardNo = normalizeRechargeCardCredential(input.cardNo)
  const password = normalizeRechargeCardCredential(input.password)
  if (!cardNo || !password) {
    throw new Error('INVALID_CARD_CREDENTIAL')
  }

  const result = await prisma.$transaction(async (tx) => {
    const provider = await getActiveRechargeCardProvider(tx)
    if (!provider) {
      throw new Error('RECHARGE_CARD_PROVIDER_DISABLED')
    }

    const lockedRows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "recharge_cards"
      WHERE "card_no" = ${cardNo}
      FOR UPDATE
    `
    if (lockedRows.length === 0) {
      throw new Error('RECHARGE_CARD_NOT_FOUND')
    }

    const card = await tx.rechargeCard.findUnique({
      where: { id: lockedRows[0].id },
      include: {
        createdBy: { select: { id: true, username: true } },
        usedBy: { select: { id: true, username: true } }
      }
    })
    if (!card) {
      throw new Error('RECHARGE_CARD_NOT_FOUND')
    }
    if (card.usedAt) {
      throw new Error('RECHARGE_CARD_ALREADY_USED')
    }

    const passwordValid = await bcrypt.compare(password, card.passwordHash)
    if (!passwordValid) {
      throw new Error('RECHARGE_CARD_PASSWORD_INVALID')
    }

    const amount = Number(card.amount)
    const orderNo = generateRechargeCardOrderNo()
    const order = await tx.rechargeRecord.create({
      data: {
        userId: input.userId,
        providerId: provider.id,
        orderNo,
        amount,
        actualAmount: amount,
        fee: 0,
        paymentMethod: 'recharge_card',
        status: 'completed',
        ip: input.ip,
        userAgent: input.userAgent,
        callbackData: {
          source: 'recharge_card',
          cardId: card.id,
          cardNo: card.cardNo
        } as Prisma.InputJsonObject,
        callbackAt: new Date(),
        paymentDetails: {
          kind: 'recharge_card',
          cardNo: card.cardNo,
          batchNo: card.batchNo
        } as Prisma.InputJsonObject,
        completedAt: new Date()
      }
    })

    await tx.user.update({
      where: { id: input.userId },
      data: { balance: { increment: amount } }
    })

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { balance: true }
    })
    if (!user) {
      throw new Error('USER_NOT_FOUND')
    }

    await tx.balanceLog.create({
      data: {
        userId: input.userId,
        type: 'recharge',
        amount,
        balanceBefore: Number(user.balance) - amount,
        balanceAfter: Number(user.balance),
        orderId: order.orderNo,
        remark: `卡密充值：${card.cardNo}`
      }
    })

    const usedCard = await tx.rechargeCard.update({
      where: { id: card.id },
      data: {
        usedById: input.userId,
        usedAt: new Date(),
        rechargeRecordId: order.id
      },
      include: {
        createdBy: { select: { id: true, username: true } },
        usedBy: { select: { id: true, username: true } }
      }
    })

    return {
      card: usedCard,
      orderNo: order.orderNo,
      amount,
      balance: Number(user.balance)
    }
  })

  return {
    card: toRechargeCardView(result.card),
    orderNo: result.orderNo,
    amount: result.amount,
    balance: result.balance
  }
}
