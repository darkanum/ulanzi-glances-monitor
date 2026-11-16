(function (root) {
  const { MetricError, normalizeHost } = root.GlancesMetrics || require('./metrics.js');

  const FETCH_TIMEOUT_MS = 4000;
  const SHARE_WINDOW_MS = 1500;
  const API_VERSIONS = [4, 3];

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
  }

  class GlancesClient {
    constructor(host, username, password) {
      this.base = normalizeHost(host);
      this.headers = password ? { Authorization: basicAuth(username || 'glances', password) } : {};
      this.version = null;
      this.recent = new Map();
    }

    async request(version, endpoint) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fetch(`${this.base}/api/${version}/${endpoint}`, {
          headers: this.headers,
          signal: abort.signal,
          cache: 'no-store',
        });
      } catch (error) {
        throw new MetricError('offline');
      } finally {
        clearTimeout(timer);
      }
    }

    async load(endpoint) {
      const versions = this.version ? [this.version] : API_VERSIONS;
      const missing = new MetricError(this.version ? 'nodata' : 'notglances');
      let lastError = missing;
      for (const version of versions) {
        let response;
        try {
          response = await this.request(version, endpoint);
        } catch (error) {
          lastError = error;
          continue;
        }
        if (response.status === 401 || response.status === 403) throw new MetricError('auth');
        if (response.status === 404) {
          lastError = missing;
          continue;
        }
        if (!response.ok) throw new MetricError('offline');
        this.version = version;
        return response.json();
      }
      throw lastError;
    }

    get(endpoint) {
      const cached = this.recent.get(endpoint);
      if (cached && (cached.pending || Date.now() - cached.at < SHARE_WINDOW_MS)) return cached.promise;
      const entry = { at: Date.now(), pending: true };
      entry.promise = this.load(endpoint).finally(() => {
        entry.pending = false;
        entry.at = Date.now();
      });
      this.recent.set(endpoint, entry);
      return entry.promise;
    }
  }

  const clients = new Map();

  function clientFor(settings) {
    const id = [normalizeHost(settings.host), settings.username || '', settings.password || ''].join('\n');
    if (!clients.has(id)) clients.set(id, new GlancesClient(settings.host, settings.username, settings.password));
    return clients.get(id);
  }

  const api = { GlancesClient, clientFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GlancesApi = api;
})(this);
