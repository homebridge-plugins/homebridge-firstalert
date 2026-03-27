// FirstAlert API client for OAuth and device polling
// Implements token refresh, account/device fetch, and strong typing
import { request } from 'undici';
export class ResideoClient {
    /**
     * Debug utility: Log all device IDs and types from account
     */
    async logAllDeviceTypes() {
        try {
            const account = await this.getAccount();
            this.logger.info('[ResideoClient] Device list:');
            for (const device of account.devices) {
                this.logger.info(`  deviceId=${device.deviceId}, globalDeviceType=${device.globalDeviceType}, name=${device.name}`);
            }
        }
        catch (err) {
            this.logger.error('[ResideoClient] Failed to log all device types:', err);
        }
    }
    clientId = 'SRmiA7CaYi1JgivDZdzzoZu4X5VBogGt';
    refreshToken;
    accessToken = null;
    logger;
    constructor(refreshToken, logger) {
        this.refreshToken = refreshToken;
        this.logger = logger;
        this.logger.debug('[ResideoClient] Initialized with refreshToken:', refreshToken ? '***' : 'none');
    }
    /**
     * Set the state of a valve device (open/closed)
     */
    async setValveState(deviceId, payload, globalDeviceType) {
        this.logger.debug(`[ResideoClient] Setting valve state for deviceId: ${deviceId} (type: ${globalDeviceType}) with payload:`, JSON.stringify(payload));
        const token = await this.getAccessToken();
        const endpoint = (globalDeviceType === 'ShutoffValve_L7_T' || globalDeviceType === 'SmartMeterValve')
            ? `https://api.resideo.com/ris-public-api/api/v2/devices/shutoffvalves/${deviceId}/state`
            : `https://api.resideo.com/ris-public-api/api/v2/devices/valves/${deviceId}/state`;
        try {
            const { body: resBody } = await request(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            const text = await resBody.text();
            if (!text) {
                this.logger.error(`[ResideoClient] Empty response when setting valve state for ${deviceId}`);
                throw new Error('Empty response from Resideo API');
            }
            let resp;
            try {
                resp = JSON.parse(text);
            }
            catch (parseErr) {
                this.logger.error(`[ResideoClient] Failed to parse valve state response for ${deviceId}:`, text);
                throw parseErr;
            }
            this.logger.debug(`[ResideoClient] Valve state set response for ${deviceId}:`, JSON.stringify(resp));
            return resp;
        }
        catch (err) {
            this.logger.error(`[ResideoClient] Error setting valve state for ${deviceId}:`, err);
            throw err;
        }
    }
    /**
     * Set the state of a thermostat device
     */
    async setThermostatState(deviceId, payload, globalDeviceType) {
        this.logger.debug(`[ResideoClient] Setting thermostat state for deviceId: ${deviceId} (type: ${globalDeviceType}) with payload:`, JSON.stringify(payload));
        const token = await this.getAccessToken();
        // Try multiple endpoints for special thermostat types
        const endpoints = [];
        if (globalDeviceType === 'Denali_X8S' || globalDeviceType === 'DenaliThermostat') {
            endpoints.push(`https://api.resideo.com/ris-public-api/api/v2/devices/denali/${deviceId}/state`);
        }
        if (globalDeviceType === 'Fuji_X2S' || globalDeviceType === 'FujiThermostat') {
            endpoints.push(`https://api.resideo.com/ris-public-api/api/v2/devices/fuji/${deviceId}/state`);
        }
        // Always try the default thermostat endpoint last
        endpoints.push(`https://api.resideo.com/ris-public-api/api/v2/devices/thermostats/${deviceId}/state`);
        let lastError = null;
        for (const endpoint of endpoints) {
            try {
                this.logger.debug(`[ResideoClient] Trying endpoint: ${endpoint}`);
                const { body: resBody } = await request(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                const text = await resBody.text();
                if (!text) {
                    this.logger.error(`[ResideoClient] Empty response when setting thermostat state for ${deviceId} at ${endpoint}`);
                    continue;
                }
                let resp;
                try {
                    resp = JSON.parse(text);
                }
                catch (parseErr) {
                    this.logger.error(`[ResideoClient] Failed to parse thermostat state response for ${deviceId} at ${endpoint}:`, text);
                    continue;
                }
                this.logger.debug(`[ResideoClient] Thermostat state set response for ${deviceId} at ${endpoint}:`, JSON.stringify(resp));
                // Only return if statusCode is not 404 and not >= 400 (error)
                if (!(resp.statusCode && (resp.statusCode === 404 || resp.statusCode >= 400)) && !(resp.error || resp.status === 'error')) {
                    return resp;
                }
                // Otherwise, log and try next
                if (resp.statusCode && resp.statusCode === 404) {
                    this.logger.warn(`[ResideoClient] Endpoint ${endpoint} returned 404 for deviceId: ${deviceId}`);
                }
                else if (resp.statusCode && resp.statusCode >= 400) {
                    this.logger.error(`[ResideoClient] Endpoint ${endpoint} returned error statusCode ${resp.statusCode} for deviceId: ${deviceId}`);
                }
                else if (resp.error || resp.status === 'error') {
                    this.logger.error(`[ResideoClient] Endpoint ${endpoint} returned error in response for deviceId: ${deviceId}: ${JSON.stringify(resp)}`);
                }
                lastError = resp;
            }
            catch (err) {
                this.logger.error(`[ResideoClient] Error setting thermostat state for ${deviceId} at endpoint ${endpoint}:`, err);
                lastError = err;
            }
        }
        // If all endpoints fail, throw last error
        throw lastError || new Error('All endpoints failed for setThermostatState');
    }
    async refreshAccessToken() {
        this.logger.debug('[ResideoClient] Refreshing access token...');
        const body = JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            client_id: this.clientId,
        });
        try {
            const { body: resBody } = await request('https://login.resideo.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            const text = await resBody.text();
            if (!text) {
                this.logger.error('[ResideoClient] Empty response when refreshing access token');
                throw new Error('Empty response from Resideo API');
            }
            let data;
            try {
                data = JSON.parse(text);
            }
            catch (parseErr) {
                this.logger.error('[ResideoClient] Failed to parse access token response:', text);
                throw parseErr;
            }
            this.accessToken = data.access_token ?? '';
            if (!this.accessToken) {
                this.logger.error('[ResideoClient] Failed to obtain access token from Resideo API');
                throw new Error('Failed to obtain access token from Resideo API');
            }
            this.logger.debug('[ResideoClient] Access token obtained:', `${this.accessToken.substring(0, 8)}...`);
            return this.accessToken;
        }
        catch (err) {
            this.logger.error('[ResideoClient] Error refreshing access token:', err);
            throw err;
        }
    }
    async getAccessToken() {
        if (!this.accessToken) {
            this.logger.debug('[ResideoClient] No cached access token, refreshing...');
            await this.refreshAccessToken();
        }
        return this.accessToken;
    }
    async getAccount() {
        this.logger.debug('[ResideoClient] Fetching account info...');
        const token = await this.getAccessToken();
        try {
            const { body: resBody } = await request('https://api.resideo.com/ris-public-api/api/v1/accounts', {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });
            const text = await resBody.text();
            if (!text) {
                this.logger.error('[ResideoClient] Empty response when fetching account info');
                throw new Error('Empty response from Resideo API');
            }
            let resp;
            try {
                resp = JSON.parse(text);
            }
            catch (parseErr) {
                this.logger.error('[ResideoClient] Failed to parse account info response:', text);
                throw parseErr;
            }
            // Parse and flatten devices
            const data = resp.data;
            this.logger.debug('[ResideoClient] Account countryCode:', data.countryCode, 'locale:', data.locale);
            const devices = [];
            for (const user of data.consumerUsers) {
                for (const loc of user.consumerAccount.locations) {
                    for (const dev of loc.consumerDevices) {
                        devices.push({
                            id: dev.id,
                            name: dev.name,
                            deviceId: dev.device.deviceId,
                            globalDeviceType: dev.device.globalDeviceType,
                        });
                    }
                }
            }
            this.logger.debug(`[ResideoClient] Found ${devices.length} devices.`);
            return {
                id: data.id,
                firstName: data.firstName,
                lastName: data.lastName,
                contactEmail: data.contactEmail,
                countryCode: data.countryCode,
                locale: data.locale,
                devices,
            };
        }
        catch (err) {
            this.logger.error('[ResideoClient] Error fetching account info:', err);
            throw err;
        }
    }
    async getDeviceState(deviceId) {
        this.logger.debug(`[ResideoClient] Fetching device state for deviceId: ${deviceId}`);
        const token = await this.getAccessToken();
        try {
            const { body: resBody } = await request(`https://api.resideo.com/ris-public-api/api/v2/devices/smokeDetectors/${deviceId}/state`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });
            const text = await resBody.text();
            if (!text) {
                this.logger.error(`[ResideoClient] Empty response when fetching device state for ${deviceId}`);
                throw new Error('Empty response from Resideo API');
            }
            let state;
            try {
                state = JSON.parse(text);
            }
            catch (parseErr) {
                this.logger.error(`[ResideoClient] Failed to parse device state response for ${deviceId}:`, text);
                throw parseErr;
            }
            this.logger.debug(`[ResideoClient] Device state for ${deviceId}:`, JSON.stringify(state));
            return state;
        }
        catch (err) {
            this.logger.error(`[ResideoClient] Error fetching device state for ${deviceId}:`, err);
            throw err;
        }
    }
}
//# sourceMappingURL=resideoClient.js.map