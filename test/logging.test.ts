import type { LogLevel } from '../src/devices/logging.js'

import { describe, expect, it, vi } from 'vitest'

import { handleError, logMessage } from '../src/devices/logging.js'

describe('logging utilities', () => {
  const log = {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  const logger = {
    log,
    deviceName: 'TestDevice',
    accessoryName: 'TestAccessory',
    logLevel: 'debug' as LogLevel,
  }

  it('logs messages at each level', () => {
    logMessage(logger, 'info', 'info')
    logMessage(logger, 'success', 'success')
    logMessage(logger, 'warn', 'warn')
    logMessage(logger, 'error', 'error')
    logMessage(logger, 'debug', 'debug')
    expect(log.info).toHaveBeenCalledWith('[INFO] TestDevice: TestAccessory', 'info')
    expect(log.success).toHaveBeenCalledWith('[SUCCESS] TestDevice: TestAccessory', 'success')
    expect(log.warn).toHaveBeenCalledWith('[WARN] TestDevice: TestAccessory', 'warn')
    expect(log.error).toHaveBeenCalledWith('[ERROR] TestDevice: TestAccessory', 'error')
    expect(log.debug).toHaveBeenCalledWith('[DEBUG] TestDevice: TestAccessory', 'debug')
  })

  it('handleError logs error and debug', () => {
    handleError(logger, new Error('fail'), 'action')
    expect(log.error).toHaveBeenCalledWith('[ERROR] TestDevice: TestAccessory', 'Failed to action:', 'fail')
    expect(log.debug).toHaveBeenCalledWith('[DEBUG] TestDevice: TestAccessory', 'Error details:', JSON.stringify(new Error('fail')))
  })
})
