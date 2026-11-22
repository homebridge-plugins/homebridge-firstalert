import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RESIDEO_API_HEADERS, ResideoApiError, ResideoClient } from '../src/api/resideoClient.js'

const log = { debug() {}, info() {}, warn() {}, error() {} }
const ACCOUNTS = '/ris-public-api/api/v1/accounts'
const account = {
  data: {
    id: 1,
    countryCode: 'US',
    consumerUsers: [{ consumerAccount: { locations: [{ consumerDevices: [
      { id: 9, name: 'Hallway', device: { deviceId: 'D1', globalDeviceType: 'Citadel_SC5' } },
    ] }] } }],
  },
}

describe('resideoClient', () => {
  let agent: MockAgent
  let previous: ReturnType<typeof getGlobalDispatcher>
  let dir: string
  let sentRefreshTokens: string[]

  const login = () => agent.get('https://login.resideo.com')
  const api = () => agent.get('https://api.ha.resideo.com')
  const tokenReply = (access: string, refresh?: string) =>
    login().intercept({ path: '/oauth/token', method: 'POST' }).reply(200, (opts: any) => {
      sentRefreshTokens.push(JSON.parse(opts.body).refresh_token)
      return { access_token: access, expires_in: 3600, ...(refresh ? { refresh_token: refresh } : {}) }
    })

  beforeEach(() => {
    previous = getGlobalDispatcher()
    agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firstalert-'))
    sentRefreshTokens = []
  })

  afterEach(() => {
    setGlobalDispatcher(previous)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('calls api.ha.resideo.com with the APIM key and app User-Agent', async () => {
    tokenReply('A1')
    let headers: Record<string, string> = {}
    api().intercept({ path: ACCOUNTS }).reply(200, (opts: any) => {
      headers = opts.headers
      return account
    })
    const result = await new ResideoClient('R1', log, dir).getAccount()
    expect(result.devices).toEqual([{ id: 9, name: 'Hallway', deviceId: 'D1', globalDeviceType: 'Citadel_SC5' }])
    expect(headers['Ocp-Apim-Subscription-Key']).toBe(RESIDEO_API_HEADERS['Ocp-Apim-Subscription-Key'])
    expect(headers['User-Agent']).toBe(RESIDEO_API_HEADERS['User-Agent'])
    expect(headers.Authorization).toBe('Bearer A1')
  })

  it('throws a ResideoApiError carrying the status on a maintenance 503', async () => {
    tokenReply('A1')
    api().intercept({ path: ACCOUNTS }).reply(503, { statusCode: 503, message: 'The API is temporarily down for planned maintenance.' })
    const err = await new ResideoClient('R1', log, dir).getAccount().catch(e => e)
    expect(err).toBeInstanceOf(ResideoApiError)
    expect(err.status).toBe(503)
  })

  it('persists a rotated refresh token and uses it after a restart', async () => {
    tokenReply('A1', 'R2')
    api().intercept({ path: ACCOUNTS }).reply(200, account)
    await new ResideoClient('R1', log, dir).getAccount()
    const stored = JSON.parse(fs.readFileSync(path.join(dir, '.firstalert-token.json'), 'utf8'))
    expect(stored.refreshToken).toBe('R2')
    expect(fs.statSync(path.join(dir, '.firstalert-token.json')).mode & 0o777).toBe(0o600)

    // Same token still in config.json, as after a reboot: the stored rotated token must win.
    tokenReply('A2', 'R3')
    api().intercept({ path: ACCOUNTS }).reply(200, account)
    await new ResideoClient('R1', log, dir).getAccount()
    expect(sentRefreshTokens).toEqual(['R1', 'R2'])
  })

  it('prefers a newly linked token over a stored one from an older link', async () => {
    tokenReply('A1', 'R2')
    api().intercept({ path: ACCOUNTS }).reply(200, account)
    await new ResideoClient('R1', log, dir).getAccount()

    tokenReply('A9', 'R10')
    api().intercept({ path: ACCOUNTS }).reply(200, account)
    await new ResideoClient('R9', log, dir).getAccount()
    expect(sentRefreshTokens).toEqual(['R1', 'R9'])
  })

  it('reports invalid_grant as a 403 ResideoApiError', async () => {
    login().intercept({ path: '/oauth/token', method: 'POST' }).reply(403, { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' })
    const err = await new ResideoClient('R1', log, dir).getAccount().catch(e => e)
    expect(err).toBeInstanceOf(ResideoApiError)
    expect(err.status).toBe(403)
  })

  it('refreshes once and retries on a 401', async () => {
    tokenReply('A1')
    api().intercept({ path: ACCOUNTS }).reply(401, { message: 'expired' })
    tokenReply('A2')
    let auth = ''
    api().intercept({ path: ACCOUNTS }).reply(200, (opts: any) => {
      auth = opts.headers.Authorization
      return account
    })
    await new ResideoClient('R1', log, dir).getAccount()
    expect(auth).toBe('Bearer A2')
  })
})
