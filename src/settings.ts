/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'FirstAlert'

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-firstalert'

/**
 * Plugin configuration interface
 */
export interface FirstAlertPluginConfig {
  /** Platform name */
  name?: string
  /** List of devices to manage */
  devices?: FirstAlertDeviceConfig[]
  /** Whether to prefer Matter over HAP when both are available */
  preferMatter?: boolean
  /** Manually enable or disable Matter support (overrides auto-detection) */
  enableMatter?: boolean
  /** Allow indexing by other string keys */
  [key: string]: unknown
}

/**
 * Configuration for a single First Alert device
 */
export interface FirstAlertDeviceConfig {
  /** Unique identifier for this device */
  deviceId: string
  /** Display name for this device */
  name?: string
  /** Type of device */
  deviceType: 'smoke' | 'co' | 'smoke-co'
  /** Whether this device is enabled */
  enabled?: boolean
  /** Whether to publish this device as a standalone external accessory instead of a bridged one */
  external?: boolean
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<FirstAlertPluginConfig> = {
  preferMatter: true,
  enableMatter: true,
}
