# homebridge-firstalert

[![npm](https://img.shields.io/npm/v/homebridge-firstalert)](https://www.npmjs.com/package/homebridge-firstalert)
[![Homebridge](https://img.shields.io/badge/homebridge-%5E2.0.0-blueviolet)](https://homebridge.io/)

A [Homebridge](https://homebridge.io/) plugin for [First Alert](https://www.firstalert.com/) smoke and carbon monoxide detectors.

## Features

- Exposes First Alert smoke and CO detectors to HomeKit / Matter
- Supports HAP (HomeKit Accessory Protocol) for all Homebridge versions
- Supports **Matter** when running on Homebridge v2.0+ with Matter enabled
- Automatic HAP ↔ Matter selection via `preferMatter` / `enableMatter` config flags

## Installation

```bash
npm install -g homebridge-firstalert
```

Or install via the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x).

## Configuration

Add the platform to your Homebridge `config.json`:

```json
{
  "platform": "FirstAlert",
  "name": "First Alert",
  "devices": [
    {
      "deviceId": "AA:BB:CC:DD:EE:FF",
      "name": "Living Room Smoke Detector",
      "deviceType": "smoke-co",
      "enabled": true
    }
  ]
}
```

### Device Types

| Value | Description |
|-------|-------------|
| `smoke` | Smoke detector only |
| `co` | Carbon monoxide detector only |
| `smoke-co` | Combination smoke and CO detector |

### Matter Support (Homebridge v2.0+)

When running on Homebridge v2.0 or later with Matter enabled, the plugin automatically uses the Matter protocol instead of HAP. This allows native discovery by Apple Home, Google Home, and Amazon Alexa without a separate bridge.

| Option | Default | Description |
|--------|---------|-------------|
| `preferMatter` | `true` | Use Matter when available |
| `enableMatter` | `true` | Override Matter auto-detection |

Set `preferMatter: false` or `enableMatter: false` to force HAP mode.

## License

ISC
