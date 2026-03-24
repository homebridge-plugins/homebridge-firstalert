import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { URLSearchParams } from 'node:url'
import { request as undiciRequest } from 'undici'

// Resideo/First Alert constants
const OAUTH_CLIENT_ID = 'SRmiA7CaYi1JgivDZdzzoZu4X5VBogGt'
const OAUTH_TOKEN_URL = 'https://login.resideo.com/oauth/token'
const AUTH0_BASE_URL = 'https://login.resideo.com'
const AUTH0_AUTHORIZE_URL = `${AUTH0_BASE_URL}/authorize`
const REDIRECT_URI = 'com.resideo.firstalert://login.resideo.com/ios/com.resideo.firstalert/callback'
const AUDIENCE = 'https://resideo-prod.auth0.com/api/v2/'
const SCOPE = 'openid profile email offline_access'
const AUTH0_CLIENT_APP = 'eyJ2ZXJzaW9uIjoiMS4xNC4wIiwibmFtZSI6ImF1dGgwLWZsdXR0ZXIiLCJlbnYiOnsiY29yZSI6IjIuMTAuMCIsImlPUyI6IjI2LjEiLCJzd2lmdCI6IjUueCJ9fQ'

// Regexes moved to module scope

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super()

    // Resideo Auth (PKCE OAuth 2.0 browser-based flow)
    this.onRequest('startResideoAuth', async (payload: any): Promise<CustomRequestResponse> => {
      // If no code, generate PKCE and return authorize URL for UI
      const { code, codeVerifier } = payload || {}
      if (!code) {
        // Step 1: Generate PKCE code_verifier and code_challenge
        const generatedVerifier = crypto.randomBytes(32).toString('base64url')
        const challenge = crypto.createHash('sha256').update(generatedVerifier).digest('base64url')
        const state = crypto.randomBytes(32).toString('base64url')
        // Step 2: Build authorize URL
        const params = new URLSearchParams({
          state,
          scope: SCOPE,
          signUpUrl: 'https://myid.resideo.com/sign-up?userType=consumer',
          client_id: OAUTH_CLIENT_ID,
          code_challenge_method: 'S256',
          response_type: 'code',
          max_age: '0',
          audience: AUDIENCE,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          prompt: 'login',
          auth0Client: AUTH0_CLIENT_APP,
        })
        const authorizeUrl = `${AUTH0_AUTHORIZE_URL}?${params.toString()}`
        // Return URL and code_verifier to UI (UI must open URL in browser and collect code)
        return {
          status: 'need_code',
          data: {
            authorizeUrl,
            codeVerifier: generatedVerifier,
            state,
            instructions: 'Open the authorizeUrl in a browser, log in, and paste the code from the redirect URI back into the UI.',
          },
        }
      }
      // Step 3: Exchange code for tokens
      if (!codeVerifier) {
        return { status: 'error', data: 'Missing PKCE code_verifier' }
      }
      try {
        const tokenData = {
          client_id: OAUTH_CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
        }
        const tokenHeaders = {
          'Auth0-Client': AUTH0_CLIENT_APP,
          'Content-Type': 'application/json',
        }
        const tokenRes = await undiciRequest(OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: tokenHeaders,
          body: JSON.stringify(tokenData),
        })
        const tokenText = await tokenRes.body.text()
        if (tokenRes.statusCode !== 200) {
          return { status: 'error', data: `Token exchange failed: ${tokenRes.statusCode} - ${tokenText}` }
        }
        let tokens: { access_token: any, refresh_token: any }
        try {
          tokens = JSON.parse(tokenText)
        } catch (e: any) {
          return { status: 'error', data: `Error parsing token response JSON: ${e?.message || e}` }
        }
        return { status: 'ok', data: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token } }
      } catch (err) {
        return { status: 'error', data: (err && typeof err === 'object' && 'message' in err) ? (err as any).message : String(err) }
      }
    })

    interface CustomRequestResponse {
      status: string
      data?: any
      logs?: string[]
    }

    // OAuth PKCE flow handler
    this.onRequest('startOAuthFlow', async (payload): Promise<CustomRequestResponse> => {
      try {
        const { consumerKey, consumerSecret, code, codeVerifier } = payload || {}
        if (!consumerKey || !consumerSecret) {
          return { status: 'error', data: 'Missing consumerKey or consumerSecret' }
        }
        // If no code, generate PKCE and return authUrl for UI
        if (!code) {
          const generatedVerifier = crypto.randomBytes(32).toString('base64url')
          const challenge = crypto.createHash('sha256').update(generatedVerifier).digest('base64url')
          const redirectUri = 'urn:ietf:wg:oauth:2.0:oob'
          const authUrl = `https://api.honeywell.com/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(consumerKey)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256&appSelect=1`
          return { status: 'need_code', data: { authUrl, codeVerifier: generatedVerifier } }
        }
        // Exchange code for tokens
        if (!codeVerifier) {
          return { status: 'error', data: 'Missing PKCE code_verifier' }
        }
        const redirectUri = 'urn:ietf:wg:oauth:2.0:oob'
        const tokenRes = await fetch('https://api.honeywell.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_verifier=${encodeURIComponent(codeVerifier)}`,
        })
        const tokenData = await tokenRes.json()
        if (tokenData.refresh_token) {
          return { status: 'ok', data: { refreshToken: tokenData.refresh_token, accessToken: tokenData.access_token } }
        } else {
          return { status: 'error', data: tokenData }
        }
      } catch (err) {
        return { status: 'error', data: (err && typeof err === 'object' && 'message' in err) ? (err as any).message : String(err) }
      }
    })

    // Device discovery handler
    this.onRequest('discoverDevices', async (payload): Promise<CustomRequestResponse> => {
      try {
        const { accessToken } = payload || {}
        if (!accessToken) {
          return { status: 'error', data: 'No access token provided' }
        }
        const res = await fetch('https://api.honeywell.com/v2/devices', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })
        if (!res.ok) {
          return { status: 'error', data: await res.text() }
        }
        const data = await res.json()
        return { status: 'ok', data }
      } catch (err) {
        return { status: 'error', data: (err && typeof err === 'object' && 'message' in err) ? (err as any).message : String(err) }
      }
    })

    // Legacy: getCachedAccessories for older config-ui-x
    this.onRequest('/getCachedAccessories', async (): Promise<CustomRequestResponse> => {
      try {
        const plugin = '@homebridge-plugins/homebridge-firstalert'
        const devicesToReturn: any[] = []
        const accFile = `${this.homebridgeStoragePath}/accessories/cachedAccessories`
        if (fs.existsSync(accFile)) {
          const cachedAccessoriesData = await fs.promises.readFile(accFile, 'utf8')
          const cachedAccessories: any[] = JSON.parse(cachedAccessoriesData)
          cachedAccessories
            .filter((accessory: any) => accessory.plugin === plugin)
            .forEach((accessory: any) => devicesToReturn.push(accessory))
        }
        return { status: 'ok', data: devicesToReturn }
      } catch (err) {
        return { status: 'error', data: [] }
      }
    })

    this.ready()
  }
}

(() => new PluginUiServer())()
