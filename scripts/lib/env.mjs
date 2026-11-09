// Shared environment readers for release and extension scripts. An empty
// string counts as unset, matching the API and edge-function config modules.

/** The value of `name`, or `fallback` when it is unset or empty. */
export function optionalEnv(name, fallback = undefined, env = process.env) {
  const value = env[name]
  return value === undefined || value === '' ? fallback : value
}

/** The value of `name`; throws a message naming the variable when it is unset or empty. */
export function requireEnv(name, env = process.env) {
  const value = optionalEnv(name, undefined, env)
  if (value === undefined) throw new Error(`Missing required environment variable ${name}`)
  return value
}
