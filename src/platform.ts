import type { deviceBase } from './devices/device.js'
import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge'

import { ResideoClient } from './api/resideoClient.js'
import { LeakSensor } from './devices/leaksensors.js'
import { SmokeSensor } from './devices/smoke.js'
import { Thermostats } from './devices/thermostats.js'
import { Valve } from './devices/valve.js'

export class ResideoPlatform implements DynamicPlatformPlugin {
  private readonly log: Logger
  private readonly config: PlatformConfig
  private readonly api: API
  private readonly pollInterval: number
  public readonly client!: ResideoClient
  private pollTimer?: any
  private accessories: PlatformAccessory[] = []
  private deviceInstances: Record<string, deviceBase> = {}
  private unsupportedDeviceIds: Set<string> = new Set()

  constructor(log: Logger, config: PlatformConfig, api: API) {
    this.log = log
    this.config = config
    this.api = api
    this.pollInterval = config.pollInterval || 60
    if (!config.refreshToken) {
      this.log.error('No refresh token configured. Please log in via the Homebridge UI.')
      return
    }
    this.client = new ResideoClient(config.refreshToken, this.log)
    api.on('didFinishLaunching', () => this.discoverDevices())
  }

  async discoverDevices() {
    try {
      const account = await this.client.getAccount()
      const unknownTypes: string[] = []
      for (const device of account.devices) {
      // Find or create accessory
        let accessory = this.accessories.find(a => a.context.deviceID === device.deviceId)
        if (!accessory) {
          this.log.info(`[Register] Registering new accessory: ${device.name} (${device.deviceId})`)
          accessory = new this.api.platformAccessory(device.name, this.api.hap.uuid.generate(device.deviceId))
          accessory.context.deviceID = device.deviceId
          accessory.context.deviceType = device.globalDeviceType
          this.api.registerPlatformAccessories('@homebridge-plugins/homebridge-firstalert', 'FirstAlert', [accessory])
          this.accessories.push(accessory)
        } else {
          this.log.info(`[Restore] Found existing accessory: ${device.name} (${device.deviceId})`)
        }
        // Instantiate correct device class
        let instance: deviceBase | undefined
        switch (device.globalDeviceType) {
          case 'thermostat':
          case 'Fuji_X2S':
          case 'FujiThermostat':
          case 'Denali_X8S':
          case 'DenaliThermostat':
            instance = new Thermostats(this, accessory, device as any)
            break
          case 'leakSensor':
            instance = new LeakSensor(this, accessory, device as any)
            break
          case 'valve':
          case 'ShutoffValve_L7_T':
          case 'SmartMeterValve':
            instance = new Valve(this, accessory, device as any)
            break
          case 'smoke':
          case 'smokeSensor':
          case 'smokeDetector':
          case 'carbonMonoxideSensor':
          case 'carbonDioxideSensor':
          case 'Citadel_SC5':
            instance = new SmokeSensor(this, accessory, device as any)
            break
          case 'LevitonDimmerModel_1':
            this.log.debug(`Device ${device.name} (${device.deviceId}) is a Leviton Dimmer which is not currently supported. Please contact the developer if you have this device.`)
            this.unsupportedDeviceIds.add(device.deviceId)
            break
          default:
            unknownTypes.push(`${device.globalDeviceType} (${device.deviceId})`)
        }
        if (instance) {
          this.deviceInstances[device.deviceId] = instance
        }
        this.log.info(`[Discover] ${device.name} (${device.deviceId}) type: ${device.globalDeviceType}`)
      }
      if (unknownTypes.length > 0) {
        this.log.warn(`[Unknown Types] The following device types are not handled: ${unknownTypes.join(', ')}`)
      }
      this.startPolling(account.devices.map(d => d.deviceId))
    } catch (err) {
      this.log.error('Failed to discover devices:', err)
    }
  }

  startPolling(deviceIds: string[]) {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    this.pollTimer = setInterval(() => this.pollDevices(deviceIds), this.pollInterval * 1000)
    this.pollDevices(deviceIds) // Initial poll
  }

  async pollDevices(deviceIds: string[]) {
    for (const deviceId of deviceIds) {
      if (this.unsupportedDeviceIds.has(deviceId)) {
        // Skip polling logs for unsupported devices
        continue
      }
      const instance = this.deviceInstances[deviceId]
      if (instance && typeof (instance as any).updateState === 'function') {
        try {
          await (instance as any).updateState()
        } catch (err) {
          this.log.warn(`[Poll] Failed to update state for device ${deviceId}:`, err)
        }
      } else {
        try {
          const state = await this.client.getDeviceState(deviceId)
          // Filter DeviceNotInScaleUnit errors for clarity
          if (Array.isArray(state) && state[0]?.ErrorCode === 'DeviceNotInScaleUnit') {
            this.log.warn(`[Poll] Device ${deviceId} not in scale unit:`, state[0]?.Message)
          } else {
            this.log.debug(`[Poll] Polled device ${deviceId}:`, JSON.stringify(state))
          }
        } catch (err) {
          this.log.warn(`[Poll] Failed to poll device ${deviceId}:`, err)
        }
      }
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    // Required for restoring cached accessories
    this.accessories.push(accessory)
  }
}
