/**
 * 调度器启动模块
 * 集中管理所有后台调度器和定时清理任务
 */

export async function startSchedulers(): Promise<void> {
  // 启动流量调度器
  const { startTrafficScheduler } = await import('../services/traffic-scheduler.js')
  startTrafficScheduler()

  // 启动自动快照/备份调度器
  const { startAutoPolicyScheduler } = await import('../services/auto-policy-scheduler.js')
  startAutoPolicyScheduler()

  // 启动计费调度器（自动续费、到期封停、到期删除、到期提醒）
  const { startBillingScheduler } = await import('../services/billing-scheduler.js')
  startBillingScheduler()

  // 启动邮箱订阅过期检查调度器
  const { startMailExpiryScheduler } = await import('../services/mail-expiry-scheduler.js')
  startMailExpiryScheduler()

  // 启动托管余额调度器（解冻）
  const { startHostingScheduler } = await import('../services/hosting-scheduler.js')
  startHostingScheduler()

  // 启动实例状态同步调度器
  const { startStatusScheduler } = await import('../services/status-scheduler.js')
  startStatusScheduler()

  // 启动实例操作任务调度器
  const { cleanupStaleTasks: cleanupStaleInstanceTasks, startInstanceTaskWorker } = await import('../workers/instanceTaskWorker.js')
  await cleanupStaleInstanceTasks()
  startInstanceTaskWorker()
  console.log('⚙️ 实例操作任务调度器已启动')

  // 启动宿主机通知邮件队列 Worker
  const {
    cleanupStaleHostNotificationEmailTasks,
    startHostNotificationEmailWorker
  } = await import('../workers/hostNotificationEmailWorker.js')
  const staleHostNotificationEmailTasks = await cleanupStaleHostNotificationEmailTasks()
  if (staleHostNotificationEmailTasks > 0) {
    console.log(`📧 重新入队了 ${staleHostNotificationEmailTasks} 个宿主机通知邮件任务`)
  }
  startHostNotificationEmailWorker()
  console.log('📧 宿主机通知邮件队列已启动')

  // 启动终端会话清理任务
  const { startSessionCleanup } = await import('../lib/terminal-proxy.js')
  startSessionCleanup()
  console.log('🖥️ 终端会话清理任务已启动')

  // 清理卡住的转移 processing 状态
  const { cleanupStaleTransfers, cleanupTimeoutTransfers } = await import('../db/transfers.js')
  const staleTransfers = await cleanupStaleTransfers()
  if (staleTransfers > 0) {
    console.log(`🔄 清理了 ${staleTransfers} 个卡住的转移请求`)
  }
  // 定期检查超时的 processing 状态（每5分钟）
  setInterval(async () => {
    try {
      const count = await cleanupTimeoutTransfers()
      if (count > 0) {
        console.log(`🔄 清理了 ${count} 个超时的转移请求`)
      }
    } catch (err) {
      console.error('转移超时清理失败:', err)
    }
  }, 5 * 60 * 1000) // 5分钟

  // 启动创建超时清理任务（清理10分钟仍处于创建中的实例）
  const { getStuckCreatingInstances, getHostById } = await import('../db/index.js')
  const { getIncusClient, deleteInstance } = await import('../lib/incus/index.js')
  const { createLog } = await import('../db/logs.js')
  const CREATE_TIMEOUT_MS = 10 * 60 * 1000 // 10分钟
  const CREATE_TIMEOUT_CHECK_INTERVAL = 2 * 60 * 1000 // 每2分钟检查一次

  const runCreateTimeoutCleanup = async () => {
    try {
      const stuckInstances = await getStuckCreatingInstances(CREATE_TIMEOUT_MS)

      for (const instance of stuckInstances) {
        console.log(`[CreateTimeout] 清理超时创建实例: ${instance.name} (ID: ${instance.id})`)

        // 使用原子操作更新状态，防止与 createInstanceAsync 的失败回滚竞争
        const { prisma } = await import('../db/prisma.js')
        const updateResult = await prisma.instance.updateMany({
          where: {
            id: instance.id,
            status: 'creating'
          },
          data: {
            status: 'error'
          }
        })

        if (updateResult.count === 0) {
          console.log(`[CreateTimeout] 实例 ${instance.name} 状态已被其他进程修改，跳过清理`)
          continue
        }

        // 回滚资源
        try {
          const { rollbackResources } = await import('../db/index.js')
          await rollbackResources({
            hostId: instance.host_id,
            cpu: instance.cpu,
            memory: instance.memory,
            disk: instance.disk,
            portCount: instance.network_mode === 'nat' ? (instance.port_limit || 0) : 0
          })
          console.log(`[CreateTimeout] 实例 ${instance.name} 资源已回滚`)
        } catch (rollbackErr) {
          console.error(`[CreateTimeout] 资源回滚失败:`, rollbackErr)
        }

        // 尝试清理 Incus 残留
        try {
          const host = await getHostById(instance.host_id)
          if (host) {
            const client = await getIncusClient(host)
            await deleteInstance(client, instance.incus_id)
            console.log(`[CreateTimeout] 残留容器 ${instance.incus_id} 已清理`)
          }
        } catch (cleanupErr) {
          console.log(`[CreateTimeout] 清理残留容器失败 (可能不存在)`)
        }

        // 发送用户通知
        try {
          const { sendNotification } = await import('../lib/notifier.js')
          const host = await getHostById(instance.host_id)
          await sendNotification(instance.user_id, 'instance_create_timeout', {
            instanceName: instance.name,
            hostName: host?.name || undefined
          })
        } catch (notifyErr) {
          console.error(`[CreateTimeout] 发送通知失败:`, notifyErr)
        }

        // 记录日志
        await createLog(
          instance.user_id,
          'instance',
          'instance.create_timeout',
          `Instance "${instance.name}" creation timed out after 10 minutes`,
          'failed',
          { instanceId: instance.id }
        )
      }

      if (stuckInstances.length > 0) {
        console.log(`[CreateTimeout] 清理了 ${stuckInstances.length} 个超时创建实例`)
      }
    } catch (err) {
      console.error('[CreateTimeout] 清理失败:', err)
    }
  }
  setInterval(runCreateTimeoutCleanup, CREATE_TIMEOUT_CHECK_INTERVAL)
  runCreateTimeoutCleanup()
  console.log('⏱️ 创建超时清理任务已启动（10分钟超时）')

  // 启动实例任务清理定时任务（清理7天前的已完成任务）
  const { cleanupOldTasks } = await import('../db/instance-tasks.js')
  const runInstanceTaskCleanup = async () => {
    try {
      const deleted = await cleanupOldTasks()
      if (deleted > 0) {
        console.log(`⚙️ 实例任务清理完成，删除 ${deleted} 条过期任务`)
      }
    } catch (err) {
      console.error('实例任务清理失败:', err)
    }
  }
  setInterval(runInstanceTaskCleanup, 24 * 60 * 60 * 1000)
  runInstanceTaskCleanup()

  // 启动站内信清理定时任务（30 天前的消息）
  const { cleanupOldMessages } = await import('../db/inbox.js')
  const runInboxCleanup = async () => {
    try {
      const deleted = await cleanupOldMessages(30)
      if (deleted > 0) {
        console.log(`📨 站内信清理完成，删除 ${deleted} 条过期消息`)
      }
    } catch (err) {
      console.error('站内信清理失败:', err)
    }
  }
  setInterval(runInboxCleanup, 24 * 60 * 60 * 1000)
  runInboxCleanup()

  // 启动系统健康监控
  const { startSystemMonitor } = await import('../services/system-monitor.js')
  startSystemMonitor()

  // 启动工单自动关闭调度器
  const { startTicketAutoCloseScheduler } = await import('../services/ticket-auto-close-scheduler.js')
  startTicketAutoCloseScheduler()

  // 启动节点连接地址监控
  const { startHostAddressMonitor } = await import('../services/host-address-monitor.js')
  startHostAddressMonitor()
}

/**
 * 停止调度器（优雅关闭时调用）
 */
export async function stopSchedulers(): Promise<void> {
  const { stopSessionCleanup } = await import('../lib/terminal-proxy.js')
  stopSessionCleanup()

  const { stopHostNotificationEmailWorker } = await import('../workers/hostNotificationEmailWorker.js')
  stopHostNotificationEmailWorker()

  // 关闭所有活跃终端会话
  const { closeAllSessions } = await import('../lib/terminal-proxy.js')
  const closedSessions = closeAllSessions('Server shutdown')
  if (closedSessions > 0) {
    console.log(`🖥️ 关闭了 ${closedSessions} 个终端会话`)
  }
}
