/**
 * 认证装饰器插件
 * 包含认证查询缓存、Token 验证和管理员权限检查
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db/prisma.js'
import { isAccessTokenInvalidated } from '../lib/security.js'

// ==================== 认证查询短时缓存 ====================
// 为认证查询添加 30 秒 TTL 内存缓存，减少每次请求的数据库查询

const AUTH_CACHE_TTL_MS = 30_000 // 30 秒

interface AuthCacheEntry<T> {
  value: T
  expiresAt: number
}

// 用户信息缓存: `${userId}` -> { username, role, status }
const userInfoCache = new Map<string, AuthCacheEntry<{ username: string; role: string; status: string }>>()

// Token 失效检查缓存: `${userId}:${iat}:${sid}` -> invalidated
const tokenInvalidationCache = new Map<string, AuthCacheEntry<boolean>>()

function getCached<T>(cache: Map<string, AuthCacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function setCached<T>(cache: Map<string, AuthCacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })
}

/** 清除指定用户的认证缓存（用户状态变更时调用） */
export function clearAuthCache(userId: number): void {
  userInfoCache.delete(String(userId))
  for (const key of tokenInvalidationCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      tokenInvalidationCache.delete(key)
    }
  }
}

// 定期清理过期缓存条目（每 5 分钟）
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of userInfoCache) {
    if (entry.expiresAt <= now) userInfoCache.delete(key)
  }
  for (const [key, entry] of tokenInvalidationCache) {
    if (entry.expiresAt <= now) tokenInvalidationCache.delete(key)
  }
}, 5 * 60 * 1000).unref()

// ==================== 认证辅助函数 ====================

async function ensureActiveAccessToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const user = request.user as { id?: number; username?: string; role?: string; status?: string; sid?: string; iat?: number }

  if (!user?.id || !user.iat) {
    reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return false
  }

  // 使用缓存的 token 失效检查结果
  const invalidationKey = `${user.id}:${user.iat}:${user.sid ?? ''}`
  const cachedInvalidated = getCached(tokenInvalidationCache, invalidationKey)
  let invalidated: boolean
  if (cachedInvalidated !== undefined) {
    invalidated = cachedInvalidated
  } else {
    invalidated = await isAccessTokenInvalidated(user.id, user.iat, user.sid)
    setCached(tokenInvalidationCache, invalidationKey, invalidated)
  }

  if (invalidated) {
    reply.code(401).send({ error: 'Session expired', code: 'SESSION_INVALIDATED' })
    return false
  }

  // 使用缓存的用户信息
  const userKey = String(user.id)
  const cachedUserInfo = getCached(userInfoCache, userKey)
  if (cachedUserInfo) {
    if (cachedUserInfo.status !== 'active') {
      reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
      return false
    }
    user.username = cachedUserInfo.username
    user.role = cachedUserInfo.role
    user.status = cachedUserInfo.status
    return true
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      username: true,
      role: true,
      status: true
    }
  })

  if (!currentUser) {
    reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return false
  }

  // 缓存用户信息
  setCached(userInfoCache, userKey, currentUser)

  if (currentUser.status !== 'active') {
    reply.code(401).send({ error: 'Account banned', code: 'ACCOUNT_BANNED' })
    return false
  }

  user.username = currentUser.username
  user.role = currentUser.role
  user.status = currentUser.status

  return true
}

async function ensureCurrentAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const currentUser = request.user as { id?: number; role?: string; status?: string }
  if (!currentUser?.id || currentUser.role !== 'admin' || currentUser.status !== 'active') {
    reply.code(403).send({ error: 'Admin privileges required', code: 'ADMIN_REQUIRED' })
    return false
  }

  return true
}

// ==================== Fastify 装饰器注册 ====================

/**
 * 注册认证装饰器到 Fastify 实例
 */
export async function registerAuthDecorators(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify()
      if (!(await ensureActiveAccessToken(request, reply))) {
        return
      }
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // 管理员权限检查 (作为 preHandler 使用)
  fastify.decorate('requireAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
    // 必须先通过 authenticate，确保 request.user 存在
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }
    if (!(await ensureCurrentAdmin(request, reply))) {
      return
    }
  })

  // 组合认证+管理员检查的便捷 preHandler（简化版）
  fastify.decorate('authenticateAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify()
      if (!(await ensureActiveAccessToken(request, reply))) {
        return
      }
      if (!(await ensureCurrentAdmin(request, reply))) {
        return
      }
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // 组合认证+普通用户检查（禁止管理员访问）（简化版）
  fastify.decorate('authenticateUser', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify()
      if (!(await ensureActiveAccessToken(request, reply))) {
        return
      }
      const user = request.user as { id: number; role?: string }
      // 禁止管理员访问普通用户专属功能
      if (user.role === 'admin') {
        return reply.code(403).send({ error: 'This feature is for regular users only', code: 'USER_ONLY' })
      }
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}
