import type { ResideoDevice } from '../api/resideoClient.js'
import type { ResideoPlatform } from '../platform.js'
/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * thermostats.ts: homebridge-firstalert.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import { interval, Subject } from 'rxjs'
import { skipWhile } from 'rxjs/operators'

import { ResideoModes } from '../utils.js'
import { deviceBase } from './device.js'

/**
 * Thermostats device class for Homebridge FirstAlert platform.
 * Handles HomeKit Thermostat service, state caching, event-driven updates, and API sync.
 * @extends deviceBase
 * @copyright 2022-2026, donavanbecker (https://github.com/donavanbecker)
 */
export class Thermostats extends deviceBase {
  // State cache for change detection
  private lastState: {
    CurrentTemperature?: number
    TargetTemperature?: number
    TemperatureDisplayUnits?: number
    TargetHeatingCoolingState?: number
    CurrentHeatingCoolingState?: number
    HeatingThresholdTemperature?: number
    CoolingThresholdTemperature?: number
  } = {}

  // Services
  private Thermostat: {
    Name: CharacteristicValue
    Service: Service
    TargetTemperature: CharacteristicValue
    CurrentTemperature: CharacteristicValue
    TemperatureDisplayUnits: CharacteristicValue
    TargetHeatingCoolingState: CharacteristicValue
    CurrentHeatingCoolingState: CharacteristicValue
    CoolingThresholdTemperature: CharacteristicValue
    HeatingThresholdTemperature: CharacteristicValue
  }

  // State
  private state: any = {}
  private updateInProgress = false
  private doUpdate = new Subject<void>()

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    device: ResideoDevice,
  ) {
    super(platform, accessory, device)

    // Initialize Thermostat Service
    accessory.context.Thermostat = accessory.context.Thermostat ?? {}
    this.Thermostat = {
      Name: accessory.context.Thermostat.Name ?? accessory.displayName,
      Service: accessory.getService(this.hap.Service.Thermostat) ?? this.accessory.addService(this.hap.Service.Thermostat) as Service,
      TargetTemperature: accessory.context.TargetTemperature ?? 20,
      CurrentTemperature: accessory.context.CurrentTemperature ?? 20,
      TemperatureDisplayUnits: accessory.context.TemperatureDisplayUnits ?? this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS,
      TargetHeatingCoolingState: accessory.context.TargetHeatingCoolingState ?? this.hap.Characteristic.TargetHeatingCoolingState.AUTO,
      CurrentHeatingCoolingState: accessory.context.CurrentHeatingCoolingState ?? this.hap.Characteristic.CurrentHeatingCoolingState.OFF,
      CoolingThresholdTemperature: accessory.context.CoolingThresholdTemperature ?? 20,
      HeatingThresholdTemperature: accessory.context.HeatingThresholdTemperature ?? 22,
    }
    accessory.context.Thermostat = this.Thermostat as object

    // Service Name
    this.Thermostat.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Thermostat.Name)
      .setCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.Thermostat.CurrentHeatingCoolingState)
      .getCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.Thermostat.TemperatureDisplayUnits)
      .onSet(this.setTemperatureDisplayUnits.bind(this))

    // Set Min and Max (static for now, as ResideoDevice does not provide setpoints)
    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.TargetTemperature)
      .setProps({
        minValue: 10,
        maxValue: 32,
        minStep: 0.5,
      })
      .onGet(() => this.Thermostat.TargetTemperature)

    // Only allow AUTO, HEAT, COOL, OFF
    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.hap.Characteristic.TargetHeatingCoolingState.OFF,
          this.hap.Characteristic.TargetHeatingCoolingState.HEAT,
          this.hap.Characteristic.TargetHeatingCoolingState.COOL,
          this.hap.Characteristic.TargetHeatingCoolingState.AUTO,
        ],
      })
      .onGet(() => this.Thermostat.TargetHeatingCoolingState)
      .onSet(this.setTargetHeatingCoolingState.bind(this))

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature)
      .onGet(() => this.Thermostat.HeatingThresholdTemperature)
      .onSet(this.setHeatingThresholdTemperature.bind(this))

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature)
      .onGet(() => this.Thermostat.CoolingThresholdTemperature)
      .onSet(this.setCoolingThresholdTemperature.bind(this))

    this.Thermostat.Service
      .getCharacteristic(this.hap.Characteristic.TargetTemperature)
      .onGet(() => this.Thermostat.TargetTemperature)
      .onSet(this.setTargetTemperature.bind(this))

    // Fan and humidity services omitted for new ResideoDevice structure (add if API provides state)

    // Humidity service omitted for new ResideoDevice structure (add if API provides state)

    // StatefulProgrammableSwitch omitted for new ResideoDevice structure

    // Initial refresh
    this.logDebug('Initializing Thermostats, starting initial refresh.')
    this.refreshStatus()
    // Event-driven update: subscribe to doUpdate Subject
    this.doUpdate.subscribe(async () => {
      await this.refreshStatus()
    })
    // Polling interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.updateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })
  }

  /**
   * Parse the device status from the FirstAlert api
   */
  async parseStatus(): Promise<void> {
    this.logDebug('Parsing Thermostat status from API state:', JSON.stringify(this.state))
    // Map API state to HomeKit characteristics
    const s = this.state || {}
    // These property names may need to be adjusted to match the actual API response
    this.Thermostat.CurrentTemperature = s.currentTemperature ?? this.Thermostat.CurrentTemperature
    this.Thermostat.TargetTemperature = s.targetTemperature ?? this.Thermostat.TargetTemperature
    this.Thermostat.TemperatureDisplayUnits = s.temperatureDisplayUnits ?? this.Thermostat.TemperatureDisplayUnits
    this.Thermostat.TargetHeatingCoolingState = s.targetHeatingCoolingState ?? this.Thermostat.TargetHeatingCoolingState
    this.Thermostat.CurrentHeatingCoolingState = s.currentHeatingCoolingState ?? this.Thermostat.CurrentHeatingCoolingState
    this.Thermostat.HeatingThresholdTemperature = s.heatingThresholdTemperature ?? this.Thermostat.HeatingThresholdTemperature
    this.Thermostat.CoolingThresholdTemperature = s.coolingThresholdTemperature ?? this.Thermostat.CoolingThresholdTemperature
    this.logDebug('Thermostat status parsed:', {
      CurrentTemperature: this.Thermostat.CurrentTemperature,
      TargetTemperature: this.Thermostat.TargetTemperature,
      TemperatureDisplayUnits: this.Thermostat.TemperatureDisplayUnits,
      TargetHeatingCoolingState: this.Thermostat.TargetHeatingCoolingState,
      CurrentHeatingCoolingState: this.Thermostat.CurrentHeatingCoolingState,
      HeatingThresholdTemperature: this.Thermostat.HeatingThresholdTemperature,
      CoolingThresholdTemperature: this.Thermostat.CoolingThresholdTemperature,
    })
  }

  /**
   * Asks the FirstAlert Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    this.logDebug('Refreshing Thermostat status from API...')
    try {
      const deviceId = String(this.device.deviceId)
      const deviceState = await this.platform.client.getDeviceState(deviceId)
      this.logDebug('Received Thermostat device state from API:', JSON.stringify(deviceState))
      this.state = deviceState.deviceState || {}
      await this.parseStatus()
      await this.updateHomeKitCharacteristics()
      this.logDebug('Thermostat refresh and update complete.')
    } catch (e: any) {
      const action = 'refreshStatus'
      this.resideoAPIError(e, action)
    }
  }

  // ...existing code...

  /**
   * Pushes the requested changes to the FirstAlert API
   */
  async pushChanges(): Promise<void> {
    try {
      this.logInfo(`Thermostat ${this.accessory.displayName}: pushChanges called, attempting to set state.`)
      this.logInfo(`Thermostat ${this.accessory.displayName}: deviceId=${this.device.deviceId}, globalDeviceType=${this.device.globalDeviceType}`)
      const payload = {
        targetTemperature: this.Thermostat.TargetTemperature,
        heatingThresholdTemperature: this.Thermostat.HeatingThresholdTemperature,
        coolingThresholdTemperature: this.Thermostat.CoolingThresholdTemperature,
        targetHeatingCoolingState: this.Thermostat.TargetHeatingCoolingState,
      }
      this.logDebug(`Thermostat ${this.accessory.displayName}: Sending payload to API: ${JSON.stringify(payload)}`)
      const resp = await this.platform.client.setThermostatState(this.device.deviceId, payload, this.device.globalDeviceType)
      this.logDebug(`Thermostat ${this.accessory.displayName}: pushChanges API response: ${JSON.stringify(resp)}`)
      if (!resp || (typeof resp === 'object' && Object.keys(resp).length === 0)) {
        this.logWarn(`Thermostat ${this.accessory.displayName}: API response is empty or missing expected data after pushChanges.`)
      } else if (resp.error || resp.status === 'error') {
        this.logError(`Thermostat ${this.accessory.displayName}: API reported error in response: ${JSON.stringify(resp)}`)
      } else {
        this.logInfo(`Thermostat ${this.accessory.displayName}: pushChanges command sent successfully, response: ${JSON.stringify(resp)}`)
      }
      const action = 'pushChanges'
      await this.statusCode(200, action)
    } catch (e: any) {
      const action = 'pushChanges'
      await this.resideoAPIError(e, action)
      this.logError(`pushChanges: ${JSON.stringify(e)}`)
      this.logError(`Thermostat ${this.accessory.displayName} failed pushChanges, Error Message: ${JSON.stringify(e.message)}`)
    }
  }

  async ResideoMode() {
    switch (this.Thermostat.TargetHeatingCoolingState) {
      case this.hap.Characteristic.TargetHeatingCoolingState.HEAT:
        return ResideoModes.Heat
      case this.hap.Characteristic.TargetHeatingCoolingState.COOL:
        return ResideoModes.Cool
      case this.hap.Characteristic.TargetHeatingCoolingState.AUTO:
        return ResideoModes.Auto
      case this.hap.Characteristic.TargetHeatingCoolingState.OFF:
        return ResideoModes.Off
      default:
        return 'Unknown'
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    this.logDebug('Updating Thermostat HomeKit characteristics (with change detection)...')
    if (this.Thermostat.TemperatureDisplayUnits !== this.lastState.TemperatureDisplayUnits) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.Thermostat.TemperatureDisplayUnits)
      this.lastState.TemperatureDisplayUnits = this.Thermostat.TemperatureDisplayUnits as number
    }
    if (this.Thermostat.CurrentTemperature !== this.lastState.CurrentTemperature) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.Thermostat.CurrentTemperature)
      this.lastState.CurrentTemperature = this.Thermostat.CurrentTemperature as number
    }
    if (this.Thermostat.TargetTemperature !== this.lastState.TargetTemperature) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.Thermostat.TargetTemperature)
      this.lastState.TargetTemperature = this.Thermostat.TargetTemperature as number
    }
    if (this.Thermostat.HeatingThresholdTemperature !== this.lastState.HeatingThresholdTemperature) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, this.Thermostat.HeatingThresholdTemperature)
      this.lastState.HeatingThresholdTemperature = this.Thermostat.HeatingThresholdTemperature as number
    }
    if (this.Thermostat.CoolingThresholdTemperature !== this.lastState.CoolingThresholdTemperature) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, this.Thermostat.CoolingThresholdTemperature)
      this.lastState.CoolingThresholdTemperature = this.Thermostat.CoolingThresholdTemperature as number
    }
    if (this.Thermostat.TargetHeatingCoolingState !== this.lastState.TargetHeatingCoolingState) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, this.Thermostat.TargetHeatingCoolingState)
      this.lastState.TargetHeatingCoolingState = this.Thermostat.TargetHeatingCoolingState as number
    }
    if (this.Thermostat.CurrentHeatingCoolingState !== this.lastState.CurrentHeatingCoolingState) {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.Thermostat.CurrentHeatingCoolingState)
      this.lastState.CurrentHeatingCoolingState = this.Thermostat.CurrentHeatingCoolingState as number
    }
    this.logDebug('Thermostat HomeKit characteristics updated (change detection complete).')
  }

  async apiError(e: any): Promise<void> {
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, e)
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, e)
  }

  // ...existing code...

  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    this.Thermostat.TargetHeatingCoolingState = value
    this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, this.Thermostat.TargetTemperature)
    await this.pushChanges()
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.Thermostat.HeatingThresholdTemperature = value
    await this.pushChanges()
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    this.Thermostat.CoolingThresholdTemperature = value
    await this.pushChanges()
  }

  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.Thermostat.TargetTemperature = value
    await this.pushChanges()
  }

  async setTemperatureDisplayUnits(): Promise<void> {
    // Changing hardware display units from HomeKit is not supported
    this.logWarn('Changing the Hardware Display Units from HomeKit is not supported.')
    // Always revert to Celsius for now
    this.Thermostat.TemperatureDisplayUnits = this.hap.Characteristic.TemperatureDisplayUnits.CELSIUS
    setTimeout(() => {
      this.Thermostat.Service.updateCharacteristic(this.hap.Characteristic.TemperatureDisplayUnits, this.Thermostat.TemperatureDisplayUnits)
    }, 100)
  }

  // ...existing code...

  // ...existing code...

  // ...existing code...
}
