# Resideo First Alert API Documentation

This documentation provides a comprehensive reference for the Resideo First Alert API, as reverse-engineered from the official mobile app and the ha-resideo-firstalert integration. Use this as a guide for implementing Homebridge plugins or integrating with the Homebridge UI.

---

## Authentication

- **OAuth 2.0 with PKCE** via Auth0
- **Auth Domain:** `login.resideo.com`
- **Client ID:** `SRmiA7CaYi1JgivDZdzzoZu4X5VBogGt`
- **Audience:** `https://resideo-prod.auth0.com/api/v2/`
- **Scopes:** `openid profile email offline_access`

### Token Refresh

Tokens expire after 1 hour. Use the refresh token to obtain new access tokens:

```http
POST https://login.resideo.com/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token>",
  "client_id": "SRmiA7CaYi1JgivDZdzzoZu4X5VBogGt"
}
```

---

## API Endpoints

**Base URL:** `https://api.resideo.com`

All requests require:
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`
- `Accept: application/json`

### Get Account Information

```http
GET /ris-public-api/api/v1/accounts
```

#### Example Response

```json
{
  "data": {
    "id": "...",
    "firstName": "John",
    "lastName": "Doe",
    ...
    "consumerUsers": [
      {
        "role": "ADMIN",
        "consumerAccount": {
          "locations": [
            {
              "name": "Home",
              "address": { ... },
              "consumerDevices": [
                {
                  "name": "Living Room Detector",
                  "device": {
                    "deviceId": "XXXXXXXXXXXX",
                    "globalDeviceType": "Citadel_SC5"
                  }
                }
              ]
            }
          ]
        }
      }
    ]
  },
  "errors": []
}
```

### Get Device State

```http
GET /ris-public-api/api/v2/devices/smokeDetectors/{deviceId}/state
```

#### Example Response

```json
{
  "name": "XXXXXXXXXXXX",
  "deviceType": "SmokeDetector",
  "sku": "SMCO600NVACA",
  ...
  "deviceState": {
    "reported": {
      "alarmState": {
        "co": { "deviceState": "idle" },
        "smoke": { "deviceState": "idle" },
        "test": { "deviceState": "idle" },
        "malfunction": { "deviceState": "none" },
        "battery": { "deviceState": "good" },
        "eol": { "deviceState": "no" },
        "power": { "deviceState": "ac" },
        "silence": { "deviceState": "not_silenced" }
      },
      "deviceConfig": { ... },
      "deviceInfo": { ... },
      "deviceStatus": { ... },
      "deviceStatusFlags": { ... }
    }
  }
}
```

---

## Alarm State Values

| State                | Values / Description                        |
|----------------------|---------------------------------------------|
| smoke.deviceState    | `idle` (normal), `alarm` (smoke detected)   |
| co.deviceState       | `idle` (normal), `alarm` (CO detected)      |
| battery.deviceState  | `good`, `low`                               |
| power.deviceState    | `ac`, `battery`                             |
| malfunction.deviceState | `none`, (other = malfunction)            |
| silence.deviceState  | `not_silenced`, `silenced`                  |
| eol.deviceState      | `no`, `yes`                                 |
| test.deviceState     | `idle`, `testing`                           |

---

## Device Types

| globalDeviceType | Description                                      |
|------------------|-------------------------------------------------|
| Citadel_SC5      | First Alert Safe & Sound Smart Smoke/CO Alarm    |

---

## Integration Notes

### Sensors to Expose

- **Binary Sensors:**
  - Smoke Alarm (`alarmState.smoke.deviceState` != "idle")
  - CO Alarm (`alarmState.co.deviceState` != "idle")
  - Malfunction (`alarmState.malfunction.deviceState` != "none")
  - Online Status (`isOnline`)
- **Sensors:**
  - Battery Status (`alarmState.battery.deviceState`)
  - Power Source (`alarmState.power.deviceState`)
  - WiFi Signal Strength (`deviceStatus.rssi`)
  - Last Message Time (`lastMessageReceivedTime`)
- **Diagnostic:**
  - Firmware versions
  - End of Life status
  - Fault flags

### Polling Interval

- Recommended: every 30-60 seconds
- Device reports timestamps in `tStampEpoch` format

### OAuth Flow

- Implement full PKCE flow:
  1. Generate code_verifier and code_challenge
  2. Open browser to authorization URL
  3. Handle callback with authorization code
  4. Exchange code for tokens
  5. Store and refresh tokens as needed

---

## Example Python Client

```python
import requests

class ResideoClient:
    def __init__(self, refresh_token: str):
        self.client_id = "SRmiA7CaYi1JgivDZdzzoZu4X5VBogGt"
        self.refresh_token = refresh_token
        self.access_token = None

    def _refresh_access_token(self):
        resp = requests.post(
            "https://login.resideo.com/oauth/token",
            json={
                "grant_type": "refresh_token",
                "refresh_token": self.refresh_token,
                "client_id": self.client_id
            }
        )
        data = resp.json()
        self.access_token = data["access_token"]
        return self.access_token

    def _headers(self):
        if not self.access_token:
            self._refresh_access_token()
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    def get_accounts(self):
        resp = requests.get(
            "https://api.resideo.com/ris-public-api/api/v1/accounts",
            headers=self._headers()
        )
        return resp.json()
```

---

## References

- [ha-resideo-firstalert GitHub](https://github.com/aidenmitchell/ha-resideo-firstalert)
- [Official Resideo API Docs (if available)](https://developer.resideo.com/)

---

*This document is intended for developers integrating Resideo First Alert devices with Homebridge or similar platforms. For questions or contributions, see the linked GitHub repository.*
