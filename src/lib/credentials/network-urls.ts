/** Credential-aware Network request identity. Never persist or log raw credential values. */
export const NETWORK_CREDENTIAL_MASK = '[credential]';

const credentialKey =
  /^(?:token|accesstoken|refreshtoken|idtoken|authtoken|bearertoken|csrftoken|sessiontoken|apikey|xapikey|key|secret|clientsecret|password|passwd|pwd|authorization|auth|bearer|signature|sig|session|sessionid|jwt|credential|xamzcredential|xamzsignature|xgoogcredential|xgoogsignature)$/;

function normalizedKey(key: string): string {
  let decoded = key.replaceAll('+', ' ');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* Keep malformed key literal. */
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isCredentialQueryKey(key: string, extraKeys: readonly string[] = []): boolean {
  const normalized = normalizedKey(key);
  return (
    credentialKey.test(normalized) || extraKeys.some((extra) => normalizedKey(extra) === normalized)
  );
}

function splitUrl(raw: string): { prefix: string; query: string | null; userInfo: string } {
  const withoutFragment = raw.split('#', 1)[0] ?? '';
  const question = withoutFragment.indexOf('?');
  const beforeQuery = question < 0 ? withoutFragment : withoutFragment.slice(0, question);
  const query = question < 0 ? null : withoutFragment.slice(question + 1);
  try {
    if (!/^[a-z][\da-z+.-]*:\/\//i.test(beforeQuery))
      return { prefix: beforeQuery, query, userInfo: '' };
    const url = new URL(beforeQuery);
    return {
      prefix: `${url.protocol}//${url.host}${url.pathname}`,
      query,
      userInfo: `${url.username}:${url.password}`,
    };
  } catch {
    return {
      prefix: beforeQuery.replace(/^([a-z][\da-z+.-]*:\/\/)[^/@]*@/i, '$1'),
      query,
      userInfo: '',
    };
  }
}

function querySegments(raw: string): string[] {
  return raw ? raw.split('&') : [];
}

/** Preserve ordinary query bytes/order while masking only credential values. */
export function sanitizeNetworkUrl(raw: string, extraKeys: readonly string[] = []): string {
  const { prefix, query } = splitUrl(raw);
  if (query === null) {
    return prefix.replace(/(^|&)([^=&]+)=([^&]*)/g, (whole, lead: string, key: string) =>
      isCredentialQueryKey(key, extraKeys) ? `${lead}${key}=${NETWORK_CREDENTIAL_MASK}` : whole,
    );
  }
  const safeQuery = querySegments(query).map((segment) => {
    const equals = segment.indexOf('=');
    const key = equals < 0 ? segment : segment.slice(0, equals);
    return isCredentialQueryKey(key, extraKeys) ? `${key}=${NETWORK_CREDENTIAL_MASK}` : segment;
  });
  return `${prefix}?${safeQuery.join('&')}`;
}

export function queryKeysInNetworkUrl(raw: string): string[] {
  const { query } = splitUrl(raw);
  if (query === null) return [];
  return [
    ...new Set(
      querySegments(query)
        .map((part) => part.split('=', 1)[0] ?? '')
        .filter(Boolean),
    ),
  ];
}

/** A safe default; caller can still supply a human label. */
export function networkPatternDefaultName(raw: string, extraKeys: readonly string[] = []): string {
  const safe = sanitizeNetworkUrl(raw, extraKeys);
  try {
    const parsed = new URL(safe);
    return `Network: ${parsed.host}${parsed.pathname}`;
  } catch {
    return 'Network capture';
  }
}

/** Sink defense for existing URL-derived names and direct save callers. */
export function sanitizeNetworkPatternName(
  name: string,
  rawFilter: string,
  extraKeys: readonly string[] = [],
): string {
  const { query } = splitUrl(rawFilter);
  let safe = name.replace(/https?:\/\/[^\s]+/gi, (url) => sanitizeNetworkUrl(url, extraKeys));
  if (query !== null) {
    for (const segment of querySegments(query)) {
      const equals = segment.indexOf('=');
      if (equals < 0) continue;
      const key = segment.slice(0, equals);
      if (!isCredentialQueryKey(key, extraKeys)) continue;
      const value = segment.slice(equals + 1);
      if (value && value !== NETWORK_CREDENTIAL_MASK) {
        safe = safe.replaceAll(value, NETWORK_CREDENTIAL_MASK);
        try {
          const decoded = decodeURIComponent(value.replaceAll('+', ' '));
          if (decoded) safe = safe.replaceAll(decoded, NETWORK_CREDENTIAL_MASK);
        } catch {
          /* Raw form was already replaced. */
        }
      }
    }
  }
  safe = safe.replace(/(^|[?&\s])([^?&=\s]+)=([^&\s]*)/g, (whole, lead: string, key: string) =>
    isCredentialQueryKey(key, extraKeys) ? `${lead}${key}=${NETWORK_CREDENTIAL_MASK}` : whole,
  );
  // Legacy defaults truncated from the tail of a URL can omit the key itself.
  if (
    /^Network:/i.test(name) &&
    name.includes('…') &&
    queryKeysInNetworkUrl(rawFilter).some((key) => isCredentialQueryKey(key, extraKeys))
  ) {
    return networkPatternDefaultName(rawFilter, extraKeys);
  }
  return safe;
}

const BODY_KEY = /^(?:none|unavailable|sha256:[a-f0-9]{64})$/i;

export function safeRequestBodyKey(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === 'string' && BODY_KEY.test(raw) ? raw.toLowerCase() : 'unavailable';
}

/** One boundary shared by the UI/database save and agent observation paths. */
export function sanitizeNetworkPatternFields(
  name: string,
  config: unknown,
): {
  name: string;
  config: Record<string, unknown>;
} {
  const source =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const rawFilter = typeof source.url_filter === 'string' ? source.url_filter : '';
  const extraKeys = Array.isArray(source.credential_query_keys)
    ? source.credential_query_keys.filter((key): key is string => typeof key === 'string')
    : [];
  const bodyKey = safeRequestBodyKey(source.request_body_key);
  if (
    bodyKey === 'unavailable' &&
    source.request_body_key !== 'unavailable' &&
    source.body_match !== 'ignore'
  ) {
    throw new Error(
      'Request body identity is invalid. Capture the request again or choose URL and method only.',
    );
  }
  return {
    name: sanitizeNetworkPatternName(name, rawFilter, extraKeys),
    config: {
      url_filter: sanitizeNetworkUrl(rawFilter, extraKeys),
      credential_query_keys: extraKeys,
      ...(source.url_match === 'exact' || source.url_match === 'filter'
        ? { url_match: source.url_match }
        : {}),
      ...(source.body_match === 'exact' || source.body_match === 'ignore'
        ? { body_match: source.body_match }
        : {}),
      ...(bodyKey !== undefined && source.body_match !== 'ignore'
        ? { request_body_key: bodyKey }
        : {}),
      ...(typeof source.method === 'string' ? { method: source.method } : {}),
      ...(typeof source.key_path === 'string' ? { key_path: source.key_path } : {}),
    },
  };
}

/** Sanitize before debug logs, timeline, approval records, or receipts see tool arguments. */
export function sanitizeNetworkToolSaveArgs(toolName: string, rawArgs: unknown): unknown {
  if (
    toolName !== 'data_patterns' ||
    !rawArgs ||
    typeof rawArgs !== 'object' ||
    Array.isArray(rawArgs)
  ) {
    return rawArgs;
  }
  const args = rawArgs as Record<string, unknown>;
  if (args.action !== 'save' || args.kind !== 'network_capture') return rawArgs;
  if (Array.isArray(args.fields) && args.fields.length > 0) {
    throw new Error(
      'Network capture saves do not use CSS fields. Remove the fields and save the request recipe.',
    );
  }
  let domain: string | undefined;
  if (args.domain !== undefined) {
    if (typeof args.domain !== 'string' || /[@/?#\s]/.test(args.domain)) {
      throw new Error(
        'Network capture domain must be a hostname, without credentials, path, or query.',
      );
    }
    try {
      const parsed = new URL(`https://${args.domain}`);
      if (!parsed.hostname || parsed.pathname !== '/') throw new Error('invalid');
      domain = parsed.host;
    } catch {
      throw new Error('Network capture domain must be a valid hostname.');
    }
  }
  const safe = sanitizeNetworkPatternFields(
    typeof args.name === 'string' ? args.name : '',
    args.config,
  );
  return {
    action: 'save',
    kind: 'network_capture',
    name: safe.name,
    config: safe.config,
    ...(domain !== undefined && { domain }),
    ...(Array.isArray(args.fields) && { fields: [] }),
  };
}

/** Chat activity is observational: an invalid recipe still gets a safe, honest row. */
export function networkToolArgsForObservation(toolName: string, rawArgs: unknown): unknown {
  if (
    toolName !== 'data_patterns' ||
    !rawArgs ||
    typeof rawArgs !== 'object' ||
    Array.isArray(rawArgs)
  ) {
    return rawArgs;
  }
  const args = rawArgs as Record<string, unknown>;
  if (args.action !== 'save' || args.kind !== 'network_capture') return rawArgs;
  try {
    return sanitizeNetworkToolSaveArgs(toolName, rawArgs);
  } catch {
    return {
      action: 'save',
      kind: 'network_capture',
      name: 'Network capture — invalid request recipe; review before saving',
    };
  }
}

/** Non-reversible, run-local discriminator; never persisted or shown. */
export function transientCredentialFingerprint(
  raw: string,
  extraKeys: readonly string[] = [],
): string {
  const { query, userInfo } = splitUrl(raw);
  const parts = userInfo !== ':' ? [userInfo] : [];
  if (query !== null) {
    for (const segment of querySegments(query)) {
      const equals = segment.indexOf('=');
      const key = equals < 0 ? segment : segment.slice(0, equals);
      if (isCredentialQueryKey(key, extraKeys)) parts.push(segment);
    }
  }
  // Two independent 64-bit FNV streams reduce accidental in-window collisions.
  let a = 0xcbf29ce484222325n;
  let b = 0x84222325cbf29ce4n;
  for (const byte of new TextEncoder().encode(parts.join('\u0000'))) {
    a = BigInt.asUintN(64, (a ^ BigInt(byte)) * 0x100000001b3n);
    b = BigInt.asUintN(64, (b ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `${a.toString(16).padStart(16, '0')}${b.toString(16).padStart(16, '0')}`;
}
