import type { ResideoDevice } from '../api/resideoClient.js'
import type { ResideoPlatform } from '../platform.js'
import type { ResideoPlatformConfig } from '../settings.js'
import type { LogLevel } from './logging.js'
// Static regexes for version parsing (for lint rule e18e/prefer-static-regex)
/**
 * Abstract base class for all Homebridge FirstAlert device types.
 * Provides core logic, logging, config, and extensible command pattern for subclasses.
 * @copyright 2022-2026, donavanbecker (https://github.com/donavanbecker)
 */
import type { API, HAP, Logging, PlatformAccessory } from 'homebridge'

import { handleError, logMessage } from './logging.js'

export abstract class deviceBase {
  /**
   * Command registry for extensible command pattern
   */
  private commandRegistry: Map<string, (...args: any[]) => Promise<any>> = new Map()

  /**
   * Register a command handler for this device
   * @param commandName The name of the command
   * @param handler The async function to handle the command
   */
  public registerCommand(commandName: string, handler: (...args: any[]) => Promise<any>): void {
    this.commandRegistry.set(commandName, handler)
  }

  /**
   * Execute a registered command by name
   * @param commandName The name of the command
   * @param args Arguments to pass to the command handler
   */
  public async executeCommand(commandName: string, ...args: any[]): Promise<any> {
    const handler = this.commandRegistry.get(commandName)
    if (!handler) {
      throw new Error(`Command '${commandName}' not registered for this device.`)
    }
    return handler(...args)
  }
  /**
   * Abstract: Parse the device status from the API/device state
   */
  abstract parseStatus(...args: any[]): Promise<void>

  /**
   * Abstract: Refresh the device status from the API
   */
  abstract refreshStatus(...args: any[]): Promise<void>

  /**
   * Abstract: Update HomeKit characteristics from device state
   */
  abstract updateHomeKitCharacteristics(...args: any[]): Promise<void>
  public readonly api: API
  public readonly log: Logging
  public readonly config!: ResideoPlatformConfig
  protected readonly hap: HAP

  // Config
  protected deviceLogging!: string
  protected logLevel: LogLevel = 'info'
  protected deviceRefreshRate!: number
  protected devicePushRate!: number
  protected deviceFirmwareVersion!: string

  constructor(
    protected readonly platform: ResideoPlatform,
    protected accessory: PlatformAccessory,
    protected device: ResideoDevice,
  ) {
    this.api = (platform as any).api
    this.log = (platform as any).log
    this.config = (platform as any).config as ResideoPlatformConfig
    this.hap = (platform as any).api.hap

    this.getDeviceLogSettings()
    this.getDeviceRateSettings()
    this.getDeviceConfigSettings(device)
    this.getDeviceContext(accessory, device)

    // Set accessory information
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'FirstAlert')
      .setCharacteristic(this.hap.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.ConfiguredName, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.Model, accessory.context.model)
      .setCharacteristic(this.hap.Characteristic.SerialNumber, accessory.context.deviceID)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion)

    // Example: Register default commands in subclasses
    // this.registerCommand('refresh', this.refreshStatus.bind(this))
    // this.registerCommand('updateHomeKit', this.updateHomeKitCharacteristics.bind(this))
  }

  async getDeviceLogSettings(): Promise<void> {
    this.deviceLogging = 'standard'
    if (this.config && this.config.logLevel) {
      this.logLevel = this.config.logLevel as LogLevel
    }
    this.logDebug(`Using Device Logging: ${this.deviceLogging}, logLevel: ${this.logLevel}`)
  }

  /**
   * Centralized logging helpers using logging.ts utilities
   */
  logInfo(...log: any[]): void {
    logMessage({
      log: this.log,
      deviceName: this.device.name,
      accessoryName: this.accessory.displayName,
      logLevel: this.logLevel,
    }, 'info', ...log)
  }

  logSuccess(...log: any[]): void {
    logMessage({
      log: this.log,
      deviceName: this.device.name,
      accessoryName: this.accessory.displayName,
      logLevel: this.logLevel,
    }, 'success', ...log)
  }

  logWarn(...log: any[]): void {
    logMessage({
      log: this.log,
      deviceName: this.device.name,
      accessoryName: this.accessory.displayName,
      logLevel: this.logLevel,
    }, 'warn', ...log)
  }

  logError(...log: any[]): void {
    logMessage({
      log: this.log,
      deviceName: this.device.name,
      accessoryName: this.accessory.displayName,
      logLevel: this.logLevel,
    }, 'error', ...log)
  }

  logDebug(...log: any[]): void {
    logMessage({
      log: this.log,
      deviceName: this.device.name,
      accessoryName: this.accessory.displayName,
      logLevel: this.logLevel,
    }, 'debug', ...log)
  }

  handleError(error: any, action: string): void {
    handleError({
      log: this.log,
      deviceName: this.device.name,
      accessoryName: this.accessory.displayName,
      logLevel: this.logLevel,
    }, error, action)
  }

  async getDeviceRateSettings(): Promise<void> {
    // Allow config override, fallback to defaults
    this.deviceRefreshRate = (this.config && typeof this.config.refreshRate === 'number') ? this.config.refreshRate : 120
    this.devicePushRate = (this.config && typeof this.config.pushRate === 'number') ? this.config.pushRate : 0.1
    this.logDebug(`Using refreshRate: ${this.deviceRefreshRate}, pushRate: ${this.devicePushRate}`)
  }

  async getDeviceConfigSettings(device: ResideoDevice): Promise<void> {
    this.logDebug(`Config: ${JSON.stringify(device)}`)
  }

  async getDeviceContext(accessory: PlatformAccessory, device: ResideoDevice): Promise<void> {
    accessory.context.model = device.globalDeviceType
    accessory.context.deviceID = device.deviceId
    accessory.context.deviceType = device.globalDeviceType
    // FirmwareRevision (hardcoded for now)
    const version = '0.0.0'
    this.deviceFirmwareVersion = version
    accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.HardwareRevision, this.deviceFirmwareVersion)
      .setCharacteristic(this.hap.Characteristic.SoftwareRevision, this.deviceFirmwareVersion)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, this.deviceFirmwareVersion)
      .getCharacteristic(this.hap.Characteristic.FirmwareRevision)
      .updateValue(this.deviceFirmwareVersion)
    this.logDebug(`deviceFirmwareVersion: ${this.deviceFirmwareVersion}`)
  }

  async statusCode(statusCode: number, action: string): Promise<void> {
    switch (statusCode) {
      case 200:
        this.logDebug(`${this.device.name}: ${this.accessory.displayName} Standard Response, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 400:
        this.logError(`${this.device.name}: ${this.accessory.displayName} Bad Request, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 401:
        this.logError(`${this.device.name}: ${this.accessory.displayName} Unauthorized, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 403:
        this.logError(`${this.device.name}: ${this.accessory.displayName} Forbidden, The request has been authenticated but does not have appropriate permissions, or a requested resource is not found, statusCode: ${statusCode}`)
        break
      case 404:
        this.logError(`${this.device.name}: ${this.accessory.displayName} Not Found, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 429:
        this.logError(`${this.device.name}: ${this.accessory.displayName} Too Many Requests, statusCode: ${statusCode}, Action: ${action}`)
        break
      case 500:
        this.logError(`${this.device.name}: ${this.accessory.displayName} Internal Server Error (Meater Server), statusCode: ${statusCode}, Action: ${action}`)
        break
      default:
        this.logInfo(`${this.device.name}: ${this.accessory.displayName} Unknown statusCode: ${statusCode}, Action: ${action}, Report Bugs Here: https://bit.ly/homebridge-firstalert-bug-report`)
    }
  }

  async resideoAPIError(e: any, action: string): Promise<void> {
    if (e.message.includes('400')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Bad Request`)
      this.logDebug('The client has issued an invalid request. This is commonly used to specify validation errors in a request payload.')
    } else if (e.message.includes('401')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Unauthorized Request`)
      this.logDebug('Authorization for the API is required, but the request has not been authenticated.')
    } else if (e.message.includes('403')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Forbidden Request`)
      this.logDebug('The request has been authenticated but does not have appropriate permissions, or a requested resource is not found.')
    } else if (e.message.includes('404')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Requst Not Found`)
      this.logDebug('Specifies the requested path does not exist.')
    } else if (e.message.includes('406')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Request Not Acceptable`)
      this.logDebug('The client has requested a MIME type via the Accept header for a value not supported by the server.')
    } else if (e.message.includes('415')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Unsupported Requst Header`)
      this.logDebug('The client has defined a contentType header that is not supported by the server.')
    } else if (e.message.includes('422')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Unprocessable Entity`)
      this.logDebug(
        'The client has made a valid request, but the server cannot process it.'
        + ' This is often used for APIs for which certain limits have been exceeded.',
      )
    } else if (e.message.includes('429')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Too Many Requests`)
      this.logDebug('The client has exceeded the number of requests allowed for a given time window.')
    } else if (e.message.includes('500')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action}, Internal Server Error`)
      this.logDebug('An unexpected error on the SmartThings servers has occurred. These errors should be rare.')
    } else {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to ${action},`)
    }
    if (this.deviceLogging.includes('debug')) {
      this.logError(`${this.device.name}: ${this.accessory.displayName} failed to pushChanges, Error Message: ${JSON.stringify(e.message)}`)
    }
  }

  /**
   * Logging for Device
   */
  // Removed redundant log methods; use centralized helpers above
}
