import type { API } from 'homebridge'

import { describe, expect, it, vi } from 'vitest'

import registerPlatform from '../src/index.js'
import { ResideoPlatform } from '../src/platform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from '../src/settings.js'

describe('index.ts', () => {
  it('should register the platform with homebridge', () => {
    const apiMock: API = {
      registerPlatform: vi.fn(),
    } as unknown as API

    registerPlatform(apiMock)

    expect(apiMock.registerPlatform).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, ResideoPlatform)
  })
})
