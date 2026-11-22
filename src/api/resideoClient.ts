// FirstAlert API client for OAuth and device polling
// Implements token refresh, account/device fetch, and strong typing

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { request } from 'undici'

/**
 * Resideo retired api.resideo.com in September 2026. It now answers every call with a
 * permanent 503 "The API is temporarily down for planned maintenance". The consumer API
 * moved to api.ha.resideo.com, which rejects calls that lack the First Alert app's
 * (public, non-secret) Azure APIM subscription key and an app User-Agent.
 */
export const RESIDEO_API_BASE_URL = 'https://api.ha.resideo.com'
export const RESIDEO_TOKEN_URL = 'https://login.resideo.com/oauth/token'
export const RESIDEO_API_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Ocp-Apim-Subscription-Key': 'b60885e8a9b44680a29ea1f03452878a',
  'User-Agent': 'First Alert/2440 CFNetwork/3860.600.12 Darwin/25.5.0',
})

/** Error carrying the HTTP status so callers can tell auth failures from outages. */
export class ResideoApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: unknown) {
    super(message)
    this.name = 'ResideoApiError'
  }
}

const TOKEN_FILE_NAME = '.firstalert-token.json'
const hashToken = (token: string): string => crypto.createHash('sha256').update(String(token)).digest('hex')

export interface ResideoDevice {
  id: string
  name: string
  deviceId: string
  globalDeviceType: string
}

export interface ResideoAccount {
  id: string
  firstName: string
  lastName: string
  contactEmail: string
  countryCode: string
  locale: string
  devices: ResideoDevice[]
}

export interface ResideoDeviceState {
  name: string
  deviceType: string
  isOnline: boolean
  deviceState: any
}

export class ResideoClient {
  /**
   * Debug utility: Log all device IDs and types from account
   */
  async logAllDeviceTypes(): Promise<void> {
    try {
      const account = await this.getAccount()
      this.logger.info('[ResideoClient] Device list:')
      for (const device of account.devices) {
        this.logger.info(`  deviceId=${device.deviceId}, globalDeviceType=${device.globalDeviceType}, name=${device.name}`)
      }
    } catch (err) {
      this.logger.error('[ResideoClient] Failed to log all device types:', err)
    }
  }

  private clientId = 'SRmiA7CaYi1JgivDZdzzoZu4X5VBogGt'
  private refreshToken: string
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
  private readonly configTokenHash: string
  private readonly tokenFile: string
  private logger: any

  /**
   * @param refreshToken The refresh token saved in config.json by the account-linking UI.
   * @param logger Homebridge logger.
   * @param storageDir Homebridge storage path. Resideo rotates refresh tokens on every use,
   * so the newest token is persisted here; without it the plugin breaks on its next restart.
   */
  constructor(refreshToken: string, logger: any, storageDir?: string) {
    this.refreshToken = refreshToken
    this.logger = logger
    this.configTokenHash = hashToken(refreshToken)
    const dir = storageDir || process.env.HOMEBRIDGE_STORAGE_PATH || process.env.UIX_STORAGE_PATH || ''
    this.tokenFile = dir ? path.join(dir, TOKEN_FILE_NAME) : ''
    this.loadStoredToken()
    this.logger.debug('[ResideoClient] Initialized with refreshToken:', refreshToken ? '***' : 'none')
  }

  /** Use the newest rotated refresh token, if it belongs to the account currently linked in config. */
  private loadStoredToken(): void {
    if (!this.tokenFile) {
      return
    }
    try {
      const stored = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'))
      if (stored?.configTokenHash === this.configTokenHash && stored.refreshToken) {
        this.refreshToken = stored.refreshToken
      } else if (stored) {
        this.logger.info('[ResideoClient] Account was re-linked; ignoring previously stored token')
      }
    } catch {
      // No stored token yet.
    }
  }

  /** Persist a rotated refresh token atomically, readable only by the Homebridge user. */
  private saveStoredToken(): void {
    if (!this.tokenFile) {
      this.logger.warn('[ResideoClient] No storage path; rotated refresh token cannot be persisted')
      return
    }
    try {
      const tmp = `${this.tokenFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({
        configTokenHash: this.configTokenHash,
        refreshToken: this.refreshToken,
        updatedAt: new Date().toISOString(),
      }), { mode: 0o600 })
      fs.renameSync(tmp, this.tokenFile)
    } catch (err: any) {
      this.logger.error('[ResideoClient] Failed to persist rotated refresh token:', err?.message ?? err)
    }
  }

  /** Authenticated GET with HTTP status checking and a single retry on 401. */
  private async apiGet(urlPath: string, retried = false): Promise<any> {
    const token = await this.getAccessToken()
    const { statusCode, body } = await request(`${RESIDEO_API_BASE_URL}${urlPath}`, {
      method: 'GET',
      headers: { ...RESIDEO_API_HEADERS, Authorization: `Bearer ${token}` },
    })
    const text = await body.text()
    let data: any
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    if (statusCode === 401 && !retried) {
      this.accessToken = null
      return this.apiGet(urlPath, true)
    }
    if (statusCode < 200 || statusCode >= 300) {
      const msg = data?.message || data?.error || text.slice(0, 200) || `HTTP ${statusCode}`
      throw new ResideoApiError(`Resideo API ${statusCode}: ${msg}`, statusCode, data)
    }
    if (data === undefined) {
      throw new ResideoApiError('Empty or non-JSON response from Resideo API', statusCode)
    }
    return data
  }

  /**
   * Set the state of a valve device (open/closed)
   */
  async setValveState(deviceId: string, payload: any, globalDeviceType?: string): Promise<any> {
    this.logger.debug(`[ResideoClient] Setting valve state for deviceId: ${deviceId} (type: ${globalDeviceType}) with payload:`, JSON.stringify(payload))
    const token = await this.getAccessToken()
    const endpoint = (globalDeviceType === 'ShutoffValve_L7_T' || globalDeviceType === 'SmartMeterValve')
      ? `${RESIDEO_API_BASE_URL}/ris-public-api/api/v2/devices/shutoffvalves/${deviceId}/state`
      : `${RESIDEO_API_BASE_URL}/ris-public-api/api/v2/devices/valves/${deviceId}/state`
    try {
      const { body: resBody } = await request(endpoint, {
        method: 'POST',
        headers: {
          ...RESIDEO_API_HEADERS,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const text = await resBody.text()
      if (!text) {
        this.logger.error(`[ResideoClient] Empty response when setting valve state for ${deviceId}`)
        throw new Error('Empty response from Resideo API')
      }
      let resp
      try {
        resp = JSON.parse(text)
      } catch (parseErr) {
        this.logger.error(`[ResideoClient] Failed to parse valve state response for ${deviceId}:`, text)
        throw parseErr
      }
      this.logger.debug(`[ResideoClient] Valve state set response for ${deviceId}:`, JSON.stringify(resp))
      return resp
    } catch (err) {
      this.logger.error(`[ResideoClient] Error setting valve state for ${deviceId}:`, err)
      throw err
    }
  }

  /**
   * Set the state of a thermostat device
   */
  async setThermostatState(deviceId: string, payload: any, globalDeviceType?: string): Promise<any> {
    this.logger.debug(`[ResideoClient] Setting thermostat state for deviceId: ${deviceId} (type: ${globalDeviceType}) with payload:`, JSON.stringify(payload))
    const token = await this.getAccessToken()
    // Try multiple endpoints for special thermostat types
    const endpoints: string[] = []
    if (globalDeviceType === 'Denali_X8S' || globalDeviceType === 'DenaliThermostat') {
      endpoints.push(`${RESIDEO_API_BASE_URL}/ris-public-api/api/v2/devices/denali/${deviceId}/state`)
    }
    if (globalDeviceType === 'Fuji_X2S' || globalDeviceType === 'FujiThermostat') {
      endpoints.push(`${RESIDEO_API_BASE_URL}/ris-public-api/api/v2/devices/fuji/${deviceId}/state`)
    }
    // Always try the default thermostat endpoint last
    endpoints.push(`${RESIDEO_API_BASE_URL}/ris-public-api/api/v2/devices/thermostats/${deviceId}/state`)

    let lastError: any = null
    for (const endpoint of endpoints) {
      try {
        this.logger.debug(`[ResideoClient] Trying endpoint: ${endpoint}`)
        const { body: resBody } = await request(endpoint, {
          method: 'POST',
          headers: {
            ...RESIDEO_API_HEADERS,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const text = await resBody.text()
        if (!text) {
          this.logger.error(`[ResideoClient] Empty response when setting thermostat state for ${deviceId} at ${endpoint}`)
          continue
        }
        let resp: { statusCode: number, error: any, status: string }
        try {
          resp = JSON.parse(text)
        } catch (parseErr) {
          this.logger.error(`[ResideoClient] Failed to parse thermostat state response for ${deviceId} at ${endpoint}:`, text)
          continue
        }
        this.logger.debug(`[ResideoClient] Thermostat state set response for ${deviceId} at ${endpoint}:`, JSON.stringify(resp))
        // Only return if statusCode is not 404 and not >= 400 (error)
        if (!(resp.statusCode && (resp.statusCode === 404 || resp.statusCode >= 400)) && !(resp.error || resp.status === 'error')) {
          return resp
        }
        // Otherwise, log and try next
        if (resp.statusCode && resp.statusCode === 404) {
          this.logger.warn(`[ResideoClient] Endpoint ${endpoint} returned 404 for deviceId: ${deviceId}`)
        } else if (resp.statusCode && resp.statusCode >= 400) {
          this.logger.error(`[ResideoClient] Endpoint ${endpoint} returned error statusCode ${resp.statusCode} for deviceId: ${deviceId}`)
        } else if (resp.error || resp.status === 'error') {
          this.logger.error(`[ResideoClient] Endpoint ${endpoint} returned error in response for deviceId: ${deviceId}: ${JSON.stringify(resp)}`)
        }
        lastError = resp
      } catch (err) {
        this.logger.error(`[ResideoClient] Error setting thermostat state for ${deviceId} at endpoint ${endpoint}:`, err)
        lastError = err
      }
    }
    // If all endpoints fail, throw last error
    throw lastError || new Error('All endpoints failed for setThermostatState')
  }

  async refreshAccessToken(): Promise<string> {
    this.logger.debug('[ResideoClient] Refreshing access token...')
    // Another process (the settings UI or the bridge) may have rotated the token since we started.
    this.loadStoredToken()
    const { statusCode, body: resBody } = await request(RESIDEO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.clientId }),
    })
    const text = await resBody.text()
    let data: { access_token?: string, refresh_token?: string, expires_in?: number, error?: string, error_description?: string } = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      // Non-JSON error page; handled below.
    }
    if (statusCode !== 200 || !data.access_token) {
      const reason = data.error_description || data.error || `HTTP ${statusCode}`
      if (data.error === 'invalid_grant') {
        this.logger.error(`[ResideoClient] Resideo rejected the saved login (${reason}). Open the plugin settings and click "Link Resideo Account" again.`)
      } else {
        this.logger.error(`[ResideoClient] Token refresh failed: ${reason}`)
      }
      throw new ResideoApiError(`Token refresh failed: ${reason}`, statusCode, data)
    }
    this.accessToken = data.access_token
    this.accessTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token
      this.saveStoredToken()
      this.logger.debug('[ResideoClient] Refresh token rotated and saved')
    }
    return this.accessToken
  }

  async getAccessToken(): Promise<string> {
    if (!this.accessToken || Date.now() > this.accessTokenExpiresAt - 60_000) {
      await this.refreshAccessToken()
    }
    return this.accessToken!
  }

  async getAccount(): Promise<ResideoAccount> {
    this.logger.debug('[ResideoClient] Fetching account info...')
    const resp = await this.apiGet('/ris-public-api/api/v1/accounts')
    const data = resp?.data ?? resp
    if (!data || !Array.isArray(data.consumerUsers)) {
      this.logger.error('[ResideoClient] Unexpected account response shape. Top-level keys:', Object.keys(resp ?? {}).join(','))
      throw new ResideoApiError('Unexpected account response shape', 200)
    }
    const devices: ResideoDevice[] = []
    for (const user of data.consumerUsers) {
      for (const loc of user?.consumerAccount?.locations ?? []) {
        for (const dev of loc?.consumerDevices ?? []) {
          if (!dev?.device?.deviceId) {
            continue
          }
          devices.push({
            id: dev.id,
            name: dev.name,
            deviceId: dev.device.deviceId,
            globalDeviceType: dev.device.globalDeviceType,
          })
        }
      }
    }
    this.logger.debug(`[ResideoClient] Found ${devices.length} devices.`)
    return {
      id: data.id,
      firstName: data.firstName,
      lastName: data.lastName,
      contactEmail: data.contactEmail,
      countryCode: data.countryCode,
      locale: data.locale,
      devices,
    }
  }

  async getDeviceState(deviceId: string): Promise<ResideoDeviceState> {
    this.logger.debug(`[ResideoClient] Fetching device state for deviceId: ${deviceId}`)
    const state = await this.apiGet(`/ris-public-api/api/v2/devices/smokeDetectors/${encodeURIComponent(deviceId)}/state`)
    this.logger.debug(`[ResideoClient] Device state for ${deviceId}:`, JSON.stringify(state))
    return state as ResideoDeviceState
  }
}
