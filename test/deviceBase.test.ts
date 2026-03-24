import type { ResideoDevice } from '../src/api/resideoClient.js'
import type { ResideoPlatform } from '../src/platform.js'
import type { PlatformAccessory } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import { deviceBase } from '../src/devices/device.js'

class TestDevice extends deviceBase {
  async parseStatus(): Promise<void> {}
  async refreshStatus(): Promise<void> {}
  async updateHomeKitCharacteristics(): Promise<void> {}
}

describe('deviceBase extensible command pattern', () => {
  const mockHap = {
    Service: { AccessoryInformation: 'AccessoryInformation' },
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Name: 'Name',
      ConfiguredName: 'ConfiguredName',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      FirmwareRevision: 'FirmwareRevision',
    },
  }
  const mockApi = { hap: mockHap }
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const mockConfig = {}

  function makePlatform() {
    return { api: mockApi, log: mockLog, config: mockConfig } as unknown as ResideoPlatform
  }
  function makeAccessory() {
    return {
      displayName: 'Test',
      context: { model: 'TestModel', deviceID: 'abc' },
      getService: vi.fn().mockReturnValue({
        setCharacteristic: vi.fn().mockReturnThis(),
        getCharacteristic: vi.fn().mockReturnValue({ updateValue: vi.fn() }),
      }),
    } as unknown as PlatformAccessory
  }

  it('registers and executes a command', async () => {
    const platform = makePlatform()
    const accessory = makeAccessory()
    const device = { name: 'TestDevice', deviceId: 'abc', globalDeviceType: 'TestType' } as ResideoDevice
    const testDevice = new TestDevice(platform, accessory, device)
    const handler = vi.fn(async () => 'result')
    testDevice.registerCommand('test', handler)
    const result = await testDevice.executeCommand('test')
    expect(handler).toHaveBeenCalled()
    expect(result).toBe('result')
  })

  it('throws if command not registered', async () => {
    const platform = makePlatform()
    const accessory = makeAccessory()
    const device = { name: 'TestDevice', deviceId: 'abc', globalDeviceType: 'TestType' } as ResideoDevice
    const testDevice = new TestDevice(platform, accessory, device)
    await expect(testDevice.executeCommand('notfound')).rejects.toThrow('Command \'notfound\' not registered for this device.')
  })
})
