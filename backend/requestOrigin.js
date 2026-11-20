const localHosts = new Set(['localhost','127.0.0.1','[::1]']);

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function isAllowedRequestOrigin(origin,configuredOrigin,environment={}) {
  const actual = normalizeOrigin(origin);
  const configured = normalizeOrigin(configuredOrigin);
  if (!actual || !configured) return false;
  if (actual === configured) return true;
  if (environment.NODE_ENV === 'production') return false;
  const request = new URL(actual);
  const allowed = new URL(configured);
  const isViteFallbackPort = allowed.port === '5173' && request.port === '5174';
  // Vite may move from its default 5173 port when another dev server is running.
  return request.protocol === 'http:' && allowed.protocol === 'http:' &&
    localHosts.has(request.hostname) && localHosts.has(allowed.hostname) &&
    (request.port === allowed.port || isViteFallbackPort);
}

function authenticatedCorsOptions(environment) {
  if (!normalizeOrigin(environment.APP_ORIGIN)) throw new Error('Set APP_ORIGIN to the frontend origin, such as http://localhost:5173.');
  return {
    credentials:true,
    origin(origin,done) {
      done(null,isAllowedRequestOrigin(origin,environment.APP_ORIGIN,environment) ? origin : false);
    },
  };
}

module.exports = {normalizeOrigin,isAllowedRequestOrigin,authenticatedCorsOptions};
