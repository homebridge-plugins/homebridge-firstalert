import type { API } from 'homebridge'

import { FirstAlertHAPPlatform } from './FirstAlertHAPPlatform.js'
import { FirstAlertMatterPlatform } from './FirstAlertMatterPlatform.js'
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js'
import { createPlatformProxy } from './utils.js'

/**
 * Registers the First Alert platform with Homebridge.
 *
 * A proxy constructor is used so that the runtime can automatically select
 * between the HAP platform and the Matter platform depending on whether
 * Homebridge Matter support is available and enabled in the user's config.
 *
 * @param api The Homebridge API instance.
 */
export default (api: API): void => {
  const ProxyCtor = createPlatformProxy(FirstAlertHAPPlatform, FirstAlertMatterPlatform)
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ProxyCtor as any)
}
