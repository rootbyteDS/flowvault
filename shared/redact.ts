/**
 * Schwärzung von Zugangsdaten – geteilt zwischen KI-Änderungstexten (server/ai.ts) und dem
 * MCP-Dienst (services/mcp). Ohne Abhängigkeiten, damit jeder Dienst sie einbinden kann.
 *
 * - `redact` für strukturierte Daten (Workflow-JSON): Feldnamen zählen mit.
 * - `redactText` für Freitext aus n8n (Fehlermeldungen, Namen), bevor er einen Agent erreicht.
 */

const SECRET_KEY = /pass(word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|authorization|x[-_]auth|bearer|private[-_]?key|cookie|session|signature/i;
/** Letzter Namensteil, der einen Schlüssel bezeichnet: „X-Custom-Auth“, „key“, „clientKey“, „hmacSig“. */
const SECRET_LAST_PART = new Set(['key', 'auth', 'sig', 'pwd', 'pw', 'pin', 'otp', 'jwt', 'hmac', 'passcode']);

/** Feld-, Header- oder Parametername, dessen Wert vermutlich ein Zugangsdatum ist. */
export function isSecretName(name: string): boolean {
  if (SECRET_KEY.test(name)) return true;
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return SECRET_LAST_PART.has(parts.at(-1) ?? '');
}

/** Zugangsdaten in URLs: Benutzer und Passwort vor dem Host sowie Webhook-Adressen, die selbst das Geheimnis sind. */
const SECRET_URLS: [RegExp, string][] = [
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#"'`<>]+@/gi, '$1[redacted]@'],
  [/\b(hooks\.slack\.com\/)[^\s"'`<>?#]+/gi, '$1[redacted]'],
  [/\b(discord(?:app)?\.com\/api\/webhooks\/)[^\s"'`<>?#]+/gi, '$1[redacted]'],
  [/\b(api\.telegram\.org\/(?:file\/)?)bot[^\s/"'`<>?#]+/gi, '$1[redacted]'],
];

/** Typische Key-Formate – werden auch mitten in Code, URLs und Freitext ersetzt. */
const SECRET_VALUES: RegExp[] = [
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, // Telegram-Bot-Token
  /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g, // OpenAI, Stripe (sk_live_…), Anthropic …
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API Key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
/** Zuweisungen in Code & Query-Strings: password = "…", "token": "…", ?api_key=…, &key=… */
const SECRET_ASSIGN =
  /((?:pass(?:word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|auth|signature)["']?\s*[:=]\s*["'`]?|[?&](?:key|sig|code)=)([^\s"'`&,;)}]{4,})/gi;

/**
 * Lange Zeichenfolge, die wie ein zufällig erzeugter Schlüssel aussieht – nicht wie Wort, Pfad oder Bezeichner.
 * Fängt Schlüssel ohne bekanntes Format, z. B. als Konstante in einem Code-Node.
 */
export function looksRandom(text: string): boolean {
  // „n8n“ steckt in vielen Paket- und Node-Namen und sähe sonst wie Zufall aus
  const core = text.replace(/[+/=_-]/g, '').replace(/n8n/gi, '');
  const digits = core.replace(/\D/g, '').length;
  const letters = core.length - digits;
  if (core.length < 20 || !digits || !letters) return false;
  // Hashes, Hex-Schlüssel und UUIDs, auch mit kurzem Präfix wie „pat-na1-…“
  if (core.length >= 24 && core.replace(/[^0-9a-f]/gi, '').length / core.length >= 0.9) return true;
  const vowels = core.replace(/[^aeiou]/gi, '').length;
  const isDigit = (c: string) => c >= '0' && c <= '9';
  let switches = 0;
  for (let i = 1; i < core.length; i++) if (isDigit(core[i]!) !== isDigit(core[i - 1]!)) switches++;
  // Wörter und Bezeichner haben viele Vokale und wechseln selten zwischen Ziffern und Buchstaben
  return vowels / letters < 0.3 || switches / (core.length - 1) >= 0.2;
}

/** Zeichenfolgen aus Base64-/Hex-Zeichen ab 20 Zeichen; Pfadteile werden zusätzlich einzeln geprüft. */
const RANDOM_RUN = /[A-Za-z0-9+/=_-]{20,}/g;

function redactString(s: string) {
  for (const [re, replacement] of SECRET_URLS) s = s.replace(re, replacement);
  for (const re of SECRET_VALUES) s = s.replace(re, '[redacted]');
  s = s.replace(SECRET_ASSIGN, '$1[redacted]');
  return s.replace(RANDOM_RUN, (run) => (looksRandom(run) || run.split('/').some(looksRandom) ? '[redacted]' : run));
}

/** Entfernt Werte, die wie Zugangsdaten aussehen, bevor etwas das Haus verlässt. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 12) return '…';
  if (typeof v === 'string') {
    const s = redactString(v);
    return s.length > 600 ? s.slice(0, 600) + '…' : s;
  }
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // n8n speichert Header/Query-Parameter als { name, value } – dann zählt der Name
    const secretPair = typeof o.name === 'string' && isSecretName(o.name);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = isSecretName(k) || (secretPair && k === 'value') ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return v;
}

const NAMES = 'pass(?:word|wd|phrase)?|secret|token|api[ _-]?key|access[ _-]?key|authorization|credential|signature';
/** Name, Trenner, Wert: „API key: abc“, „"password":"my secret phrase"“. */
const NAMED = new RegExp(`((?:${NAMES})\\w*["']?\\s*[:=]\\s*)(?!\\[redacted\\])("[^"]*"|'[^']*'|[^\\s"',;&)}\\]]+)`, 'gi');
/** Name, höchstens zwei Wörter, Wert in Anführungszeichen: „API key 'abc' is invalid“. */
const QUOTED = new RegExp(`((?:${NAMES})\\w*(?:\\s+[\\w-]+){0,2}:?\\s+)("[^"]*"|'[^']*')`, 'gi');
/** Query-String und Fragment einer URL – dort stehen von Hand eingetragene Schlüssel am häufigsten. */
const QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/gi;
const EMAIL = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

/**
 * Schwärzt Freitext aus n8n, bevor er einen Agent erreicht. Nur im MCP-Dienst benutzt: Gespeichert
 * und in der Oberfläche angezeigt wird ungeschwärzt.
 * Strenger als `redact`: Im Freitext hilft kein Feldname, also lieber zu viel schwärzen. Kürzt außerdem
 * E-Mail-Adressen, macht den Text einzeilig und begrenzt ihn auf `max` Zeichen.
 */
export function redactText(text: string | null | undefined, max = 300): string | null {
  if (!text) return null;
  let s = text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ') // einzeilig, keine Steuerzeichen
    .replace(/\\+(["'])/g, '$1') // \" aus eingebettetem JSON
    .replace(QUERY, '$1?[redacted]');
  s = String(redact(s)); // bekannte Key-Formate, Bearer/Basic, Zugangsdaten in URLs, zufällig wirkende Zeichenfolgen
  s = s
    .replace(NAMED, (m, head: string, value: string) => (/^\d{1,5}$/.test(value) ? m : `${head}[redacted]`))
    .replace(QUOTED, '$1[redacted]')
    .replace(EMAIL, '$1***@$2');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
