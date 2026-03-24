// Centralized error handling and logging utilities for device classes
import type { Logging } from 'homebridge'

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug'

export interface Logger {
  log: Logging
  deviceName: string
  accessoryName: string
  logLevel: LogLevel
}

export function logMessage(logger: Logger, level: LogLevel, ...messages: any[]): void {
  if (shouldLog(level, logger.logLevel)) {
    const prefix = `[${level.toUpperCase()}] ${logger.deviceName}: ${logger.accessoryName}`
    switch (level) {
      case 'info':
        logger.log.info(prefix, ...messages)
        break
      case 'success':
        logger.log.success ? logger.log.success(prefix, ...messages) : logger.log.info(prefix, ...messages)
        break
      case 'warn':
        logger.log.warn(prefix, ...messages)
        break
      case 'error':
        logger.log.error(prefix, ...messages)
        break
      case 'debug':
        logger.log.debug(prefix, ...messages)
        break
    }
  }
}

export function shouldLog(level: LogLevel, currentLevel: LogLevel): boolean {
  const order = ['error', 'warn', 'success', 'info', 'debug']
  return order.indexOf(level) <= order.indexOf(currentLevel)
}

export function handleError(logger: Logger, error: any, action: string): void {
  logMessage(logger, 'error', `Failed to ${action}:`, error?.message || error)
  if (logger.logLevel === 'debug') {
    logMessage(logger, 'debug', `Error details:`, JSON.stringify(error))
  }
}
