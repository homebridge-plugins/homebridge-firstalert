// Usage example for enums
import { DeviceState, DeviceType, LeakSensorState, SmokeSensorState, ThermostatMode, ValveState } from '../src/enums.js'

console.warn(DeviceType.LeakSensor) // 'LeakSensor'
console.warn(DeviceState.Online) // 'Online'
console.warn(LeakSensorState.LeakDetected) // 'LeakDetected'
console.warn(SmokeSensorState.CO2Detected) // 'CO2Detected'
console.warn(ThermostatMode.Heat) // 'Heat'
console.warn(ValveState.Open) // 'Open'
