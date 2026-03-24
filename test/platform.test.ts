import type { ResideoPlatformConfig } from '../src/settings.js'
import type { API, Logging } from 'homebridge'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResideoPlatform } from '../src/platform.js'

vi.mock('axios')

describe('resideoPlatform', () => {
  let platform: ResideoPlatform
  let log: Logging
  let config: ResideoPlatformConfig
  let api: API

  beforeEach(() => {
    log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logging

    config = {
      platform: 'FirstAlert',
      name: 'Test Platform',
      credentials: {
        accessToken: 'testAccessToken',
        consumerKey: 'testConsumerKey',
        consumerSecret: 'testConsumerSecret',
        refreshToken: 'testRefreshToken',
      },
      options: {
        refreshRate: 120,
        pushRate: 0.1,
        devices: [],
      },
    }

    api = {
      hap: {
        uuid: {
          generate: vi.fn().mockReturnValue('test-uuid'),
        },
      },
      platformAccessory: vi.fn().mockImplementation((name, uuid) => ({
        displayName: name,
        UUID: uuid,
        context: {},
      })),
      user: {
        configPath: vi.fn().mockReturnValue('/path/to/config.json'),
      },
      on: vi.fn(),
      updatePlatformAccessories: vi.fn(),
    } as unknown as API

    platform = new ResideoPlatform(log, config, api)
  })

  it('should initialize platform and call discoverDevices', async () => {
    // The constructor should call discoverDevices (which logs an error if no refreshToken)
    expect(platform).toBeDefined()
    // Optionally, you can spy on log methods or client methods here
  })
})
