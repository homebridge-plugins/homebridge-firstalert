import type { ResideoDevice } from '../src/api/resideoClient.js'
import type { ResideoPlatform } from '../src/platform.js'
import type { PlatformAccessory } from 'homebridge'

// Usage example for deviceBase extensible command pattern
import { deviceBase } from '../src/devices/device.js'

class ExampleDevice extends deviceBase {
  async parseStatus(): Promise<void> {}
  async refreshStatus(): Promise<void> {}
  async updateHomeKitCharacteristics(): Promise<void> {}
}

// Example usage
const platform = {} as ResideoPlatform
const accessory = { displayName: 'Test', getService: () => ({ setCharacteristic: () => ({ setCharacteristic: () => ({ getCharacteristic: () => ({ onGet: () => {}, onSet: () => {} }) }) }) }) } as unknown as PlatformAccessory
const device = { name: 'Example', deviceId: '123', globalDeviceType: 'TestType' } as ResideoDevice

const example = new ExampleDevice(platform, accessory, device)
example.registerCommand('custom', async () => 'custom result')
example.executeCommand('custom').then(console.warn)
