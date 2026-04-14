import type { API, Logger, MatterAccessory, PlatformConfig } from 'homebridge'

import type { FirstAlertDeviceConfig, FirstAlertPluginConfig } from './settings.js'

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

/**
 * Homebridge platform class for First Alert Matter integration.
 *
 * Handles device registration and accessory lifecycle for First Alert
 * smoke and carbon monoxide detectors via the Matter protocol.
 *
 * When Matter is available and enabled, this platform is used in preference to
 * {@link FirstAlertHAPPlatform} because Matter accessories are exposed natively
 * to all Matter controllers (e.g. Apple Home, Google Home, Amazon Alexa) without
 * the overhead of the HAP bridge protocol.
 */
export class FirstAlertMatterPlatform {
  /** Homebridge API instance */
  readonly api: API
  /** Homebridge logger instance */
  readonly log: Logger
  /** Parsed plugin config */
  readonly config: FirstAlertPluginConfig

  /**
   * Map of cached Matter accessories restored from disk, keyed by UUID.
   */
  readonly matterAccessories: Map<string, MatterAccessory> = new Map()

  constructor(log: Logger, config: PlatformConfig, api: API) {
    this.log = log
    this.config = config as FirstAlertPluginConfig
    this.api = api

    this.log.debug('Finished initializing First Alert Matter platform:', this.config.name)

    if (!this.api.isMatterAvailable?.()) {
      this.log.warn('Matter is not available in this version of Homebridge. Please update Homebridge to v2.0+.')
      return
    }

    if (!this.api.isMatterEnabled?.()) {
      this.log.warn('Matter is not enabled in Homebridge. Please enable Matter in the Homebridge settings.')
      return
    }

    // Register Matter accessories after Homebridge has finished launching
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback (Matter)')
      void this.discoverDevices()
    })
  }

  /**
   * Called by Homebridge when a cached HAP accessory is restored from disk.
   * This platform uses Matter accessories, so this is a no-op.
   */
  configureAccessory(): void {
    // Not used – Matter accessories are handled via configureMatterAccessory
  }

  /**
   * Called by Homebridge when a cached Matter accessory is restored from disk.
   */
  configureMatterAccessory(accessory: MatterAccessory): void {
    this.log.info('Loading cached Matter accessory:', accessory.displayName)
    this.matterAccessories.set(accessory.UUID, accessory)
  }

  /**
   * Discover and register all configured devices as Matter accessories.
   */
  async discoverDevices(): Promise<void> {
    const devices: FirstAlertDeviceConfig[] = this.config.devices ?? []

    const toRegister: MatterAccessory[] = []

    // Build the set of UUIDs that should be present
    const configuredUUIDs = new Set<string>()

    for (const device of devices) {
      if (device.enabled === false) {
        this.log.debug('Skipping disabled device:', device.deviceId)
        continue
      }

      const uuid = this.api.matter.uuid.generate(device.deviceId)
      configuredUUIDs.add(uuid)

      const existingAccessory = this.matterAccessories.get(uuid)
      if (existingAccessory) {
        this.log.info('Restoring existing Matter accessory from cache:', existingAccessory.displayName)
        // Nothing extra needed – the accessory is already tracked
        continue
      }

      const displayName = device.name ?? `First Alert ${device.deviceId}`
      this.log.info('Adding new Matter accessory:', displayName)

      const accessory = this.createMatterAccessory(uuid, displayName, device)
      if (accessory) {
        toRegister.push(accessory)
        this.matterAccessories.set(uuid, accessory)
      }
    }

    if (toRegister.length > 0) {
      await this.api.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister)
      this.log.info(`Registered ${toRegister.length} Matter accessor${toRegister.length === 1 ? 'y' : 'ies'}`)
    }

    // Remove accessories that are no longer in the config
    for (const [uuid, accessory] of this.matterAccessories) {
      if (!configuredUUIDs.has(uuid)) {
        this.log.info('Removing stale Matter accessory:', accessory.displayName)
        await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
        this.matterAccessories.delete(uuid)
      }
    }
  }

  /**
   * Create a Matter accessory for a given device configuration.
   *
   * Returns `null` if the device type is not supported as a Matter device.
   *
   * @param uuid The UUID for this accessory
   * @param displayName The display name for this accessory
   * @param device The device configuration
   */
  protected createMatterAccessory(uuid: string, displayName: string, device: FirstAlertDeviceConfig): MatterAccessory | null {
    switch (device.deviceType) {
      case 'smoke':
        return this.createSmokeSensorAccessory(uuid, displayName, device)
      case 'co':
        return this.createCOSensorAccessory(uuid, displayName, device)
      case 'smoke-co':
        return this.createSmokeCOAccessory(uuid, displayName, device)
      default:
        this.log.warn('Unknown device type, cannot create Matter accessory:', (device as any).deviceType)
        return null
    }
  }

  /**
   * Create a Matter smoke sensor accessory using the SmokeSensor device type
   * with the SmokeAlarm feature enabled.
   */
  protected createSmokeSensorAccessory(uuid: string, displayName: string, device: FirstAlertDeviceConfig): MatterAccessory {
    const deviceType = this.api.matter.deviceTypes.SmokeSensor.with(
      this.api.matter.deviceTypes.SmokeSensor.requirements.SmokeCoAlarmServer.with('SmokeAlarm'),
    )
    return this.buildMatterAccessory(uuid, displayName, device, deviceType, 'Smoke Detector')
  }

  /**
   * Create a Matter carbon monoxide sensor accessory using the SmokeSensor device type
   * with the CoAlarm feature enabled.
   */
  protected createCOSensorAccessory(uuid: string, displayName: string, device: FirstAlertDeviceConfig): MatterAccessory {
    const deviceType = this.api.matter.deviceTypes.SmokeSensor.with(
      this.api.matter.deviceTypes.SmokeSensor.requirements.SmokeCoAlarmServer.with('CoAlarm'),
    )
    return this.buildMatterAccessory(uuid, displayName, device, deviceType, 'CO Detector')
  }

  /**
   * Create a combined smoke and carbon monoxide sensor Matter accessory using the
   * SmokeSensor device type with both SmokeAlarm and CoAlarm features enabled.
   */
  protected createSmokeCOAccessory(uuid: string, displayName: string, device: FirstAlertDeviceConfig): MatterAccessory {
    const deviceType = this.api.matter.deviceTypes.SmokeSensor.with(
      this.api.matter.deviceTypes.SmokeSensor.requirements.SmokeCoAlarmServer.with('SmokeAlarm', 'CoAlarm'),
    )
    return this.buildMatterAccessory(uuid, displayName, device, deviceType, 'Smoke/CO Detector')
  }

  /**
   * Build a plain {@link MatterAccessory} object from the given parameters.
   */
  private buildMatterAccessory(
    uuid: string,
    displayName: string,
    device: FirstAlertDeviceConfig,
    deviceType: any,
    model: string,
  ): MatterAccessory {
    return {
      UUID: uuid,
      displayName,
      deviceType,
      serialNumber: device.deviceId,
      manufacturer: 'First Alert',
      model,
      firmwareRevision: '1.0.0',
      hardwareRevision: '1.0.0',
      context: { device },
      clusters: {
        smokeCoAlarm: {
          smokeState: 0,
          coState: 0,
          batteryAlert: 0,
          deviceMuted: 0,
          testInProgress: false,
          hardwareFaultAlert: false,
          endOfServiceAlert: 0,
          interconnectSmokeAlarm: 0,
          interconnectCoAlarm: 0,
          contaminationState: 0,
          smokeSensitivityLevel: 1,
          expressedState: 0,
        },
      },
    }
  }
}
