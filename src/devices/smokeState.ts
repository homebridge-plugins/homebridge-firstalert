/**
 * Parsing for First Alert smoke/CO alarm state returned by
 * GET /ris-public-api/api/v2/devices/smokeDetectors/{deviceId}/state.
 *
 * The real payload nests each alarm kind under
 * deviceState.reported.alarmState.<kind>.deviceState, e.g.
 *   { deviceState: { reported: { alarmState: { smoke: { deviceState: 'smokeAlarm' } } } } }
 * Field names verified against the community client pyresideo-firstalert 1.0.2.
 */

/** deviceState values that mean smoke is currently detected (local or interconnected alarm). */
export const SMOKE_ALARM_STATES: ReadonlySet<string> = new Set([
  'alarm',
  'smokeAlarm',
  'smokeEarlyWarning',
  'smokeInterconnectAlarm',
  'smokeEarlyWarningInterconnectAlarm',
])

/** deviceState values that mean carbon monoxide is currently detected. */
export const CO_ALARM_STATES: ReadonlySet<string> = new Set([
  'alarm',
  'coAlarm',
  'coEarlyWarning',
  'carbonMonoxideAlarm',
  'carbonMonoxideEarlyWarning',
  'carbonMonoxideInterconnectAlarm',
  'carbonMonoxideEarlyWarningInterconnectAlarm',
])

/** Battery is reported as a category, never a percentage. */
const LOW_BATTERY_STATES: ReadonlySet<string> = new Set(['low', 'replace', 'critical'])

export interface ParsedSmokeState {
  smoke: boolean
  co: boolean
  batteryLow: boolean
  online: boolean
  faulted: boolean
  /** Raw per-kind states, for debug logging. */
  states: { smoke: string, co: string, battery: string, malfunction: string, eol: string }
}

export function parseSmokeState(d: any): ParsedSmokeState {
  const reported = d?.deviceState?.reported ?? {}
  const alarm = reported.alarmState ?? {}
  const flags = reported.deviceStatusFlags ?? {}
  const st = (kind: string): string => String(alarm?.[kind]?.deviceState ?? 'unknown')
  const states = { smoke: st('smoke'), co: st('co'), battery: st('battery'), malfunction: st('malfunction'), eol: st('eol') }

  // Older/other models may expose flat booleans; keep honouring them.
  const legacySmoke = !!(d?.smokePresent ?? d?.smoke_detected ?? false)
  const legacyCo = !!(d?.coPresent ?? d?.co_detected ?? false)

  return {
    smoke: SMOKE_ALARM_STATES.has(states.smoke) || legacySmoke,
    co: CO_ALARM_STATES.has(states.co) || legacyCo,
    batteryLow: LOW_BATTERY_STATES.has(states.battery) || states.eol === 'yes'
      || (typeof d?.batteryLevel === 'number' && d.batteryLevel < 15),
    online: Boolean(d?.isOnlineComputed ?? d?.isOnline ?? true),
    faulted: Boolean(flags.fault || flags.photoFault || flags.coFault || flags.e2Fault || flags.driftMalfunction)
      || ['alarm', 'yes'].includes(states.malfunction),
    states,
  }
}

/** Device types that are combination smoke + CO alarms even though "co" is not in the type name. */
export const COMBO_SMOKE_CO_TYPES: ReadonlySet<string> = new Set(['Citadel_SC5'])
