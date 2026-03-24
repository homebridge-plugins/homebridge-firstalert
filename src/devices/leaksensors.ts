import type { ResideoDevice } from '../api/resideoClient.js'
import type { ResideoPlatform } from '../platform.js'
/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * leaksensors.ts: homebridge-firstalert.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import { interval, Subject } from 'rxjs'
import { skipWhile } from 'rxjs/operators'

import { deviceBase } from './device.js'

/**
 * LeakSensor device class for Homebridge FirstAlert platform.
 * Handles HomeKit Battery, Leak, Temperature, and Humidity services.
 * Implements state caching, event-driven updates, and API sync.
 * @extends deviceBase
 * @copyright 2022-2026, donavanbecker (https://github.com/donavanbecker)
 */
export class LeakSensor extends deviceBase {
  // State cache for change detection
  private lastState: {
    BatteryLevel?: number
    StatusLowBattery?: number
    StatusActive?: boolean
    LeakDetected?: number
    CurrentTemperature?: number
    CurrentRelativeHumidity?: number
  } = {}

  // Services
  private Battery: {
    Name: CharacteristicValue
    Service: Service
    BatteryLevel: CharacteristicValue
    ChargingState: CharacteristicValue
    StatusLowBattery: CharacteristicValue
  }

  private LeakSensor?: {
    Name: CharacteristicValue
    Service: Service
    StatusActive: CharacteristicValue
    LeakDetected: CharacteristicValue
  }

  private HumiditySensor?: {
    Name: CharacteristicValue
    Service: Service
    CurrentRelativeHumidity: CharacteristicValue
  }

  private TemperatureSensor?: {
    Name: CharacteristicValue
    Service: Service
    CurrentTemperature: CharacteristicValue
  }

  // Sensor Update
  SensorUpdateInProgress!: boolean
  doSensorUpdate!: Subject<void>

  constructor(
    readonly platform: ResideoPlatform,
    accessory: PlatformAccessory,
    device: ResideoDevice,
  ) {
    super(platform, accessory, device)

    this.doSensorUpdate = new Subject()
    this.SensorUpdateInProgress = false

    // Initialize Battery Service
    accessory.context.Battery = accessory.context.Battery ?? {}
    this.Battery = {
      Name: accessory.context.Battery.Name ?? `${accessory.displayName} Battery`,
      Service: accessory.getService(this.hap.Service.Battery) ?? accessory.addService(this.hap.Service.Battery) as Service,
      BatteryLevel: accessory.context.BatteryLevel ?? 100,
      ChargingState: accessory.context.ChargingState ?? this.hap.Characteristic.ChargingState.NOT_CHARGEABLE,
      StatusLowBattery: accessory.context.StatusLowBattery ?? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    }
    accessory.context.Battery = this.Battery as object
    this.Battery.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.Battery.Name)
      .setCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGEABLE)
      .getCharacteristic(this.hap.Characteristic.BatteryLevel)
      .onGet(() => this.Battery.BatteryLevel)

    // Leak Sensor Service
    accessory.context.LeakSensor = accessory.context.LeakSensor ?? {}
    this.LeakSensor = {
      Name: accessory.context.LeakSensor.Name ?? `${accessory.displayName} Leak Sensor`,
      Service: accessory.getService(this.hap.Service.LeakSensor) ?? accessory.addService(this.hap.Service.LeakSensor) as Service,
      StatusActive: accessory.context.StatusActive ?? false,
      LeakDetected: accessory.context.LeakDetected ?? this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    }
    accessory.context.LeakSensor = this.LeakSensor as object
    this.LeakSensor.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.LeakSensor.Name)
      .getCharacteristic(this.hap.Characteristic.StatusActive)
      .onGet(() => this.LeakSensor!.StatusActive)
    this.LeakSensor.Service
      .getCharacteristic(this.hap.Characteristic.LeakDetected)
      .onGet(() => this.LeakSensor!.LeakDetected)

    // Temperature Sensor Service
    accessory.context.TemperatureSensor = accessory.context.TemperatureSensor ?? {}
    this.TemperatureSensor = {
      Name: accessory.context.TemperatureSensor.Name ?? `${accessory.displayName} Temperature Sensor`,
      Service: accessory.getService(this.hap.Service.TemperatureSensor) ?? accessory.addService(this.hap.Service.TemperatureSensor) as Service,
      CurrentTemperature: accessory.context.CurrentTemperature ?? 20,
    }
    accessory.context.TemperatureSensor = this.TemperatureSensor as object
    this.TemperatureSensor.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.TemperatureSensor.Name)
      .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -273.15,
        maxValue: 100,
        minStep: 0.1,
      })
      .onGet(() => this.TemperatureSensor!.CurrentTemperature)

    // Humidity Sensor Service
    accessory.context.HumiditySensor = accessory.context.HumiditySensor ?? {}
    this.HumiditySensor = {
      Name: accessory.context.HumiditySensor.Name ?? `${accessory.displayName} Humidity Sensor`,
      Service: accessory.getService(this.hap.Service.HumiditySensor) ?? accessory.addService(this.hap.Service.HumiditySensor) as Service,
      CurrentRelativeHumidity: accessory.context.CurrentRelativeHumidity ?? 50,
    }
    accessory.context.HumiditySensor = this.HumiditySensor as object
    this.HumiditySensor.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.HumiditySensor.Name)
    this.HumiditySensor.Service
      .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
      .setProps({ minStep: 0.1 })
      .onGet(() => this.HumiditySensor!.CurrentRelativeHumidity)

    // Initial refresh
    this.logDebug('Initializing LeakSensor, starting initial refresh and update.')
    this.refreshStatus()
    this.updateHomeKitCharacteristics()
    // Event-driven update: subscribe to doSensorUpdate Subject
    this.doSensorUpdate.subscribe(async () => {
      await this.refreshStatus()
      await this.updateHomeKitCharacteristics()
    })
    // Polling interval
    interval(this.deviceRefreshRate * 1000)
      .pipe(skipWhile(() => this.SensorUpdateInProgress))
      .subscribe(async () => {
        await this.refreshStatus()
      })
  }

  /**
   * Parse the device status from the FirstAlert api
   */
  async parseStatus(): Promise<void> {
    this.logDebug('Parsing LeakSensor status from device:', JSON.stringify(this.device))
    // Example: parse state from API response (simulate for now)
    // In a real implementation, fetch and parse state from the API
    // For now, just set some dummy values
    this.Battery.BatteryLevel = 100
    this.Battery.StatusLowBattery = this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    if (this.LeakSensor) {
      this.LeakSensor.StatusActive = true
      this.LeakSensor.LeakDetected = this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED
    }
    if (this.TemperatureSensor) {
      this.TemperatureSensor.CurrentTemperature = 20
    }
    if (this.HumiditySensor) {
      this.HumiditySensor.CurrentRelativeHumidity = 50
    }
    this.logDebug('LeakSensor status parsed:', {
      BatteryLevel: this.Battery.BatteryLevel,
      StatusLowBattery: this.Battery.StatusLowBattery,
      StatusActive: this.LeakSensor?.StatusActive,
      LeakDetected: this.LeakSensor?.LeakDetected,
      CurrentTemperature: this.TemperatureSensor?.CurrentTemperature,
      CurrentRelativeHumidity: this.HumiditySensor?.CurrentRelativeHumidity,
    })
  }

  /**
   * Asks the FirstAlert Home API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    this.logDebug('Refreshing LeakSensor status from API...')
    try {
      const deviceId = String(this.device.deviceId)
      const deviceState = await this.platform.client.getDeviceState(deviceId)
      this.logDebug('Received LeakSensor device state from API:', JSON.stringify(deviceState))
      // In a real implementation, parse deviceState and update class state
      await this.parseStatus()
      await this.updateHomeKitCharacteristics()
      this.logDebug('LeakSensor refresh and update complete.')
    } catch (e: any) {
      const action = 'refreshStatus'
      this.resideoAPIError(e, action)
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    this.logDebug('Updating LeakSensor HomeKit characteristics (with change detection)...')
    // Only update if value changed
    if (this.Battery.BatteryLevel !== this.lastState.BatteryLevel) {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel)
      this.lastState.BatteryLevel = this.Battery.BatteryLevel as number
    }
    if (this.Battery.StatusLowBattery !== this.lastState.StatusLowBattery) {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery)
      this.lastState.StatusLowBattery = this.Battery.StatusLowBattery as number
    }
    if (this.LeakSensor) {
      if (this.LeakSensor.LeakDetected !== this.lastState.LeakDetected) {
        this.LeakSensor.Service.updateCharacteristic(this.hap.Characteristic.LeakDetected, this.LeakSensor.LeakDetected)
        this.lastState.LeakDetected = this.LeakSensor.LeakDetected as number
      }
      if (this.LeakSensor.StatusActive !== this.lastState.StatusActive) {
        this.LeakSensor.Service.updateCharacteristic(this.hap.Characteristic.StatusActive, this.LeakSensor.StatusActive)
        this.lastState.StatusActive = this.LeakSensor.StatusActive as boolean
      }
    }
    if (this.TemperatureSensor) {
      if (this.TemperatureSensor.CurrentTemperature !== this.lastState.CurrentTemperature) {
        this.TemperatureSensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, this.TemperatureSensor.CurrentTemperature)
        this.lastState.CurrentTemperature = this.TemperatureSensor.CurrentTemperature as number
      }
    }
    if (this.HumiditySensor) {
      if (this.HumiditySensor.CurrentRelativeHumidity !== this.lastState.CurrentRelativeHumidity) {
        this.HumiditySensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, this.HumiditySensor.CurrentRelativeHumidity)
        this.lastState.CurrentRelativeHumidity = this.HumiditySensor.CurrentRelativeHumidity as number
      }
    }
    this.logDebug('LeakSensor HomeKit characteristics updated (change detection complete).')
  }

  async apiError(e: any): Promise<void> {
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, e)
    this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, e)
    if (this.LeakSensor) {
      this.LeakSensor.Service.updateCharacteristic(this.hap.Characteristic.LeakDetected, e)
      this.LeakSensor.Service.updateCharacteristic(this.hap.Characteristic.StatusActive, e)
    }
    if (this.TemperatureSensor) {
      this.TemperatureSensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, e)
    }
    if (this.HumiditySensor) {
      this.HumiditySensor.Service.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, e)
    }
  }
}
