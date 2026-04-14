import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge'

import type { FirstAlertDeviceConfig, FirstAlertPluginConfig } from './settings.js'

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

/**
 * Homebridge platform class for First Alert HAP (HomeKit Accessory Protocol) integration.
 *
 * Handles device registration and accessory lifecycle for First Alert
 * smoke and carbon monoxide detectors via the HAP protocol.
 */
export class FirstAlertHAPPlatform implements DynamicPlatformPlugin {
  /** Homebridge API instance */
  readonly api: API
  /** Homebridge logger instance */
  readonly log: Logger
  /** Parsed plugin config */
  readonly config: FirstAlertPluginConfig

  /**
   * Map of cached accessories restored from disk, keyed by UUID.
   * Used by DynamicPlatformPlugin to avoid re-registering accessories on restart.
   */
  readonly accessories: Map<string, PlatformAccessory> = new Map()

  constructor(log: Logger, config: PlatformConfig, api: API) {
    this.log = log
    this.config = config as FirstAlertPluginConfig
    this.api = api

    this.log.debug('Finished initializing platform:', this.config.name)

    // Register accessories after Homebridge has finished launching
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback')
      this.discoverDevices()
    })
  }

  /**
   * Called by Homebridge when a cached accessory is restored from disk.
   * Must be implemented by DynamicPlatformPlugin.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName)
    this.accessories.set(accessory.UUID, accessory)
  }

  /**
   * Discover and register all configured devices as HAP accessories.
   *
   * Devices with `external: true` are published via `api.publishExternalAccessories()`
   * so they appear as standalone HomeKit accessories (with their own pairing code)
   * rather than being bridged through Homebridge.
   */
  discoverDevices(): void {
    const devices: FirstAlertDeviceConfig[] = this.config.devices ?? []
    const enabledDevices = devices.filter(d => d.enabled !== false)

    const externalDevices = enabledDevices.filter(d => d.external === true)
    const bridgedDevices = enabledDevices.filter(d => d.external !== true)

    // UUIDs that should remain in the bridged cache after this run
    const bridgedUUIDs = new Set(bridgedDevices.map(d => this.api.hap.uuid.generate(d.deviceId)))

    // Capitalize the constructor reference to satisfy the new-cap lint rule
    const PlatformAccessory = this.api.platformAccessory

    // ── External accessories ────────────────────────────────────────────────
    const toPublishExternal: PlatformAccessory[] = []
    for (const device of externalDevices) {
      const uuid = this.api.hap.uuid.generate(device.deviceId)

      // If this device was previously registered as a bridged accessory, remove it first
      const bridgedAccessory = this.accessories.get(uuid)
      if (bridgedAccessory) {
        this.log.info('Migrating accessory from bridged to external:', bridgedAccessory.displayName)
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [bridgedAccessory])
        this.accessories.delete(uuid)
      }

      const displayName = device.name ?? `First Alert ${device.deviceId}`
      this.log.info('Publishing external accessory:', displayName)
      const accessory = new PlatformAccessory(displayName, uuid)
      accessory.context.device = device
      this.setupAccessoryServices(accessory, device)
      toPublishExternal.push(accessory)
    }

    if (toPublishExternal.length > 0) {
      this.api.publishExternalAccessories(PLUGIN_NAME, toPublishExternal)
    }

    // ── Bridged accessories ─────────────────────────────────────────────────
    for (const device of bridgedDevices) {
      const uuid = this.api.hap.uuid.generate(device.deviceId)
      const existingAccessory = this.accessories.get(uuid)

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName)
        this.setupAccessoryServices(existingAccessory, device)
        this.api.updatePlatformAccessories([existingAccessory])
      }
      else {
        const displayName = device.name ?? `First Alert ${device.deviceId}`
        this.log.info('Adding new accessory:', displayName)

        const accessory = new PlatformAccessory(displayName, uuid)
        accessory.context.device = device

        this.setupAccessoryServices(accessory, device)
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        this.accessories.set(uuid, accessory)
      }
    }

    // Remove bridged accessories that are no longer in the config (or switched to external)
    for (const [uuid, accessory] of this.accessories) {
      if (!bridgedUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName)
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        this.accessories.delete(uuid)
      }
    }
  }

  /**
   * Configure the HomeKit services on a HAP accessory based on the device type.
   *
   * @param accessory The platform accessory to configure
   * @param device The device configuration
   */
  protected setupAccessoryServices(accessory: PlatformAccessory, device: FirstAlertDeviceConfig): void {
    accessory.context.device = device

    // Add the AccessoryInformation service
    const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation)
      ?? accessory.addService(this.api.hap.Service.AccessoryInformation)

    infoService
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'First Alert')
      .setCharacteristic(this.api.hap.Characteristic.Model, this.getModelName(device.deviceType))
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.deviceId)

    // Configure services based on device type
    switch (device.deviceType) {
      case 'smoke':
        this.setupSmokeService(accessory)
        break
      case 'co':
        this.setupCOService(accessory)
        break
      case 'smoke-co':
        this.setupSmokeService(accessory)
        this.setupCOService(accessory)
        break
      default:
        this.log.warn('Unknown device type:', (device as any).deviceType)
    }
  }

  /**
   * Configure a smoke sensor service on the accessory.
   */
  protected setupSmokeService(accessory: PlatformAccessory): Service {
    const service = accessory.getService(this.api.hap.Service.SmokeSensor)
      ?? accessory.addService(this.api.hap.Service.SmokeSensor)

    service
      .getCharacteristic(this.api.hap.Characteristic.SmokeDetected)
      .onGet(() => this.api.hap.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED)

    service
      .getCharacteristic(this.api.hap.Characteristic.StatusActive)
      .onGet(() => true)

    return service
  }

  /**
   * Configure a carbon monoxide sensor service on the accessory.
   */
  protected setupCOService(accessory: PlatformAccessory): Service {
    const service = accessory.getService(this.api.hap.Service.CarbonMonoxideSensor)
      ?? accessory.addService(this.api.hap.Service.CarbonMonoxideSensor)

    service
      .getCharacteristic(this.api.hap.Characteristic.CarbonMonoxideDetected)
      .onGet(() => this.api.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL)

    service
      .getCharacteristic(this.api.hap.Characteristic.StatusActive)
      .onGet(() => true)

    return service
  }

  /**
   * Return a human-readable model name for the given device type.
   */
  private getModelName(deviceType: FirstAlertDeviceConfig['deviceType']): string {
    switch (deviceType) {
      case 'smoke': return 'Smoke Detector'
      case 'co': return 'Carbon Monoxide Detector'
      case 'smoke-co': return 'Smoke/CO Detector'
      default: return 'Unknown Detector'
    }
  }
}
