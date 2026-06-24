-- AddTable: export_tasks
-- 导出任务持久化（替代内存 Map 存储）

CREATE TABLE "export_tasks" (
    "id" TEXT NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "backup_id" INTEGER NOT NULL,
    "incus_backup_name" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_tasks_user_id_idx" ON "export_tasks"("user_id");

-- CreateIndex
CREATE INDEX "export_tasks_expires_at_idx" ON "export_tasks"("expires_at");
