/**
 * 实例路由共享辅助函数和类型
 */

import type { FastifyReply } from 'fastify'
import type { InstanceStatus } from '@prisma/client'
import * as db from '../../db/index.js'
import { prisma } from '../../db/prisma.js'
import { apiError, ErrorCode } from '../../lib/errors.js'
import {
  INSTANCE_OPERATION_LOCK_NAMESPACE,
  tryAdvisoryTransactionLock
} from '../../db/advisory-locks.js'
import {
  getSystemImageAvailabilityForHost
} from '../../db/images.js'
import { getPlanById } from '../../db/package-plans.js'
import {
  applyTrafficMultiplier,
  normalizeTrafficMultiplier
} from '../../lib/traffic-multiplier.js'

// 检查实例是否被转移锁定
export async function checkTransferLock(instanceId: number, reply: FastifyReply): Promise<boolean> {
  const hasPending = await db.hasPendingTransfer(instanceId)
  if (hasPending) {
    reply.code(400).send(apiError(ErrorCode.TRANSFER_INSTANCE_LOCKED))
    return true
  }
  return false
}

export async function claimInstanceForDelete(instanceId: number, currentStatus: InstanceStatus): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, instanceId)
    if (!locked) return false

    const [activeRestoreTask, activeUploadTask, activeInstanceTask] = await Promise.all([
      tx.restoreTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.backupUploadTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      }),
      tx.instanceTask.findFirst({
        where: { instanceId, status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true }
      })
    ])
    if (activeRestoreTask || activeUploadTask || activeInstanceTask) return false

    const result = await tx.instance.updateMany({
      where: {
        id: instanceId,
        status: currentStatus
      },
      data: { status: 'deleted' }
    })

    return result.count === 1
  })
}

/**
 * 检查用户对实例的操作权限
 * @deprecated 使用 lib/permission.ts 中的 checkInstancePermission 替代
 */
export async function checkInstanceOperationPermission(
  user: { id: number; role: string },
  instance: { user_id: number; host_id: number }
): Promise<boolean> {
  if (user.role === 'admin') return true
  if (instance.user_id === user.id) return true
  const host = await db.getHostById(instance.host_id)
  if (host && host.user_id === user.id) return true
  return false
}

// ==================== Change Host 类型 ====================

export type ChangeHostUnavailableReason =
  | 'current_host'
  | 'host_offline'
  | 'host_type_mismatch'
  | 'cpu_full'
  | 'memory_full'
  | 'resource_unconfigured'
  | 'image_unavailable'

export interface ChangeHostHostOption {
  id: number
  name: string
  location: string | null
  countryCode: string
  architecture: string
  status: string
  probeUrl: string | null
  isCurrent: boolean
  canChange: boolean
  unavailableReason: ChangeHostUnavailableReason | null
  resources: {
    cpuUsed: number
    cpuAllowanceMax: number
    cpuAvailable: number
    memoryUsed: number
    memoryMax: number
    memoryAvailable: number
  }
  trafficMultiplier: number
  effectiveTrafficLimit: string | null
}

export interface ChangeHostOptionsResponse {
  packageId: number | null
  packageName: string | null
  currentHostId: number
  required: {
    cpu: number
    memory: number
  }
  hosts: ChangeHostHostOption[]
  sshKeys: Array<{
    id: number
    name: string
    fingerprint: string | null
  }>
  canChangeHost: boolean
  unavailableReason?: 'no_package' | 'single_host' | 'no_ssh_key'
}

export function isHostCompatibleWithPackageInstanceType(
  hostInstanceType: string | null | undefined,
  packageInstanceType: 'container' | 'vm'
): boolean {
  const type = hostInstanceType || 'container'
  if (packageInstanceType === 'vm') return type === 'vm' || type === 'both'
  return type === 'container' || type === 'both'
}

export async function buildChangeHostOptions(instance: {
  id: number
  user_id: number
  host_id: number
  package_id: number | null
  image: string
  cpu: number
  memory: number
  package_plan_id?: number | null
}): Promise<ChangeHostOptionsResponse> {
  const sshKeys = await db.getSSHKeysByUserId(instance.user_id)

  const baseResponse = {
    packageId: null,
    packageName: null,
    currentHostId: instance.host_id,
    required: {
      cpu: instance.cpu,
      memory: instance.memory
    },
    hosts: [],
    sshKeys: sshKeys.map(key => ({
      id: key.id,
      name: key.name,
      fingerprint: key.fingerprint ?? null
    })),
    canChangeHost: false
  } satisfies ChangeHostOptionsResponse

  if (!instance.package_id) {
    return { ...baseResponse, unavailableReason: 'no_package' }
  }

  const pkg = await db.getPackageById(instance.package_id)
  if (!pkg) {
    return { ...baseResponse, unavailableReason: 'no_package' }
  }

  const packageHosts = await prisma.packageHost.findMany({
    where: { packageId: instance.package_id },
    select: {
      hostId: true,
      trafficMultiplier: true,
      host: {
        select: {
          id: true,
          name: true,
          location: true,
          countryCode: true,
          architecture: true,
          status: true,
          cpuUsed: true,
          cpuAllowanceMax: true,
          memoryUsed: true,
          memoryMax: true,
          instanceType: true,
          probeUrl: true
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  })

  const hostIds = packageHosts.map(binding => binding.hostId)
  if (hostIds.length === 0) {
    return {
      ...baseResponse,
      packageId: pkg.id,
      packageName: pkg.name,
      unavailableReason: 'single_host'
    }
  }

  const resourceRows = await prisma.instance.groupBy({
    by: ['hostId'],
    where: {
      hostId: { in: hostIds },
      status: { not: 'deleted' }
    },
    _sum: {
      cpu: true,
      memory: true
    }
  })

  const resourceByHostId = new Map(resourceRows.map(row => [
    row.hostId,
    {
      cpuUsed: row._sum.cpu ?? 0,
      memoryUsed: row._sum.memory ?? 0
    }
  ]))

  const packageInstanceType = ((pkg as { instance_type?: 'container' | 'vm' }).instance_type || 'container')
  let baseTrafficLimit = pkg.monthly_traffic_limit ? BigInt(pkg.monthly_traffic_limit) : null
  if (instance.package_plan_id) {
    const plan = await getPlanById(instance.package_plan_id)
    if (plan && plan.packageId === instance.package_id) {
      baseTrafficLimit = plan.trafficLimit
    }
  }

  const hosts = await Promise.all(packageHosts.map(async binding => {
    const host = binding.host
    const used = resourceByHostId.get(host.id) || { cpuUsed: 0, memoryUsed: 0 }
    const cpuUsed = Math.max(used.cpuUsed, host.cpuUsed || 0)
    const memoryUsed = Math.max(used.memoryUsed, host.memoryUsed || 0)
    const cpuAllowanceMax = host.cpuAllowanceMax || 0
    const memoryMax = host.memoryMax || 0
    const cpuAvailable = cpuAllowanceMax > 0 ? Math.max(0, cpuAllowanceMax - cpuUsed) : 0
    const memoryAvailable = memoryMax > 0 ? Math.max(0, memoryMax - memoryUsed) : 0
    const isCurrent = host.id === instance.host_id

    let unavailableReason: ChangeHostUnavailableReason | null = null
    if (isCurrent) {
      unavailableReason = 'current_host'
    } else if (host.status !== 'online') {
      unavailableReason = 'host_offline'
    } else if (!isHostCompatibleWithPackageInstanceType(host.instanceType, packageInstanceType)) {
      unavailableReason = 'host_type_mismatch'
    } else if (cpuAllowanceMax <= 0 || memoryMax <= 0) {
      unavailableReason = 'resource_unconfigured'
    } else if (cpuAvailable < instance.cpu) {
      unavailableReason = 'cpu_full'
    } else if (memoryAvailable < instance.memory) {
      unavailableReason = 'memory_full'
    } else {
      const imageAvailability = await getSystemImageAvailabilityForHost(instance.image, host.id, {
        instanceType: packageInstanceType,
        memory: instance.memory
      })
      if (!imageAvailability.ok) {
        unavailableReason = 'image_unavailable'
      }
    }

    return {
      id: host.id,
      name: host.name,
      location: host.location,
      countryCode: host.countryCode || 'us',
      architecture: host.architecture || 'x86_64',
      status: host.status,
      probeUrl: host.probeUrl || null,
      isCurrent,
      canChange: unavailableReason === null,
      unavailableReason,
      resources: {
        cpuUsed,
        cpuAllowanceMax,
        cpuAvailable,
        memoryUsed,
        memoryMax,
        memoryAvailable
      },
      trafficMultiplier: normalizeTrafficMultiplier(binding.trafficMultiplier),
      effectiveTrafficLimit: applyTrafficMultiplier(baseTrafficLimit, binding.trafficMultiplier)?.toString() ?? null
    } satisfies ChangeHostHostOption
  }))

  const hasTarget = hosts.some(host => host.canChange)
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    currentHostId: instance.host_id,
    required: {
      cpu: instance.cpu,
      memory: instance.memory
    },
    hosts: hosts.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      if (a.canChange !== b.canChange) return a.canChange ? -1 : 1
      return a.name.localeCompare(b.name)
    }),
    sshKeys: baseResponse.sshKeys,
    canChangeHost: hasTarget && sshKeys.length > 0,
    unavailableReason: hostIds.length <= 1
      ? 'single_host'
      : (sshKeys.length === 0 ? 'no_ssh_key' : undefined)
  }
}
