import type { ResideoDevice } from '../api/resideoClient.js'
import type { ResideoPlatform } from '../platform.js'
/* Copyright(C) 2022-2024, donavanbecker (https://github.com/donavanbecker). All rights reserved.
 *
 * smoke.ts: homebridge-firstalert.
 */
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import { interval, Subject } from 'rxjs'
import { skipWhile } from 'rxjs/operators'

import { deviceBase } from './device.js'

/**
 * SmokeSensor device class for Homebridge FirstAlert platform.
 * Handles HomeKit Smoke, CO, CO2, and Battery services.
 * Implements state caching, event-driven updates, and API sync.
 * @extends deviceBase
 * @copyright 2022-2026, donavanbecker (https://github.com/donavanbecker)
 */
export class SmokeSensor extends deviceBase {
  // State cache for change detection
  private lastState: {
    BatteryLevel?: number
    StatusLowBattery?: number
    SmokeDetected?: number
    CarbonMonoxideDetected?: number
    CarbonDioxideDetected?: boolean
  } = {}

  // Services
  private SmokeSensor: { Name: CharacteristicValue, Service: Service, SmokeDetected: CharacteristicValue }
  private CarbonMonoxideSensor?: { Name: CharacteristicValue, Service: Service, CarbonMonoxideDetected: CharacteristicValue }
  private CarbonDioxideSensor?: { Name: CharacteristicValue, Service: Service, CarbonDioxideDetected: CharacteristicValue }
  private Battery: { Name: CharacteristicValue, Service: Service, BatteryLevel: CharacteristicValue, ChargingState: CharacteristicValue, StatusLowBattery: CharacteristicValue }

  // Update
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

    // Battery Service
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

    // Smoke Sensor Service
    accessory.context.SmokeSensor = accessory.context.SmokeSensor ?? {}
    this.SmokeSensor = {
      Name: accessory.context.SmokeSensor.Name ?? `${accessory.displayName} Smoke Sensor`,
      Service: accessory.getService(this.hap.Service.SmokeSensor) ?? accessory.addService(this.hap.Service.SmokeSensor) as Service,
      SmokeDetected: accessory.context.SmokeDetected ?? this.hap.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
    }
    accessory.context.SmokeSensor = this.SmokeSensor as object
    this.SmokeSensor.Service
      .setCharacteristic(this.hap.Characteristic.Name, this.SmokeSensor.Name)
      .getCharacteristic(this.hap.Characteristic.SmokeDetected)
      .onGet(() => this.SmokeSensor.SmokeDetected)

    // Carbon Monoxide Sensor Service (optional)
    if (device.globalDeviceType?.toLowerCase().includes('co')) {
      accessory.context.CarbonMonoxideSensor = accessory.context.CarbonMonoxideSensor ?? {}
      this.CarbonMonoxideSensor = {
        Name: accessory.context.CarbonMonoxideSensor.Name ?? `${accessory.displayName} CO Sensor`,
        Service: accessory.getService(this.hap.Service.CarbonMonoxideSensor) ?? accessory.addService(this.hap.Service.CarbonMonoxideSensor) as Service,
        CarbonMonoxideDetected: accessory.context.CarbonMonoxideDetected ?? this.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
      }
      accessory.context.CarbonMonoxideSensor = this.CarbonMonoxideSensor as object
      this.CarbonMonoxideSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.CarbonMonoxideSensor.Name)
        .getCharacteristic(this.hap.Characteristic.CarbonMonoxideDetected)
        .onGet(() => this.CarbonMonoxideSensor!.CarbonMonoxideDetected)
    }

    // Carbon Dioxide Sensor Service (optional)
    if (device.globalDeviceType?.toLowerCase().includes('co2')) {
      accessory.context.CarbonDioxideSensor = accessory.context.CarbonDioxideSensor ?? {}
      this.CarbonDioxideSensor = {
        Name: accessory.context.CarbonDioxideSensor.Name ?? `${accessory.displayName} CO2 Sensor`,
        Service: accessory.getService(this.hap.Service.CarbonDioxideSensor) ?? accessory.addService(this.hap.Service.CarbonDioxideSensor) as Service,
        CarbonDioxideDetected: accessory.context.CarbonDioxideDetected ?? false,
      }
      accessory.context.CarbonDioxideSensor = this.CarbonDioxideSensor as object
      this.CarbonDioxideSensor.Service
        .setCharacteristic(this.hap.Characteristic.Name, this.CarbonDioxideSensor.Name)
        .getCharacteristic(this.hap.Characteristic.CarbonDioxideDetected)
        .onGet(() => this.CarbonDioxideSensor!.CarbonDioxideDetected)
    }

    // Initial refresh
    this.logDebug('Initializing SmokeSensor, starting initial refresh and update.')
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
    this.logDebug('Parsing SmokeSensor status from device:', JSON.stringify(this.device))
    // Use a single variable for dynamic property access
    const d: any = this.device
    // Battery
    this.Battery.BatteryLevel = Number(d.batteryLevel ?? 100)
    this.Battery.Service.getCharacteristic(this.hap.Characteristic.BatteryLevel).updateValue(this.Battery.BatteryLevel)
    // Consider battery low if < 15%
    this.Battery.StatusLowBattery = this.Battery.BatteryLevel < 15 ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

    // Smoke
    this.SmokeSensor.SmokeDetected = (d.smokePresent ?? d.smoke_detected ?? d.smoke ?? false)
      ? this.hap.Characteristic.SmokeDetected.SMOKE_DETECTED
      : this.hap.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED

    // CO
    if (this.CarbonMonoxideSensor) {
      this.CarbonMonoxideSensor.CarbonMonoxideDetected = (d.coPresent ?? d.co_detected ?? d.co ?? false)
        ? this.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL
        : this.hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL
    }
    // CO2
    if (this.CarbonDioxideSensor) {
      this.CarbonDioxideSensor.CarbonDioxideDetected = !!((d.co2Present ?? d.co2_detected ?? d.co2 ?? false))
    }
    this.logDebug('SmokeSensor status parsed:', {
      BatteryLevel: this.Battery.BatteryLevel,
      StatusLowBattery: this.Battery.StatusLowBattery,
      SmokeDetected: this.SmokeSensor.SmokeDetected,
      CarbonMonoxideDetected: this.CarbonMonoxideSensor?.CarbonMonoxideDetected,
      CarbonDioxideDetected: this.CarbonDioxideSensor?.CarbonDioxideDetected,
    })
  }

  /**
   * Ask the FirstAlert API for the latest device information
   */
  async refreshStatus(): Promise<void> {
    this.logDebug('Refreshing SmokeSensor status from API...')
    try {
      const deviceId = String(this.device.deviceId)
      const deviceState = await this.platform.client.getDeviceState(deviceId)
      this.logDebug('Received SmokeSensor device state from API:', JSON.stringify(deviceState))
      this.device = { ...this.device, ...deviceState }
      await this.parseStatus()
      await this.updateHomeKitCharacteristics()
      this.logDebug('SmokeSensor refresh and update complete.')
    } catch (e: any) {
      const action = 'refreshStatus'
      this.resideoAPIError(e, action)
    }
  }

  /**
   * Update HomeKit characteristics
   */
  async updateHomeKitCharacteristics(): Promise<void> {
    this.logDebug('Updating SmokeSensor HomeKit characteristics (with change detection)...')
    if (this.Battery.BatteryLevel !== this.lastState.BatteryLevel) {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.BatteryLevel, this.Battery.BatteryLevel)
      this.lastState.BatteryLevel = this.Battery.BatteryLevel as number
    }
    if (this.Battery.StatusLowBattery !== this.lastState.StatusLowBattery) {
      this.Battery.Service.updateCharacteristic(this.hap.Characteristic.StatusLowBattery, this.Battery.StatusLowBattery)
      this.lastState.StatusLowBattery = this.Battery.StatusLowBattery as number
    }
    if (this.SmokeSensor.SmokeDetected !== this.lastState.SmokeDetected) {
      this.SmokeSensor.Service.updateCharacteristic(this.hap.Characteristic.SmokeDetected, this.SmokeSensor.SmokeDetected)
      this.lastState.SmokeDetected = this.SmokeSensor.SmokeDetected as number
    }
    if (this.CarbonMonoxideSensor) {
      if (this.CarbonMonoxideSensor.CarbonMonoxideDetected !== this.lastState.CarbonMonoxideDetected) {
        this.CarbonMonoxideSensor.Service.updateCharacteristic(this.hap.Characteristic.CarbonMonoxideDetected, this.CarbonMonoxideSensor.CarbonMonoxideDetected)
        this.lastState.CarbonMonoxideDetected = this.CarbonMonoxideSensor.CarbonMonoxideDetected as number
      }
    }
    if (this.CarbonDioxideSensor) {
      if (this.CarbonDioxideSensor.CarbonDioxideDetected !== this.lastState.CarbonDioxideDetected) {
        this.CarbonDioxideSensor.Service.updateCharacteristic(this.hap.Characteristic.CarbonDioxideDetected, this.CarbonDioxideSensor.CarbonDioxideDetected)
        this.lastState.CarbonDioxideDetected = this.CarbonDioxideSensor.CarbonDioxideDetected as boolean
      }
    }
    this.logDebug('SmokeSensor HomeKit characteristics updated (change detection complete).')
  }

  /**
   * Called by platform polling
   */
  async updateState(): Promise<void> {
    await this.refreshStatus()
  }
}
