/**
 * 异步创建实例
 */

import * as db from '../../db/index.js'
import { prisma } from '../../db/prisma.js'
import { createLog } from '../../db/logs.js'
import { getIncusClient } from '../../lib/incus/index.js'
import {
  buildInstanceConfig,
  createInstance,
  startInstance,
  stopInstance,
  deleteInstance,
  getInstanceState
} from '../../lib/incus/index.js'
import type { Host } from '../../types/database.js'

/**
 * 异步创建实例
 */
export async function createInstanceAsync(
  instanceId: number,
  host: Host,
  config: {
    name: string
    image: string
    cpu: number
    memory: number
    disk: number
    swapEnabled?: boolean
    swapSize?: number | null
    cloudInitConfig?: Record<string, string>
    networkMode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
    nested?: boolean
    privileged?: boolean
    portLimit?: number
    instanceType?: 'container' | 'vm'
    sshPort?: number | null
    storagePool?: string | null
    ipv4Address?: string | null
    ipv6Address?: string | null
    ipv6Gateway?: string | null
    hostInterface?: string | null
    limitsRead?: string | null
    limitsWrite?: string | null
    limitsReadIops?: number | null
    limitsWriteIops?: number | null
    limitsIngress?: string | null
    limitsEgress?: string | null
    limitsProcesses?: number | null
    limitsCpuPriority?: number | null
    bootAutostart?: boolean | null
    bootAutostartPriority?: number | null
    bootAutostartDelay?: number | null
    bootHostShutdownTimeout?: number | null
  },
  userId: number,
  resources: { cpu: number; memory: number; disk: number }
): Promise<void> {
  try {
    console.log(`\n[Provisioning] ===== 开始创建实例流程 =====`)
    console.log(`[Provisioning] 实例ID: ${instanceId}, 名称: ${config.name}, 宿主机: ${host.name}`)

    const client = await getIncusClient(host)

    console.log(`[Provisioning] 正在构建 Incus 配置...`)
    const ipv6Config = config.ipv6Address ? {
      primaryIp: config.ipv6Address
    } : null

    const incusConfig = buildInstanceConfig({
      name: config.name,
      image: config.image,
      cpu: config.cpu,
      memory: config.memory,
      disk: config.disk,
      swapEnabled: config.swapEnabled,
      swapSize: config.swapSize,
      sshKey: '',
      password: '',
      cloudInitConfig: config.cloudInitConfig as { 'user.user-data': string } | undefined,
      networkMode: (config.networkMode || 'nat') as 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat',
      nested: config.nested || false,
      privileged: config.privileged || false,
      instanceType: config.instanceType || 'container',
      storagePool: config.storagePool || 'default',
      ipv4Address: config.ipv4Address,
      ipv6Config,
      hostInterface: config.hostInterface || 'eth0',
      ipv6Address: config.ipv6Address,
      ipv6Gateway: config.ipv6Gateway,
      limitsRead: config.limitsRead,
      limitsWrite: config.limitsWrite,
      limitsReadIops: config.limitsReadIops,
      limitsWriteIops: config.limitsWriteIops,
      limitsIngress: config.limitsIngress,
      limitsEgress: config.limitsEgress,
      limitsProcesses: config.limitsProcesses,
      limitsCpuPriority: config.limitsCpuPriority,
      bootAutostart: config.bootAutostart,
      bootAutostartPriority: config.bootAutostartPriority,
      bootAutostartDelay: config.bootAutostartDelay,
      bootHostShutdownTimeout: config.bootHostShutdownTimeout
    })

    console.log(`[Provisioning] 开始创建实例 ${instanceId} (${config.name}) on ${host.name}`)
    console.log(`[Provisioning] 资源配置: CPU=${config.cpu}, Memory=${config.memory}MB, Disk=${config.disk}MB`)
    console.log(`[Provisioning] Incus 配置已生成，敏感字段已跳过日志输出`)

    await createInstance(client, incusConfig)
    const instanceTypeLabel = config.instanceType === 'vm' ? '虚拟机' : '容器'
    console.log(`[Provisioning] 实例 ${config.name} ${instanceTypeLabel}创建完成`)

    await startInstance(client, config.name)
    console.log(`[Provisioning] 实例 ${config.name} 启动命令已发送`)

    // KVM 虚拟机需要等待 QEMU 真正完成启动
    if (config.instanceType === 'vm') {
      console.log(`[Provisioning] VM ${config.name} 等待 QEMU 启动完成...`)
      const vmMaxWait = 90
      let vmStarted = false
      for (let i = 0; i < vmMaxWait; i++) {
        await new Promise(r => setTimeout(r, 2000))
        try {
          const vmState = await getInstanceState(client, config.name) as { status?: string }
          if (vmState.status === 'Running') {
            console.log(`[Provisioning] VM ${config.name} 已确认启动 (耗时 ${(i + 1) * 2}s)`)
            vmStarted = true
            break
          }
          if (i % 10 === 0) {
            console.log(`[Provisioning] VM ${config.name} 等待启动中... (${(i + 1) * 2}s, 状态: ${vmState.status || 'unknown'})`)
          }
        } catch { /* 继续等待 */ }
      }
      if (!vmStarted) {
        console.warn(`[Provisioning] VM ${config.name} 启动等待超时 (180s)，继续流程`)
      }
    }

    const ipv4: string | null = config.ipv4Address || null
    const ipv6: string | null = config.ipv6Address || null

    console.log(`[Provisioning] 实例 ${config.name} IP 配置: IPv4=${ipv4}, IPv6=${ipv6}`)

    const updateResult = await prisma.instance.updateMany({
      where: {
        id: instanceId,
        status: 'creating'
      },
      data: {
        status: 'running',
        ipv4: ipv4 ?? null,
        ipv6: ipv6 ?? null,
        storagePoolName: config.storagePool || 'default'
      }
    })

    if (updateResult.count === 0) {
      console.log(`[Provisioning] 实例 ${instanceId} 已被超时清理任务处理，清理已创建的 Incus 实例`)
      try {
        await stopInstance(client, config.name, true)
        await deleteInstance(client, config.name)
        console.log(`[Provisioning] Incus 实例 ${config.name} 已清理（因超时）`)
      } catch (cleanupErr) {
        console.error(`[Provisioning] 清理超时实例失败:`, cleanupErr)
      }
      return
    }

    if (ipv4) {
      try {
        await db.createIpAddress({
          address: ipv4,
          type: 'inet4',
          isPrimary: true,
          device: 'eth0',
          instanceId
        })
        console.log(`[Provisioning] 主 IPv4 地址记录已创建: ${ipv4} (device: eth0)`)
      } catch (err) {
        console.warn(`[Provisioning] 创建 IPv4 记录失败 (可能已存在):`, err)
      }
    }

    if (ipv6) {
      try {
        await db.createIpAddress({
          address: ipv6,
          type: 'inet6',
          isPrimary: true,
          device: 'eth1',
          instanceId
        })
        console.log(`[Provisioning] 主 IPv6 地址记录已创建: ${ipv6} (device: eth1)`)
      } catch (err) {
        console.warn(`[Provisioning] 创建 IPv6 记录失败 (可能已存在):`, err)
      }
    }

    console.log(`[Provisioning] ✔ 实例 ${instanceId} (${config.name}) 创建成功!`)

    const instance = await db.getInstanceById(instanceId)
    if (instance) {
      const { sendNotification } = await import('../../lib/notifier.js')
      await sendNotification(userId, 'instance_created', {
        instanceName: instance.name,
        status: 'running',
        hostName: host.name,
        hostLocation: host.location || undefined,
        image: config.image,
        cpu: config.cpu,
        memory: config.memory,
        disk: config.disk,
        networkMode: config.networkMode,
        ipv4: ipv4 || undefined,
        ipv6: ipv6 || undefined
      })

      try {
        const { sendInstanceCreatedEmail } = await import('../../lib/mailer.js')
        const user = await db.findUserById(userId)
        if (user && user.email) {
          const instanceWithBilling = await prisma.instance.findUnique({
            where: { id: instanceId },
            select: {
              packagePlanId: true,
              billingPrice: true,
              expiresAt: true,
              packagePlan: { select: { name: true } }
            }
          })
          const isPaid = instanceWithBilling?.packagePlanId !== null

          await sendInstanceCreatedEmail(user.email, {
            username: user.username,
            instanceName: instance.name,
            hostName: host.name,
            image: config.image,
            cpu: config.cpu,
            memory: config.memory,
            disk: config.disk,
            ipv4: ipv4 || undefined,
            ipv6: ipv6 || undefined,
            isPaid,
            planName: instanceWithBilling?.packagePlan?.name,
            amount: isPaid ? Number(instanceWithBilling?.billingPrice) : undefined,
            expiresAt: instanceWithBilling?.expiresAt ?? undefined
          })
        }
      } catch (emailErr) {
        console.warn(`[Provisioning] 发送实例创建成功邮件失败:`, emailErr)
      }

      await createLog(
        userId,
        'instance',
        'instance.create',
        `Created instance "${instance.name}" [host: ${host.name}, image: ${config.image}, CPU: ${config.cpu}%, Memory: ${config.memory}MB, Disk: ${config.disk}MB, IPv4: ${ipv4 || 'N/A'}, IPv6: ${ipv6 || 'N/A'}, network: ${config.networkMode}]`,
        'success',
        { instanceId }
      )
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[Provisioning] ✘ 实例 ${instanceId} 创建失败:`, errorMessage)

    const updateResult = await prisma.instance.updateMany({
      where: {
        id: instanceId,
        status: 'creating'
      },
      data: {
        status: 'error'
      }
    })

    if (updateResult.count > 0 && userId && resources) {
      try {
        await db.rollbackResources({
          hostId: host.id,
          cpu: resources.cpu,
          memory: resources.memory,
          disk: resources.disk,
          portCount: ['nat', 'nat_ipv6', 'nat_ipv6_nat', 'ipv6_nat', 'ipv6_only'].includes(config.networkMode) ? (config.portLimit || 0) : 0
        })
        console.log(`[Provisioning] 用户 ${userId} 资源已回滚 (CPU=${resources.cpu}, Mem=${resources.memory}MB, Disk=${resources.disk}MB)`)
      } catch (rollbackErr) {
        console.error(`[Provisioning] 资源回滚失败:`, rollbackErr)
      }
    } else if (updateResult.count === 0) {
      console.log(`[Provisioning] 实例 ${instanceId} 已被超时清理任务处理，跳过资源回滚`)
    }

    try {
      const client = await getIncusClient(host)
      await deleteInstance(client, config.name)
      console.log(`[Provisioning] 残留容器 ${config.name} 已清理`)
    } catch (cleanupErr) {
      const errorMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
      console.log(`[Provisioning] 清理残留容器失败 (可能不存在):`, errorMessage)
    }

    const instance = await db.getInstanceById(instanceId)
    if (instance) {
      try {
        const { sendNotification } = await import('../../lib/notifier.js')
        await sendNotification(userId, 'instance_create_failed', {
          instanceName: instance.name,
          hostName: host.name,
          error: errorMessage
        })
      } catch (notifyErr) {
        console.error(`[Provisioning] 发送失败通知失败:`, notifyErr)
      }

      await createLog(
        userId,
        'instance',
        'instance.create',
        `Failed to create instance "${instance.name}": ${errorMessage}`,
        'failed',
        { instanceId }
      )
    }

    throw error
  }
}
