import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'
import { env, workerEnvVars } from '../_shared/env.ts'

console.log('main function started')

const JWT_SECRET = Deno.env.get('JWT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'

// Create JWKS for ES256/RS256 tokens (newer tokens)
let SUPABASE_JWT_KEYS: ReturnType<typeof jose.createRemoteJWKSet> | null = null
if (SUPABASE_URL) {
  try {
    SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
      new URL('/auth/v1/.well-known/jwks.json', SUPABASE_URL)
    )
  } catch (e) {
    console.error('Failed to fetch JWKS from SUPABASE_URL:', e)
  }
}

/**
 * Extract JWT token from Authorization header
 * 
 * Parses the Authorization header to extract the Bearer token.
 * Expects format: "Bearer <token>"
 * 
 * @param req - The HTTP request object
 * @returns The JWT token string
 * @throws Error if Authorization header is missing or malformed
 */
function getAuthToken(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    throw new Error('Missing authorization header')
  }
  const [bearer, token] = authHeader.split(' ')
  if (bearer !== 'Bearer') {
    throw new Error(`Auth header is not 'Bearer {token}'`)
  }
  return token
}

async function isValidLegacyJWT(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not available for HS256 token verification')
    return false
  }

  const encoder = new TextEncoder();
  const secretKey = encoder.encode(JWT_SECRET)

  try {
    await jose.jwtVerify(jwt, secretKey);
  } catch (e) {
    console.error('Symmetric Legacy JWT verification error', e);
    return false;
  }
  return true;
}

async function isValidJWT(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWT_KEYS) {
    console.error('JWKS not available for ES256/RS256 token verification')
    return false
  }

  try {
    await jose.jwtVerify(jwt, SUPABASE_JWT_KEYS)
  } catch (e) {
    console.error('Asymmetric JWT verification error', e);
    return false
  }

  return true;
}

/**
 * Verify JWT token, handling both legacy (HS256) and newer (ES256/RS256) algorithms
 * 
 * This function automatically detects the algorithm used in the token and applies
 * the appropriate verification method:
 * - HS256: Uses JWT_SECRET (symmetric key)
 * - ES256/RS256: Uses JWKS endpoint (asymmetric public keys)
 * 
 * This fix ensures compatibility with both legacy tokens and newer asymmetric tokens,
 * resolving the "Key for the ES256 algorithm must be of type CryptoKey" error.
 * 
 * @param jwt - The JWT token string to verify
 * @returns Promise resolving to true if verification succeeds, false otherwise
 */
async function isValidHybridJWT(jwt: string): Promise<boolean> {
  const { alg: jwtAlgorithm } = jose.decodeProtectedHeader(jwt)

  if (jwtAlgorithm === 'HS256') {
    console.log(`Legacy token type detected, attempting ${jwtAlgorithm} verification.`)

    return await isValidLegacyJWT(jwt)
  }

  if (jwtAlgorithm === 'ES256' || jwtAlgorithm === 'RS256') {
    return await isValidJWT(jwt)
  }

  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'OPTIONS' && VERIFY_JWT) {
    try {
      const token = getAuthToken(req)
      const isValidJWT = await isValidHybridJWT(token);

      if (!isValidJWT) {
        return new Response(JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Authentication failed' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch (e) {
      console.error(e)
      return new Response(JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Authentication failed' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const url = new URL(req.url)
  const { pathname } = url
  const path_parts = pathname.split('/')
  const service_name = path_parts[1]

  if (!service_name || service_name === '') {
    const error = { error: { code: 'FUNCTION_NAME_REQUIRED', message: 'Function name is required' } }
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const servicePath = `/home/deno/functions/${service_name}`
  console.error(`serving the request with ${servicePath}`)

  const memoryLimitMb = 150
  const workerTimeoutMs = 1 * 60 * 1000
  const noModuleCache = false
  const importMapPath = null
  // Forward only the allowlisted keys: workers must not see JWT_SECRET, the DB URL, or other router-only secrets.
  const envVars = workerEnvVars()

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      noModuleCache,
      importMapPath,
      envVars,
    })
    const workerResponse = await worker.fetch(req)
    if (service_name === 'api-v1') return workerResponse

    const legacyHeaders = new Headers(workerResponse.headers)
    legacyHeaders.set('Deprecation', 'true')
    legacyHeaders.set('Link', '</api/v1>; rel="successor-version"')
    legacyHeaders.set('Sunset', env.legacyApiSunset)
    return new Response(workerResponse.body, {
      status: workerResponse.status,
      statusText: workerResponse.statusText,
      headers: legacyHeaders,
    })
  } catch (e) {
    console.error(JSON.stringify({ type: 'legacy_function_error', outcome: 'failure', message: e instanceof Error ? e.message : 'unknown' }))
    const errorHeaders = new Headers({ 'Content-Type': 'application/json', 'Deprecation': 'true', 'Link': '</api/v1>; rel="successor-version"' })
    errorHeaders.set('Sunset', env.legacyApiSunset)
    return new Response(JSON.stringify({ error: { code: 'LEGACY_FUNCTION_ERROR', message: 'Legacy function failed' } }), {
      status: 500,
      headers: errorHeaders,
    })
  }
})
