// homebridge-firstalert UI logic extracted from index.html (TypeScript)

declare const homebridge: any;

(async () => {
  try {
    let config: any = await homebridge.getPluginConfig()
    const hasRefresh = !!(Array.isArray(config) ? config[0]?.refreshToken : config.refreshToken)

    // UI elements
    const loginForm = document.getElementById('login-form') as HTMLElement | null
    const unlinkSection = document.getElementById('unlink-section') as HTMLElement | null
    const linkSuccess = document.getElementById('linkSuccess') as HTMLElement | null
    const startAuthButton = document.getElementById('startAuthButton') as HTMLButtonElement | null
    const authInstructions = document.getElementById('authInstructions') as HTMLElement | null
    const codeEntrySection = document.getElementById('codeEntrySection') as HTMLElement | null
    const submitAuthCodeButton = document.getElementById('submitAuthCodeButton') as HTMLButtonElement | null
    const logs = document.getElementById('loginLogs') as HTMLElement | null
    const unlinkButton = document.getElementById('unlinkButton') as HTMLButtonElement | null

    let codeVerifier: string | null = null
    let state: string | null = null

    // Show correct section
    if (hasRefresh) {
      loginForm && (loginForm.style.display = 'none')
      unlinkSection && (unlinkSection.style.display = 'block')
    } else {
      loginForm && (loginForm.style.display = 'block')
      unlinkSection && (unlinkSection.style.display = 'none')
    }

    // Start PKCE OAuth flow
    if (startAuthButton) {
      startAuthButton.onclick = async () => {
        logs && (logs.style.display = 'block')
        if (logs) {
          logs.textContent = ''
        }
        authInstructions && (authInstructions.style.display = 'none')
        codeEntrySection && (codeEntrySection.style.display = 'none')
        homebridge.showSpinner()
        try {
          if (logs) {
            logs.textContent = 'Requesting authorization URL...\n'
          }
          const result = await homebridge.request('startResideoAuth', {})
          if (result.status === 'need_code' && result.data) {
            codeVerifier = result.data.codeVerifier
            state = result.data.state
            const url = result.data.authorizeUrl
            if (authInstructions) {
              authInstructions.innerHTML = '1. <b>Click the button below to open the Resideo login page in your browser.</b><br>2. Log in and authorize the app.<br>3. When redirected, copy the <b>entire URL</b> from your browser\'s address bar and paste it below.<br><br>Example:<br><code>com.resideo.firstalert://login.resideo.com/ios/com.resideo.firstalert/callback?code=AUTH_CODE&state=STATE</code>'
            }
            authInstructions && (authInstructions.style.display = 'block')
            codeEntrySection && (codeEntrySection.style.display = 'block')
            window.open(url, '_blank')
            if (logs) {
              logs.textContent += 'Opened browser for authentication.\n'
            }
          } else {
            if (logs) {
              logs.textContent += 'Failed to get authorization URL.\n'
            }
          }
        } catch (err: any) {
          if (logs) {
            logs.textContent += `Error: ${err?.message || err}\n`
          }
        } finally {
          homebridge.hideSpinner()
        }
      }
    }

    // Submit code handler
    if (submitAuthCodeButton) {
      submitAuthCodeButton.onclick = async () => {
        logs && (logs.style.display = 'block')
        if (logs) {
          logs.textContent = ''
        }
        const urlInput = document.getElementById('inputAuthCodeUrl') as HTMLInputElement | null
        const urlValue = urlInput?.value.trim() || ''
        if (!urlValue || !codeVerifier) {
          if (logs) {
            logs.textContent = 'Missing URL or codeVerifier. Please start the authentication process again.'
          }
          return
        }
        let code = ''
        try {
          const urlObj = new URL(urlValue)
          code = urlObj.searchParams.get('code') || ''
          if (!code) {
            if (logs) {
              logs.textContent = 'Could not find a code parameter in the URL. Please check and try again.'
            }
            return
          }
        } catch (e) {
          if (logs) {
            logs.textContent = 'Invalid URL format. Please paste the full URL you were redirected to.'
          }
          return
        }
        homebridge.showSpinner()
        try {
          if (logs) {
            logs.textContent = 'Exchanging code for tokens...\n'
          }
          const result = await homebridge.request('startResideoAuth', { code, codeVerifier, state })
          if (result.status === 'ok' && result.data && result.data.refreshToken) {
            if (!Array.isArray(config)) {
              config = [{}]
            }
            if (!config[0]) {
              config[0] = {}
            }
            config[0].refreshToken = result.data.refreshToken
            config[0].accessToken = result.data.accessToken
            await homebridge.updatePluginConfig(config)
            await homebridge.savePluginConfig()
            loginForm && (loginForm.style.display = 'none')
            unlinkSection && (unlinkSection.style.display = 'block')
            linkSuccess && (linkSuccess.style.display = 'block')
            homebridge.toast.success('Successfully linked account', 'homebridge-firstalert')
            if (logs) {
              logs.textContent += 'Successfully linked account.\n'
            }
          } else {
            const errMsg = `Token exchange failed: ${result.data?.error_description || result.data || 'Unknown error'}`
            homebridge.toast.error(errMsg, 'Error')
            if (logs) {
              logs.textContent += `${errMsg}\n`
            }
          }
        } catch (err: any) {
          const errMsg = `Token exchange failed: ${err?.message || err}`
          homebridge.toast.error(errMsg, 'Error')
          if (logs) {
            logs.textContent += `${errMsg}\n`
          }
        } finally {
          homebridge.hideSpinner()
        }
      }
    }

    // Unlink handler
    if (unlinkButton) {
      unlinkButton.onclick = async () => {
        homebridge.showSpinner()
        try {
          delete config[0].refreshToken
          delete config[0].accessToken
          await homebridge.updatePluginConfig(config)
          await homebridge.savePluginConfig()
          unlinkSection && (unlinkSection.style.display = 'none')
          loginForm && (loginForm.style.display = 'block')
          homebridge.toast.success('Account unlinked', 'homebridge-firstalert')
        } catch (err: any) {
          homebridge.toast.error(`Unlink failed: ${err?.message || err}`, 'Error')
        } finally {
          homebridge.hideSpinner()
        }
      }
    }
  } catch (err: any) {
    homebridge.toast.error(err.message, 'Error')
  } finally {
    homebridge.hideSpinner()
  }
})()
