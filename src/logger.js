const MAX_LOGS = 500;
const logsBuffer = [];

/**
 * Custom Logger System
 */
export const logger = {
  /**
   * Log an event
   * @param {'INFO'|'SUCCESS'|'WARN'|'ERROR'} level 
   * @param {string} message 
   * @param {Object} [meta] 
   */
  log(level, message, meta = null) {
    const logEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      message,
      meta
    };

    logsBuffer.unshift(logEntry);

    if (logsBuffer.length > MAX_LOGS) {
      logsBuffer.pop();
    }

    // Print to stdout/stderr
    const consoleMsg = `[${logEntry.timeFormatted}] [${level}] ${message}`;
    if (level === 'ERROR') {
      console.error(consoleMsg);
    } else if (level === 'WARN') {
      console.warn(consoleMsg);
    } else {
      console.log(consoleMsg);
    }

    return logEntry;
  },

  info(message, meta) {
    return this.log('INFO', message, meta);
  },

  success(message, meta) {
    return this.log('SUCCESS', message, meta);
  },

  warn(message, meta) {
    return this.log('WARN', message, meta);
  },

  error(message, meta) {
    return this.log('ERROR', message, meta);
  },

  getLogs(levelFilter = null) {
    if (!levelFilter || levelFilter === 'ALL') {
      return [...logsBuffer];
    }
    return logsBuffer.filter((l) => l.level === levelFilter);
  },

  clearLogs() {
    logsBuffer.length = 0;
  }
};
