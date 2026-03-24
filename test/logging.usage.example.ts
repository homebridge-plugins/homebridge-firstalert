// Usage example for centralized logging utilities
// Usage example for centralized logging utilities
import type { LogLevel } from '../src/devices/logging.js'

import { handleError, logMessage } from '../src/devices/logging.js'

const logger = {
  log: Object.assign(
    (message: string, ...parameters: any[]) => console.warn('LOG', message, ...parameters),
    {
      prefix: '',
      info: (...args: any[]) => console.warn('INFO', ...args),
      success: (...args: any[]) => console.warn('SUCCESS', ...args),
      warn: (...args: any[]) => console.warn('WARN', ...args),
      error: (...args: any[]) => console.warn('ERROR', ...args),
      debug: (...args: any[]) => console.warn('DEBUG', ...args),
      log: (level: string, ...args: any[]) => console.warn(level.toUpperCase(), ...args),
    },
  ),
  deviceName: 'TestDevice',
  accessoryName: 'TestAccessory',
  logLevel: 'debug' as LogLevel,
}

logMessage(logger, 'info', 'This is an info message')
logMessage(logger, 'success', 'This is a success message')
logMessage(logger, 'warn', 'This is a warning')
logMessage(logger, 'error', 'This is an error')
logMessage(logger, 'debug', 'This is a debug message')
handleError(logger, new Error('Something went wrong'), 'testAction')
