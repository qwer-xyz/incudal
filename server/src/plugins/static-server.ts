/**
 * 静态文件服务插件
 * 处理前端静态文件托管和 SPA 路由回退
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface StaticServerOptions {
  clientDistPath: string
}

export async function registerStaticServer(
  fastify: FastifyInstance,
  options: StaticServerOptions
): Promise<void> {
  const { clientDistPath } = options
  const indexHtmlPath = join(clientDistPath, 'index.html')
  let indexHtmlCache: string | null = null
  let previewBotSafeIndexHtmlCache: string | null = null
  const linkPreviewBotPatterns = [
    /telegrambot/i,
    /discordbot/i,
    /slackbot/i,
    /twitterbot/i,
    /linkedinbot/i,
    /facebookexternalhit/i,
    /facebot/i,
    /skypeuripreview/i,
    /teamsbot/i
  ]

  function isLinkPreviewBotRequest(request: FastifyRequest): boolean {
    const userAgentHeader = request.headers['user-agent']
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(' ') : (userAgentHeader || '')
    return linkPreviewBotPatterns.some(pattern => pattern.test(userAgent))
  }

  function buildPreviewBotSafeIndexHtml(html: string): string {
    return html
      .replace(/^\s*<meta name="description"[^>]*>\s*$/gim, '')
      .replace(/^\s*<meta property="og:[^"]+"[^>]*>\s*$/gim, '')
      .replace(/^\s*<meta name="twitter:[^"]+"[^>]*>\s*$/gim, '')
      .replace(
        /<meta name="robots" content="[^"]*">/i,
        '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex">'
      )
  }

  async function getIndexHtml(): Promise<string> {
    if (indexHtmlCache === null) {
      indexHtmlCache = await readFile(indexHtmlPath, 'utf8')
    }
    return indexHtmlCache
  }

  async function getPreviewBotSafeIndexHtml(): Promise<string> {
    if (previewBotSafeIndexHtmlCache === null) {
      previewBotSafeIndexHtmlCache = buildPreviewBotSafeIndexHtml(await getIndexHtml())
    }
    return previewBotSafeIndexHtmlCache
  }

  async function sendAppIndex(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isLinkPreviewBotRequest(request)) {
      reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
        .send(await getPreviewBotSafeIndexHtml())
      return
    }

    await reply.sendFile('index.html', clientDistPath)
  }

  // 忽略 Cloudflare 的特殊路径（在 onRequest hook 中处理）
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/cdn-cgi/')) {
      reply.code(204)
      reply.send()
      return reply
    }
  })

  // 显式处理根路径，返回 index.html
  fastify.get('/', async (request, reply) => {
    await sendAppIndex(request, reply)
  })

  // 注册静态文件服务
  await fastify.register(fastifyStatic, {
    root: clientDistPath,
    prefix: '/',
    setHeaders: (res, pathName) => {
      try {
        if (pathName.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        } else if (pathName.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8')
        } else if (pathName.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        }
        if (!pathName.endsWith('.html')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      } catch (error) {
        // 忽略设置响应头时的错误
      }
    },
    list: false,
    index: false,
    wildcard: true
  })

  // 404 处理器
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/cdn-cgi/')) {
      return reply.code(204).send()
    }

    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'API 路由不存在' })
    }

    const hasExtension = /\.[a-zA-Z0-9]+$/.test(request.url.split('?')[0])
    if (hasExtension) {
      return reply.code(404).send({ error: '文件不存在' })
    }

    await sendAppIndex(request, reply)
  })
}
