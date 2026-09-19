import { logger } from './logger.js';

const tasksMap = new Map();

/**
 * Task Manager for tracking upload and batch progress
 */
export const taskManager = {
  /**
   * Create a new task
   * @param {string} name 
   * @param {'upload'|'batch-delete'|'batch-move'|'download'} type 
   * @param {number} total 
   * @returns {Object} Task object
   */
  createTask(name, type, total = 0) {
    const taskId = 'task_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const task = {
      id: taskId,
      name,
      type,
      status: 'running',
      progress: total === 0 ? 100 : 0,
      total,
      processed: 0,
      succeeded: 0,
      failedCount: 0,
      items: [],
      error: null,
      startTime: new Date().toISOString(),
      endTime: null
    };

    tasksMap.set(taskId, task);
    logger.info(`创建任务 [${name}] (ID: ${taskId}, 共 ${total} 项)`, { taskId, type, total });

    return task;
  },

  /**
   * Update task item result
   */
  updateTaskItem(taskId, itemResult, success = true) {
    const task = tasksMap.get(taskId);
    if (!task) return null;

    task.processed += 1;
    if (success) {
      task.succeeded += 1;
    } else {
      task.failedCount += 1;
    }

    task.items.push({
      timestamp: new Date().toISOString(),
      success,
      ...itemResult
    });

    task.progress = task.total > 0 ? Math.round((task.processed / task.total) * 100) : 100;

    if (task.processed >= task.total && task.status === 'running') {
      this.completeTask(taskId);
    }

    return task;
  },

  /**
   * Complete task
   */
  completeTask(taskId) {
    const task = tasksMap.get(taskId);
    if (!task) return null;

    task.status = 'completed';
    task.progress = 100;
    task.endTime = new Date().toISOString();

    logger.success(`任务 [${task.name}] 执行完成！成功: ${task.succeeded}, 失败: ${task.failedCount}`, { taskId });
    return task;
  },

  /**
   * Fail task
   */
  failTask(taskId, errorMsg) {
    const task = tasksMap.get(taskId);
    if (!task) return null;

    task.status = 'failed';
    task.error = errorMsg;
    task.endTime = new Date().toISOString();

    logger.error(`任务 [${task.name}] 执行失败: ${errorMsg}`, { taskId });
    return task;
  },

  /**
   * Get all tasks ordered by recent
   */
  getAllTasks() {
    return Array.from(tasksMap.values()).sort(
      (a, b) => new Date(b.startTime) - new Date(a.startTime)
    );
  },

  /**
   * Get single task by ID
   */
  getTask(taskId) {
    return tasksMap.get(taskId) || null;
  },

  /**
   * Clear task history
   */
  clearTasks() {
    tasksMap.clear();
  }
};
