// Centralized enums for device types and states
// Copyright(C) 2022-2026, donavanbecker (https://github.com/donavanbecker). All rights reserved.

export enum DeviceType {
  LeakSensor = 'LeakSensor',
  SmokeSensor = 'SmokeSensor',
  Thermostat = 'Thermostat',
  Valve = 'Valve',
}

export enum DeviceState {
  Online = 'Online',
  Offline = 'Offline',
  Unknown = 'Unknown',
}

export enum LeakSensorState {
  LeakDetected = 'LeakDetected',
  NoLeak = 'NoLeak',
}

export enum SmokeSensorState {
  SmokeDetected = 'SmokeDetected',
  NoSmoke = 'NoSmoke',
  CODetected = 'CODetected',
  NoCO = 'NoCO',
  CO2Detected = 'CO2Detected',
  NoCO2 = 'NoCO2',
}

export enum ThermostatMode {
  Off = 'Off',
  Heat = 'Heat',
  Cool = 'Cool',
  Auto = 'Auto',
}

export enum ValveState {
  Open = 'Open',
  Closed = 'Closed',
}
