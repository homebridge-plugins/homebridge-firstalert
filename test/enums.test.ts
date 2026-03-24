import { describe, expect, it } from 'vitest'

import { DeviceState, DeviceType, LeakSensorState, SmokeSensorState, ThermostatMode, ValveState } from '../src/enums.js'

describe('enums', () => {
  it('deviceType values', () => {
    expect(DeviceType.LeakSensor).toBe('LeakSensor')
    expect(DeviceType.SmokeSensor).toBe('SmokeSensor')
    expect(DeviceType.Thermostat).toBe('Thermostat')
    expect(DeviceType.Valve).toBe('Valve')
  })
  it('deviceState values', () => {
    expect(DeviceState.Online).toBe('Online')
    expect(DeviceState.Offline).toBe('Offline')
    expect(DeviceState.Unknown).toBe('Unknown')
  })
  it('leakSensorState values', () => {
    expect(LeakSensorState.LeakDetected).toBe('LeakDetected')
    expect(LeakSensorState.NoLeak).toBe('NoLeak')
  })
  it('smokeSensorState values', () => {
    expect(SmokeSensorState.SmokeDetected).toBe('SmokeDetected')
    expect(SmokeSensorState.NoSmoke).toBe('NoSmoke')
    expect(SmokeSensorState.CODetected).toBe('CODetected')
    expect(SmokeSensorState.NoCO).toBe('NoCO')
    expect(SmokeSensorState.CO2Detected).toBe('CO2Detected')
    expect(SmokeSensorState.NoCO2).toBe('NoCO2')
  })
  it('thermostatMode values', () => {
    expect(ThermostatMode.Off).toBe('Off')
    expect(ThermostatMode.Heat).toBe('Heat')
    expect(ThermostatMode.Cool).toBe('Cool')
    expect(ThermostatMode.Auto).toBe('Auto')
  })
  it('valveState values', () => {
    expect(ValveState.Open).toBe('Open')
    expect(ValveState.Closed).toBe('Closed')
  })
})
