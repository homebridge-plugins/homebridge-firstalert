import type { API, Logger, MatterAccessory, PlatformAccessory, PlatformConfig } from 'homebridge'

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

  /**
   * HAP accessories restored from the Homebridge cache (e.g. from a previous
   * run in HAP mode). They must be unregistered at startup so they don't linger
   * alongside the newly-registered Matter accessories.
   */
  private readonly _legacyHapAccessories: PlatformAccessory[] = []

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
   *
   * This can happen when the plugin previously ran in HAP mode and the user
   * switches to Matter. We track the stale HAP accessories here and remove
   * them from Homebridge's cache at startup, preventing duplicate accessories
   * and stale HAP services from lingering alongside Matter accessories.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Queuing legacy HAP accessory for removal (migrating to Matter):', accessory.displayName)
    this._legacyHapAccessories.push(accessory)
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
   *
   * Devices with `external: true` are published via
   * `api.matter.publishExternalAccessories()` (when the API is available) so
   * they appear as standalone Matter devices rather than being bridged through
   * Homebridge. If the API is not available (older Homebridge build), they fall
   * back to the regular bridge registration with a warning.
   *
   * Also cleans up any legacy HAP accessories that were cached from a previous
   * HAP-mode run to prevent duplicate or stale accessories.
   */
  async discoverDevices(): Promise<void> {
    // Remove any HAP accessories that were left over from a previous HAP-mode run
    if (this._legacyHapAccessories.length > 0) {
      this.log.info(
        `Removing ${this._legacyHapAccessories.length} legacy HAP accessor${this._legacyHapAccessories.length === 1 ? 'y' : 'ies'} (migrated to Matter)`,
      )
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this._legacyHapAccessories)
      this._legacyHapAccessories.length = 0
    }

    const devices: FirstAlertDeviceConfig[] = this.config.devices ?? []
    const enabledDevices = devices.filter(d => d.enabled !== false)

    const externalDevices = enabledDevices.filter(d => d.external === true)
    const bridgedDevices = enabledDevices.filter(d => d.external !== true)

    // UUIDs that should remain in the bridged cache
    const configuredBridgedUUIDs = new Set<string>(bridgedDevices.map(d => this.api.matter.uuid.generate(d.deviceId)))

    const toRegister: MatterAccessory[] = []
    const toUpdate: MatterAccessory[] = []
    const toRegisterExternal: MatterAccessory[] = []

    // ── External accessories ────────────────────────────────────────────────
    for (const device of externalDevices) {
      const uuid = this.api.matter.uuid.generate(device.deviceId)

      // If previously bridged, unregister from the bridge first
      const bridgedAccessory = this.matterAccessories.get(uuid)
      if (bridgedAccessory) {
        this.log.info('Migrating Matter accessory from bridged to external:', bridgedAccessory.displayName)
        await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [bridgedAccessory])
        this.matterAccessories.delete(uuid)
      }

      const displayName = device.name ?? `First Alert ${device.deviceId}`
      this.log.info('Publishing external Matter accessory:', displayName)
      const accessory = this.createMatterAccessory(uuid, displayName, device)
      if (accessory) {
        toRegisterExternal.push(accessory)
      }
    }

    if (toRegisterExternal.length > 0) {
      // api.matter.publishExternalAccessories is available in Homebridge v2 builds that support
      // standalone Matter devices. Use a typed local to avoid repeating the cast.
      const matterApi = this.api.matter as any
      if (typeof matterApi.publishExternalAccessories === 'function') {
        await matterApi.publishExternalAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegisterExternal)
        this.log.info(`Published ${toRegisterExternal.length} external Matter ${this.pluralAccessory(toRegisterExternal.length)}`)
      }
      else {
        this.log.warn(
          'Matter external accessories are not supported in this version of Homebridge; '
          + 'registering through the bridge instead.',
        )
        toRegister.push(...toRegisterExternal)
      }
    }

    // ── Bridged accessories ─────────────────────────────────────────────────
    for (const device of bridgedDevices) {
      const uuid = this.api.matter.uuid.generate(device.deviceId)

      const existingAccessory = this.matterAccessories.get(uuid)
      if (existingAccessory) {
        const displayName = device.name ?? `First Alert ${device.deviceId}`
        const cachedDeviceType = (existingAccessory.context as any)?.device?.deviceType

        if (cachedDeviceType !== device.deviceType) {
          // Device type changed – must unregister and re-register with the new type
          this.log.info('Device type changed, re-registering Matter accessory:', displayName)
          await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory])
          this.matterAccessories.delete(uuid)

          const updated = this.createMatterAccessory(uuid, displayName, device)
          if (updated) {
            toRegister.push(updated)
            this.matterAccessories.set(uuid, updated)
          }
        }
        else if (existingAccessory.displayName !== displayName) {
          // Only the display name changed – update in place
          this.log.info('Updating Matter accessory name:', displayName)
          const updated = this.createMatterAccessory(uuid, displayName, device)
          if (updated) {
            toUpdate.push(updated)
            this.matterAccessories.set(uuid, updated)
          }
        }
        else {
          this.log.info('Restoring existing Matter accessory from cache:', existingAccessory.displayName)
        }

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
      this.log.info(`Registered ${toRegister.length} Matter ${this.pluralAccessory(toRegister.length)}`)
    }

    if (toUpdate.length > 0) {
      await this.api.matter.updatePlatformAccessories(toUpdate)
      this.log.info(`Updated ${toUpdate.length} Matter ${this.pluralAccessory(toUpdate.length)}`)
    }

    // Remove bridged accessories that are no longer in the config (or switched to external)
    for (const [uuid, accessory] of this.matterAccessories) {
      if (!configuredBridgedUUIDs.has(uuid)) {
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
   * Create a smoke-only Matter accessory.
   *
   * Uses the Homebridge `SmokeSensor` device-type alias (which maps to the
   * Matter specification `SmokeCoAlarm` device type, device ID 0x0076), with
   * only the `SmokeAlarm` feature cluster enabled.
   */
  protected createSmokeSensorAccessory(uuid: string, displayName: string, device: FirstAlertDeviceConfig): MatterAccessory {
    const deviceType = this.api.matter.deviceTypes.SmokeSensor.with(
      this.api.matter.deviceTypes.SmokeSensor.requirements.SmokeCoAlarmServer.with('SmokeAlarm'),
    )
    return this.buildMatterAccessory(uuid, displayName, device, deviceType, 'Smoke Detector')
  }

  /**
   * Create a carbon-monoxide-only Matter accessory.
   *
   * Uses the Homebridge `SmokeSensor` device-type alias (which maps to the
   * Matter specification `SmokeCoAlarm` device type, device ID 0x0076), with
   * only the `CoAlarm` feature cluster enabled.
   */
  protected createCOSensorAccessory(uuid: string, displayName: string, device: FirstAlertDeviceConfig): MatterAccessory {
    const deviceType = this.api.matter.deviceTypes.SmokeSensor.with(
      this.api.matter.deviceTypes.SmokeSensor.requirements.SmokeCoAlarmServer.with('CoAlarm'),
    )
    return this.buildMatterAccessory(uuid, displayName, device, deviceType, 'CO Detector')
  }

  /**
   * Create a combined smoke + carbon monoxide Matter accessory.
   *
   * Uses the Homebridge `SmokeSensor` device-type alias (which maps to the
   * Matter specification `SmokeCoAlarm` device type, device ID 0x0076), with
   * both `SmokeAlarm` and `CoAlarm` feature clusters enabled.
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

  /**
   * Return "accessory" or "accessories" based on count.
   */
  private pluralAccessory(count: number): string {
    return count === 1 ? 'accessory' : 'accessories'
  }
}
