import type { ResideoDevice } from '../api/resideoClient.js'
import type { ResideoPlatform } from '../platform.js'
import type { payload } from '../settings.js'
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import { interval, Subject } from 'rxjs'
import { debounceTime, skipWhile, take, tap } from 'rxjs/operators'

import { deviceBase } from './device.js'

/**
 * Valve device class for Homebridge FirstAlert platform.
 * Handles HomeKit Valve service, state caching, event-driven updates, and API sync.
 * @extends deviceBase
 * @copyright 2022-2026, donavanbecker (https://github.com/donavanbecker)
 */
export class Valve extends deviceBase {
  private Valve!: {
    Name: CharacteristicValue
    Service: Service
    Active: CharacteristicValue
    InUse: CharacteristicValue
    ValveType: CharacteristicValue
  }

  valveType!: number
  valveUpdateInProgress!: boolean
  doValveUpdate!: Subject<void>

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    device: ResideoDevice,
  ) {
    super(platform, accessory, device)
    this.getValveConfigSettings(accessory)

    this.doValveUpdate = new Subject()
    this.valveUpdateInProgress = false

    accessory.context.Valve = accessory.context.Valve ?? {}
    this.Valve = {
      Name: accessory.context.Valve.Name ?? accessory.displayName,
      Service: accessory.getService(this.hap.Service.Valve) ?? accessory.addService(this.hap.Service.Valve) as Service,
      Active: accessory.context.Active ?? this.hap.Characteristic.Active.INACTIVE,
      InUse: accessory.context.InUse ?? this.hap.Characteristic.InUse.NOT_IN_USE,
      ValveType: accessory.context.ValveType ?? this.hap.Characteristic.ValveType.GENERIC_VALVE,
    }
    accessory.context.Valve = this.Valve as object

    this.Valve.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Valve.Name)
      .setCharacteristic(this.hap.Characteristic.ValveType, this.valveType)
      .getCharacteristic(this.hap.Characteristic.Active)
      .onGet(() => this.Valve.Active)
      .onSet(this.setActive.bind(this))

    this.Valve.Service
      .getCharacteristic(this.hap.Characteristic.InUse)
      .onGet(() => this.Valve.InUse)

    this.logDebug('Initializing Valve, starting initial refresh.')
    this.refreshStatus()

    // Event-driven update: subscribe to doValveUpdate Subject for refresh
    this.doValveUpdate.subscribe(async () => {
      await this.refreshStatus()
    })
    // Polling interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.valveUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })

    this.doValveUpdate
      .pipe(
        tap(() => {
          this.valveUpdateInProgress = true
        }),
        debounceTime(this.devicePushRate * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges()
        } catch (e: any) {
          const action = 'pushChanges'
          await this.resideoAPIError(e, action)
          this.logError(`Valve ${accessory.displayName}: doValveUpdate pushChanges: ${JSON.stringify(e)}`)
        }
        interval(this.deviceRefreshRate * 500)
          .pipe(skipWhile(() => this.valveUpdateInProgress), take(1))
          .subscribe(async () => {
            await this.refreshStatus()
          })
        this.valveUpdateInProgress = false
      })
  }

  async parseStatus(device: ResideoDevice): Promise<void> {
    this.logDebug('Parsing Valve status from device:', JSON.stringify(device))
    // Use API state for Active and InUse
    // Example: device.state could be 'open' or 'closed', device.inUse could be true/false
    // Fallback to previous values if not present
    const d: any = device
    let newActive = this.hap.Characteristic.Active.INACTIVE
    let newInUse = this.hap.Characteristic.InUse.NOT_IN_USE
    if (typeof d.state === 'string') {
      newActive = d.state.toLowerCase() === 'open' ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE
    }
    if (typeof d.inUse === 'boolean') {
      newInUse = d.inUse ? this.hap.Characteristic.InUse.IN_USE : this.hap.Characteristic.InUse.NOT_IN_USE
    }
    // Only update if state has changed
    let stateChanged = false
    if (this.Valve.Active !== newActive) {
      this.Valve.Active = newActive
      this.accessory.context.Active = newActive
      stateChanged = true
      this.logDebug(`Valve ${this.accessory.displayName} Active changed: ${newActive}`)
    }
    if (this.Valve.InUse !== newInUse) {
      this.Valve.InUse = newInUse
      this.accessory.context.InUse = newInUse
      stateChanged = true
      this.logDebug(`Valve ${this.accessory.displayName} InUse changed: ${newInUse}`)
    }
    if (stateChanged) {
      this.logSuccess(`Valve ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(device)}`)
    }
    this.logDebug('Valve status parsed:', {
      Active: this.Valve.Active,
      InUse: this.Valve.InUse,
    })
  }

  async refreshStatus(): Promise<void> {
    this.logDebug('Refreshing Valve status from API...')
    try {
      // Use the new ResideoClient to fetch device state
      const deviceId = String(this.device.deviceId)
      const deviceState = await this.platform.client.getDeviceState(deviceId)
      this.logDebug(`Valve ${this.accessory.displayName} (refreshStatus) device: ${JSON.stringify(deviceState)}`)
      this.device = { ...this.device, ...deviceState }
      await this.parseStatus(this.device as ResideoDevice)
      await this.updateHomeKitCharacteristics()
      this.logDebug('Valve refresh and update complete.')
    } catch (e: any) {
      const action = 'refreshStatus'
      // retry logic removed; not present in new ResideoDevice
      await this.resideoAPIError(e, action)
      this.apiError(e)
    }
  }

  async pushChanges(): Promise<void> {
    try {
      const actionType = this.Valve.Active === this.hap.Characteristic.Active.ACTIVE ? 'open' : 'closed'
      this.logInfo(`Valve ${this.accessory.displayName}: pushChanges called, attempting to set state to '${actionType}'.`)
      this.logInfo(`Valve ${this.accessory.displayName}: deviceId=${this.device.deviceId}, globalDeviceType=${this.device.globalDeviceType}`)
      const payload: payload = {
        state: actionType,
      }
      this.logDebug(`Valve ${this.accessory.displayName}: Sending payload to API: ${JSON.stringify(payload)}`)
      const resp = await this.platform.client.setValveState(this.device.deviceId, payload, this.device.globalDeviceType)
      this.logDebug(`Valve ${this.accessory.displayName}: pushChanges API response: ${JSON.stringify(resp)}`)
      if (!resp || (typeof resp === 'object' && Object.keys(resp).length === 0)) {
        this.logWarn(`Valve ${this.accessory.displayName}: API response is empty or missing expected data after pushChanges.`)
      } else if (resp.error || resp.status === 'error') {
        this.logError(`Valve ${this.accessory.displayName}: API reported error in response: ${JSON.stringify(resp)}`)
      } else {
        this.logInfo(`Valve ${this.accessory.displayName}: pushChanges command sent successfully, response: ${JSON.stringify(resp)}`)
      }
      const action = 'pushChanges'
      await this.statusCode(200, action)
    } catch (e: any) {
      const action = 'pushChanges'
      await this.resideoAPIError(e, action)
      this.logError(`pushChanges: ${JSON.stringify(e)}`)
      this.logError(`Valve ${this.accessory.displayName} failed pushChanges, Error Message: ${JSON.stringify(e.message)}`)
    }
  }

  async updateHomeKitCharacteristics(): Promise<void> {
    this.logDebug('Updating Valve HomeKit characteristics...')
    // Only update HomeKit if state has changed
    if (this.Valve.Service.getCharacteristic(this.hap.Characteristic.Active).value !== this.Valve.Active) {
      this.Valve.Service.updateCharacteristic(this.hap.Characteristic.Active, this.Valve.Active)
      this.accessory.context.Active = this.Valve.Active
      this.logDebug(`Valve ${this.accessory.displayName} updateCharacteristic Active: ${this.Valve.Active}`)
    }
    if (this.Valve.Service.getCharacteristic(this.hap.Characteristic.InUse).value !== this.Valve.InUse) {
      this.Valve.Service.updateCharacteristic(this.hap.Characteristic.InUse, this.Valve.InUse)
      this.accessory.context.InUse = this.Valve.InUse
      this.logDebug(`Valve ${this.accessory.displayName} updateCharacteristic InUse: ${this.Valve.InUse}`)
    }
    this.logDebug('Valve HomeKit characteristics updated.')
  }

  setActive(value: CharacteristicValue) {
    this.logDebug(`Valve ${this.accessory.displayName} Set Active: ${value}`)
    this.Valve.Active = value
    this.doValveUpdate.next()
  }

  async getValveConfigSettings(accessory: PlatformAccessory) {
    // No valveType info in ResideoDevice, default to GENERIC_VALVE
    this.valveType = this.hap.Characteristic.ValveType.GENERIC_VALVE
    accessory.context.valveType = this.valveType
  }

  async apiError(e: any): Promise<void> {
    this.Valve.Service.updateCharacteristic(this.hap.Characteristic.Active, e)
  }
}
