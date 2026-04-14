import type { PlatformConfig } from 'homebridge'

import type { FirstAlertPluginConfig } from './settings.js'

import { DEFAULT_CONFIG } from './settings.js'

/**
 * Normalize and merge incoming platform config with defaults.
 *
 * @param config Raw platform config from Homebridge
 * @returns Merged config with defaults applied
 */
export function normalizeConfig(config: PlatformConfig): FirstAlertPluginConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(config as FirstAlertPluginConfig),
  }
}

/**
 * Factory that creates a platform proxy constructor.
 *
 * When Homebridge instantiates the platform it calls `new ProxyCtor(log, config, api)`.
 * The proxy inspects the runtime environment and delegates to the Matter platform when
 * Matter is available and enabled, falling back to the HAP platform otherwise.
 *
 * @param HAPPlatform The HAP platform class constructor.
 * @param MatterPlatform The Matter platform class constructor.
 * @returns A proxy class that delegates to the correct platform implementation.
 */
export function createPlatformProxy(HAPPlatform: any, MatterPlatform: any): any {
  return class FirstAlertPlatformProxy {
    /** The instantiated platform implementation (HAP or Matter) */
    private impl: any

    /**
     * Constructs the proxy and instantiates the correct platform implementation.
     * @param log Logger instance
     * @param config Platform config
     * @param api Homebridge API instance
     */
    constructor(log: any, config: PlatformConfig, api: any) {
      const cfg = normalizeConfig(config)
      const preferMatter = cfg.preferMatter ?? true
      const enableMatter = cfg.enableMatter ?? true
      const matterAvailable = !!(api?.isMatterAvailable?.() && api?.isMatterEnabled?.())

      if (enableMatter && preferMatter && MatterPlatform && matterAvailable) {
        this.impl = new MatterPlatform(log, cfg, api)
        return this.impl
      }

      // Fallback to HAP
      this.impl = new HAPPlatform(log, cfg, api)
      return this.impl
    }
  }
}
