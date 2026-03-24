// TypeScript interfaces for Homebridge accessory.context and device state

export interface BatteryContext {
  Name?: string
  BatteryLevel?: number
  ChargingState?: number
  StatusLowBattery?: number
}

export interface LeakSensorContext {
  Name?: string
  StatusActive?: boolean
  LeakDetected?: number
}

export interface HumiditySensorContext {
  Name?: string
  CurrentRelativeHumidity?: number
}

export interface TemperatureSensorContext {
  Name?: string
  CurrentTemperature?: number
}

export interface SmokeSensorContext {
  Name?: string
  SmokeDetected?: number
}

export interface CarbonMonoxideSensorContext {
  Name?: string
  CarbonMonoxideDetected?: number
}

export interface CarbonDioxideSensorContext {
  Name?: string
  CarbonDioxideDetected?: boolean
}

export interface ThermostatContext {
  Name?: string
  TargetTemperature?: number
  CurrentTemperature?: number
  TemperatureDisplayUnits?: number
  TargetHeatingCoolingState?: number
  CurrentHeatingCoolingState?: number
  CoolingThresholdTemperature?: number
  HeatingThresholdTemperature?: number
}

export interface ValveContext {
  Name?: string
  Active?: number
  InUse?: number
  ValveType?: number
}

export interface AccessoryContext {
  Battery?: BatteryContext
  LeakSensor?: LeakSensorContext
  HumiditySensor?: HumiditySensorContext
  TemperatureSensor?: TemperatureSensorContext
  SmokeSensor?: SmokeSensorContext
  CarbonMonoxideSensor?: CarbonMonoxideSensorContext
  CarbonDioxideSensor?: CarbonDioxideSensorContext
  Thermostat?: ThermostatContext
  Valve?: ValveContext
  // Add other device-specific contexts as needed
  [key: string]: any
}

// Example device state interface (expand as needed)
export interface DeviceState {
  batteryLevel?: number
  smokePresent?: boolean
  coPresent?: boolean
  co2Present?: boolean
  leakDetected?: boolean
  currentTemperature?: number
  currentRelativeHumidity?: number
  // Add other state properties as needed
  [key: string]: any
}
