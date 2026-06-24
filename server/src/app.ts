// 确保环境变量被加载（必须在最前面）
import 'dotenv/config'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 导入数据库
import { initPrismaDatabase } from './db/init-prisma.js'

// 导入安全工具
import { checkJwtConfig } from './lib/security.js'

// 导入日志敏感信息过滤器
import { logSerializers } from './lib/log-sanitizer.js'

// 导入速率限制配置
import {
  globalRateLimit,
  findRateLimitRule,
  isWhitelisted,
  printRateLimitSummary
} from './config/rate-limit.js'

// 导入插件
import { registerAuthDecorators } from './plugins/auth-decorators.js'
import { registerStaticServer } from './plugins/static-server.js'

// 导入调度器
import { startSchedulers, stopSchedulers } from './services/schedulers.js'

// 导入路由
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import instanceRoutes from './routes/instances.js'
import hostRoutes from './routes/hosts.js'
import packageRoutes from './routes/packages.js'
import snapshotRoutes from './routes/snapshots.js'
import sshKeyRoutes from './routes/ssh-keys.js'
import notificationRoutes from './routes/notifications.js'
import oauthRoutes from './routes/oauth.js'
import helpRoutes from './routes/help.js'
import imageRoutes from './routes/images.js'
import logRoutes from './routes/logs.js'
import systemConfigRoutes from './routes/system-config.js'
import trafficRoutes from './routes/traffic.js'
import transferRoutes from './routes/transfers.js'
import friendsRoutes from './routes/friends.js'
import ipAddressRoutes from './routes/ip-addresses.js'
import verificationRoutes from './routes/verification.js'
import proxySitesRoutes from './routes/proxy-sites.js'
import inboxRoutes from './routes/inbox.js'
import terminalRoutes from './routes/terminal.js'
import terminalSavedCommandRoutes from './routes/terminal-saved-commands.js'
import announcementsRoutes from './routes/announcements.js'
import ticketsRoutes from './routes/tickets.js'
import checkinRoutes from './routes/checkin.js'
import resourcePoolRoutes from './routes/resource-pool.js'
import redeemCodesRoutes from './routes/redeem-codes.js'
import customInitCommandRoutes from './routes/custom-init-commands.js'
import batchConfigRoutes from './routes/batch-config.js'
import balanceRoutes from './routes/balance.js'
import hostingRoutes from './routes/hosting.js'
import instanceBillingRoutes from './routes/instance-billing.js'
import instanceDestroyRoutes from './routes/instance-destroy.js'
import rechargeRoutes from './routes/recharge.js'
import adminBillingRoutes from './routes/admin-billing.js'
import adminStatisticsRoutes from './routes/admin-statistics.js'
import adminHostingRoutes from './routes/admin-hosting.js'
import affRoutes from './routes/aff.js'
import entertainmentRoutes from './routes/entertainment.js'
import adminEntertainmentRoutes from './routes/admin-entertainment.js'
import mailRoutes from './routes/mail.js'
import adminNotificationChannelsRoutes from './routes/admin-notification-channels.js'
import telegramRoutes from './routes/telegram.js'
import agentRoutes from './routes/agent.js'
import userInviteRoutes from './routes/user-invites.js'
import vipLevelRoutes from './routes/vip-levels.js'
import vipBenefitRoutes from './routes/vip-benefits.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function failRetiredBackupTasks(): Promise<{ restoreCount: number; uploadCount: number }> {
  const { prisma } = await import('./db/prisma.js')

  const [restoreResult, uploadResult] = await Promise.all([
    prisma.restoreTask.updateMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      data: {
        status: 'FAILED',
        error: '备份恢复功能已下线，任务已终止',
        finishedAt: new Date()
      }
    }),
    prisma.backupUploadTask.updateMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      data: {
        status: 'FAILED',
        error: '备份上传功能已下线，任务已终止',
        finishedAt: new Date()
      }
    })
  ])

  return {
    restoreCount: restoreResult.count,
    uploadCount: uploadResult.count
  }
}

// 创建 Fastify 实例
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'info'),
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined,
    serializers: logSerializers
  },
  disableRequestLogging: process.env.DISABLE_REQUEST_LOG !== 'false',
  trustProxy: process.env.NODE_ENV === 'production',
  bodyLimit: parseInt(process.env.BODY_LIMIT || '10485760', 10),
  routerOptions: {
    maxParamLength: 500
  },
  requestTimeout: 125000,
  keepAliveTimeout: 125000,
  forceCloseConnections: false
})

// 自定义 schema 验证错误处理
import type { FastifyError } from 'fastify'

fastify.setErrorHandler((error: FastifyError, _request, reply) => {
  if ((error as FastifyError & { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
    return reply.code(413).send({
      error: 'Uploaded file is too large',
      code: 'FILE_TOO_LARGE'
    })
  }

  if (error.validation) {
    const messages: string[] = []
    for (const err of error.validation) {
      const field = err.instancePath?.replace('/', '') || (err.params as Record<string, string>)?.missingProperty || 'field'
      if (err.keyword === 'minLength') {
        if (field === 'password') {
          messages.push('Password must be at least 8 characters')
        } else if (field === 'username') {
          messages.push('Username must be at least 3 characters')
        } else {
          messages.push(`${field} is too short`)
        }
      } else if (err.keyword === 'maxLength') {
        messages.push(`${field} is too long`)
      } else if (err.keyword === 'pattern') {
        if (field === 'username') {
          messages.push('Username must start with a letter and contain only letters, numbers, underscores, and hyphens')
        } else {
          messages.push(`${field} format is invalid`)
        }
      } else if (err.keyword === 'format') {
        if ((err.params as Record<string, string>)?.format === 'email') {
          messages.push('Please enter a valid email address')
        } else {
          messages.push(`${field} format is invalid`)
        }
      } else if (err.keyword === 'required') {
        messages.push(`${field} is required`)
      } else {
        messages.push(err.message || `${field} is invalid`)
      }
    }
    return reply.code(400).send({
      error: messages[0] || 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: messages.length > 1 ? messages : undefined
    })
  }

  const statusCode = error.statusCode || 500
  const publicMessage = process.env.NODE_ENV === 'production' && statusCode >= 500
    ? 'Internal server error'
    : (error.message || 'Internal server error')
  return reply.code(statusCode).send({ error: publicMessage })
})

// 注册插件
await fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(url => url.trim()) : false)
    : ['http://localhost:43173', 'http://127.0.0.1:43173'],
  credentials: true
})

// 安全头
await fastify.register(helmet, {
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://challenges.cloudflare.com',
        'https://static.cloudflareinsights.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
        'data:',
      ],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'http:',
        'https:',
        'https://kkksr.com',
        'https://api.dicebear.com',
        'https://dicebear.incudal.com',
        'https://*.githubusercontent.com',
        'https://avatars.githubusercontent.com',
        'https://lh3.googleusercontent.com',
      ],
      connectSrc: [
        "'self'",
        'wss:',
        'https://challenges.cloudflare.com',
        'https://cloudflareinsights.com',
        'https://api.dicebear.com',
        'https://dicebear.incudal.com',
      ],
      frameSrc: [
        "'self'",
        'https://challenges.cloudflare.com',
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: process.env.ENABLE_HSTS === 'true' ? {
    maxAge: 31536000,
    includeSubDomains: true,
  } : false,
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  hidePoweredBy: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
})

const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ 安全配置错误: JWT_SECRET is required in production')
    process.exit(1)
  }
  console.warn('⚠️  JWT_SECRET not set, using insecure development fallback')
}
await fastify.register(fastifyJwt, {
  secret: jwtSecret || 'dev-secret-change-in-production'
})

const cookieSecret = process.env.COOKIE_SECRET
if (!cookieSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ 安全配置错误: COOKIE_SECRET is required in production')
    process.exit(1)
  }
  console.warn('⚠️  COOKIE_SECRET not set, using insecure development fallback')
}
await fastify.register(fastifyCookie, {
  secret: cookieSecret || 'cookie-secret-change-in-production',
  parseOptions: {}
})

await fastify.register(fastifyMultipart, {
  attachFieldsToBody: false,
  limits: {
    files: 6,
    fileSize: 50 * 1024 * 1024,
    parts: 30
  }
})

// WebSocket 插件注册
await fastify.register(fastifyWebsocket, {
  options: {
    maxPayload: 1048576,
  }
})

// 全局速率限制
await fastify.register(rateLimit, {
  global: true,
  max: globalRateLimit.max,
  timeWindow: globalRateLimit.timeWindow,
  keyGenerator: (request) => {
    const rule = findRateLimitRule(request.url, request.method)
    if (rule) {
      return `${request.ip}:${rule.path}`
    }
    return request.ip
  },
  errorResponseBuilder: (_request, context) => ({
    error: 'Too many requests, please try again later',
    retryAfter: context.after
  }),
  allowList: (request) => {
    if (!request.url.startsWith('/api/')) {
      return true
    }
    return isWhitelisted(request.url)
  }
})

// 应用接口级别的速率限制配置
fastify.addHook('onRoute', (routeOptions) => {
  const rule = findRateLimitRule(routeOptions.url, routeOptions.method as string)
  if (rule) {
    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: {
        max: rule.max,
        timeWindow: rule.timeWindow
      }
    }
  }
})

// 注册认证装饰器
await registerAuthDecorators(fastify)

// 健康检查
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// 注册 API 路由
await fastify.register(authRoutes, { prefix: '/api/auth' })
await fastify.register(userRoutes, { prefix: '/api/users' })
await fastify.register(instanceRoutes, { prefix: '/api/instances' })
await fastify.register(hostRoutes, { prefix: '/api/hosts' })
await fastify.register(packageRoutes, { prefix: '/api/packages' })
await fastify.register(snapshotRoutes, { prefix: '/api/instances' })
await fastify.register(sshKeyRoutes, { prefix: '/api/ssh-keys' })
await fastify.register(notificationRoutes, { prefix: '/api/notifications' })
await fastify.register(oauthRoutes, { prefix: '/api/oauth' })
await fastify.register(helpRoutes, { prefix: '/api/help' })
await fastify.register(imageRoutes, { prefix: '/api/images' })
await fastify.register(logRoutes, { prefix: '/api/logs' })
await fastify.register(systemConfigRoutes, { prefix: '/api/system-config' })
await fastify.register(trafficRoutes, { prefix: '/api' })
await fastify.register(transferRoutes, { prefix: '/api/transfers' })
await fastify.register(friendsRoutes, { prefix: '/api/friends' })
await fastify.register(ipAddressRoutes, { prefix: '/api' })
await fastify.register(verificationRoutes, { prefix: '/api/verification' })
await fastify.register(proxySitesRoutes, { prefix: '/api' })
await fastify.register(inboxRoutes, { prefix: '/api/inbox' })
await fastify.register(terminalRoutes, { prefix: '/api/ws/instances' })
await fastify.register(terminalSavedCommandRoutes, { prefix: '/api/terminal-saved-commands' })
await fastify.register(announcementsRoutes, { prefix: '/api/announcements' })
await fastify.register(ticketsRoutes, { prefix: '/api/tickets' })
await fastify.register(checkinRoutes, { prefix: '/api/checkin' })
await fastify.register(resourcePoolRoutes, { prefix: '/api/resource-pool' })
await fastify.register(redeemCodesRoutes, { prefix: '/api' })
await fastify.register(customInitCommandRoutes, { prefix: '/api/init-commands' })
await fastify.register(batchConfigRoutes, { prefix: '/api/hosts' })
await fastify.register(balanceRoutes, { prefix: '/api/balance' })
await fastify.register(hostingRoutes, { prefix: '/api/hosting' })
await fastify.register(instanceBillingRoutes, { prefix: '/api/instances' })
await fastify.register(instanceDestroyRoutes, { prefix: '/api/instances' })
await fastify.register(rechargeRoutes)
await fastify.register(adminBillingRoutes)
await fastify.register(adminStatisticsRoutes)
await fastify.register(adminHostingRoutes)
await fastify.register(affRoutes, { prefix: '/api/aff' })
await fastify.register(entertainmentRoutes, { prefix: '/api/entertainment' })
await fastify.register(adminEntertainmentRoutes, { prefix: '/api/admin/entertainment' })
await fastify.register(mailRoutes, { prefix: '/api/mail' })
await fastify.register(adminNotificationChannelsRoutes, { prefix: '/api/admin/notification-channels' })
await fastify.register(telegramRoutes, { prefix: '/api/telegram' })
await fastify.register(agentRoutes, { prefix: '/api/agent' })
await fastify.register(userInviteRoutes, { prefix: '/api/user-invites' })
await fastify.register(vipLevelRoutes)
await fastify.register(vipBenefitRoutes)

// 生产环境：注册静态文件服务
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = join(__dirname, '../../client/dist')
  await registerStaticServer(fastify, { clientDistPath })
}

// 启动服务器
const start = async (): Promise<void> => {
  try {
    // 安全配置检查
    const jwtCheck = checkJwtConfig()
    if (!jwtCheck.valid) {
      console.error('❌ 安全配置错误:')
      jwtCheck.warnings.forEach(w => console.error(`   - ${w}`))
      process.exit(1)
    }
    if (jwtCheck.warnings.length > 0) {
      console.warn('⚠️  安全配置警告:')
      jwtCheck.warnings.forEach(w => console.warn(`   - ${w}`))
    }

    // 初始化 Prisma 数据库
    await initPrismaDatabase({
      resetDatabase: process.env.RESET_DATABASE === 'true' || process.env.RESET_DATABASE === '1'
    })

    const retiredTaskCleanup = await failRetiredBackupTasks()
    if (retiredTaskCleanup.restoreCount > 0 || retiredTaskCleanup.uploadCount > 0) {
      console.log(`📦 已终止 ${retiredTaskCleanup.restoreCount} 个历史恢复任务，${retiredTaskCleanup.uploadCount} 个历史上传任务`)
    }

    const port = parseInt(process.env.PORT || '3000', 10)
    const host = process.env.HOST || '127.0.0.1'

    await fastify.listen({ port, host })
    console.log(`🚀 Incudal 服务已启动: http://localhost:${port}`)

    // 启动所有调度器
    await startSchedulers()

    console.log(`🔒 安全模式: ${process.env.NODE_ENV === 'production' ? '生产环境' : '开发环境'}`)
    printRateLimitSummary()

    if (process.env.RESET_DATABASE === 'true' || process.env.RESET_DATABASE === '1') {
      console.log('⚠️  注意：数据库已在启动时清空，请在生产环境中移除 RESET_DATABASE 环境变量')
    }

    // 优雅关闭处理
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 收到 ${signal} 信号，开始优雅关闭...`)

      // 停止调度器和清理资源
      await stopSchedulers()

      // 关闭 Fastify 服务器
      try {
        await fastify.close()
        console.log('✅ 服务器已关闭')
        process.exit(0)
      } catch (err) {
        console.error('❌ 关闭服务器失败:', err)
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
