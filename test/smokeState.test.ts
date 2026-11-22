import { describe, expect, it } from 'vitest'

import { parseSmokeState } from '../src/devices/smokeState.js'

function sc5(alarmState: Record<string, string>, extra: Record<string, unknown> = {}, flags: Record<string, boolean> = {}) {
  return {
    isOnlineComputed: true,
    ...extra,
    deviceState: {
      reported: {
        alarmState: Object.fromEntries(Object.entries(alarmState).map(([k, v]) => [k, { deviceState: v }])),
        deviceStatusFlags: flags,
      },
    },
  }
}

describe('parseSmokeState', () => {
  it('reports an idle SC5 as clear', () => {
    const p = parseSmokeState(sc5({ smoke: 'none', co: 'none', battery: 'good', malfunction: 'none', eol: 'no' }))
    expect(p).toMatchObject({ smoke: false, co: false, batteryLow: false, online: true, faulted: false })
  })

  it.each(['alarm', 'smokeAlarm', 'smokeEarlyWarning', 'smokeInterconnectAlarm', 'smokeEarlyWarningInterconnectAlarm'])(
    'detects smoke for %s',
    (state) => {
      expect(parseSmokeState(sc5({ smoke: state, co: 'none' })).smoke).toBe(true)
    },
  )

  it.each(['coAlarm', 'carbonMonoxideAlarm', 'carbonMonoxideInterconnectAlarm'])('detects CO for %s', (state) => {
    const p = parseSmokeState(sc5({ smoke: 'none', co: state }))
    expect(p).toMatchObject({ smoke: false, co: true })
  })

  it.each(['low', 'replace', 'critical'])('flags battery state %s as low', (state) => {
    expect(parseSmokeState(sc5({ battery: state })).batteryLow).toBe(true)
  })

  it('flags end of life as low battery', () => {
    expect(parseSmokeState(sc5({ battery: 'good', eol: 'yes' })).batteryLow).toBe(true)
  })

  it('reports offline and faulted alarms', () => {
    const p = parseSmokeState(sc5({ smoke: 'none' }, { isOnlineComputed: false }, { photoFault: true }))
    expect(p).toMatchObject({ online: false, faulted: true, smoke: false })
  })

  it('still honours legacy flat booleans', () => {
    expect(parseSmokeState({ smokePresent: true, coPresent: true })).toMatchObject({ smoke: true, co: true })
  })

  it('treats a missing payload as clear rather than throwing', () => {
    expect(parseSmokeState(undefined)).toMatchObject({ smoke: false, co: false, batteryLow: false })
  })
})
