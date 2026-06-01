/**
 * RFC 6238 TOTP (Time-based One-Time Password) generator.
 * Zero dependencies — uses only Node's built-in `crypto`.
 *
 * This matches what Google Authenticator, Authy, 1Password, etc. produce, and
 * what Contentstack's `/v3/user-session` accepts as `tfa_token`.
 *
 * Usage:
 *   import { totp } from './lib/totp.mjs'
 *   const code = totp('JBSWY3DPEHPK3PXP')        // → '123456' (6 digits)
 *
 * The "secret" is the base32 string from the 2FA setup screen (the
 * "Can't scan the QR code? Enter manually" text). It is NOT the rotating
 * 6-digit code — that's the OUTPUT we compute from the secret + current time.
 */

import { createHmac } from 'node:crypto'

/**
 * Decode an RFC 4648 base32 string into a Buffer of raw bytes.
 * Authenticator secrets are base32 (uppercase A-Z + 2-7), optionally with
 * spaces and padding (= signs). We strip both and accept either case.
 */
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleaned = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (cleaned.length === 0) {
    throw new Error('TOTP secret: empty after stripping non-base32 chars')
  }
  const bytes = []
  let buffer = 0
  let bits = 0
  for (const c of cleaned) {
    const idx = alphabet.indexOf(c)
    if (idx < 0) continue
    buffer = (buffer << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/**
 * Compute a TOTP for the given secret at the given moment.
 *
 * @param {string} secret  Base32 string from the 2FA setup screen.
 * @param {object} [opts]
 * @param {number} [opts.step=30]     Time step in seconds (Contentstack/GA standard).
 * @param {number} [opts.digits=6]    Output digits.
 * @param {string} [opts.alg='sha1']  HMAC algorithm. Contentstack uses sha1.
 * @param {number} [opts.t=Date.now()] Unix ms timestamp for testing.
 * @returns {string} zero-padded N-digit code, e.g. '042561'.
 */
export function totp(secret, { step = 30, digits = 6, alg = 'sha1', t = Date.now() } = {}) {
  const counter = Math.floor(t / 1000 / step)
  // 8-byte big-endian counter, per RFC 4226 §5.3
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter), 0)
  const key = base32Decode(secret)
  const hmac = createHmac(alg, key).update(counterBuf).digest()
  // Dynamic truncation, RFC 4226 §5.3
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (bin % 10 ** digits).toString().padStart(digits, '0')
}

/**
 * Returns the number of seconds remaining until the current TOTP code expires.
 * Used by the login flow to optionally pause through a rollover window so
 * we don't race the server's clock.
 */
export function secondsUntilNextStep(step = 30, t = Date.now()) {
  return step - Math.floor(t / 1000) % step
}
