/**
 * Ursachenanalyse für fehlgeschlagene Workflows (angefordert aus der Mobile-App).
 *
 * Verbindet:
 * 1. Fehlgeschlagenen Node + geschwärzte Fehlermeldung
 * 2. Strukturellen Diff zwischen der aktuellen/auffälligen Version und der letzten stabilen Version
 * 3. Optional Melious-KI (mit demselben Secret-Filter `redact()` wie server/ai.ts) –
 *    und fällt ohne eingerichtete KI automatisch auf eine deterministische Diff- & Fehler-Korrelation zurück.
 */
import { db } from './db.ts';
import { getAiConfig } from './ai.ts';
import { safeFetch } from './net.ts';
import { loadSnapshot } from './sync.ts';
import { diffWorkflows, type Snapshot, type WfNode, type WorkflowDiff } from '../shared/diff.ts';
import { isLocale, type LocaleCode } from '../shared/i18n/index.ts';
import { serverLocale } from '../shared/i18n/server.ts';
import { isSecretName, redact, redactText } from '../shared/redact.ts';
import type { DiagnosisResult } from '../shared/notify.ts';

interface VersionRow {
  id: number;
  workflow_id: number;
  number: number;
}

const shortRedacted = (v: unknown, max = 350) => {
  const s = JSON.stringify(redact(v));
  if (!s) return 'empty';
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

function getField(node: WfNode | undefined, path: string): unknown {
  if (isSecretName(path.split('.').at(-1) ?? '')) return '[redacted]';
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), node);
}

function classifyErrorPattern(errorMessage: string | null, lang: LocaleCode): { cause: string; fix: string } | null {
  if (!errorMessage) return null;
  const m = errorMessage.toLowerCase();
  const en = lang === 'en';
  if (/\b401\b|unauthorized|invalid api[-_ ]?key|authentication failed/.test(m)) {
    return en
      ? {
          cause: 'Authentication failed (HTTP 401 / invalid credentials). The target service rejected the API key, token, or credential.',
          fix: 'Verify the assigned credential in n8n and check whether the token expired or was rotated.',
        }
      : {
          cause: 'Authentifizierung fehlgeschlagen (HTTP 401 / ungültige Zugangsdaten). Der Zieldienst lehnt API-Key, Token oder Credential ab.',
          fix: 'Zugewiesenes Credential in n8n prüfen und kontrollieren, ob Schlüssel/Token abgelaufen oder rotiert sind.',
        };
  }
  if (/\b403\b|forbidden|insufficient permission|access denied/.test(m)) {
    return en
      ? {
          cause: 'Access denied (HTTP 403). The credential is valid, but lacks permissions for this endpoint or resource.',
          fix: 'Check scopes/permissions of the API key or whether the target resource ID changed.',
        }
      : {
          cause: 'Zugriff verweigert (HTTP 403). Die Anmeldung klappt, aber dem Schlüssel fehlen Rechte für diesen Endpunkt.',
          fix: 'Berechtigungen/Scopes des Credentials oder eine geänderte Ziel-Ressourcen-ID prüfen.',
        };
  }
  if (/\b404\b|not found/.test(m)) {
    return en
      ? {
          cause: 'Target endpoint or resource was not found (HTTP 404). Often caused by a changed URL, path, or missing ID.',
          fix: 'Check the URL/endpoint expression and verify that referenced IDs exist in the target system.',
        }
      : {
          cause: 'Endpunkt oder Ressource wurde nicht gefunden (HTTP 404) – häufig durch eine geänderte URL oder fehlende ID.',
          fix: 'URL-/Pfad-Parameter und dynamische Expressions im betroffenen Node prüfen.',
        };
  }
  if (/\b429\b|rate limit|too many requests/.test(m)) {
    return en
      ? {
          cause: 'Rate limit exceeded (HTTP 429). The external API is throttling requests.',
          fix: 'Reduce concurrency, add batching/wait intervals, or enable retry on fail in the node settings.',
        }
      : {
          cause: 'Rate-Limit erreicht (HTTP 429). Die externe Schnittstelle drosselt zu viele parallele oder schnelle Aufrufe.',
          fix: 'Batch-Größe senken, Wartezeit einbauen oder „Retry On Fail“ am Node aktivieren.',
        };
  }
  if (/etimedout|econnrefused|enotfound|socket hang up|timeout/.test(m)) {
    return en
      ? {
          cause: 'Network or timeout error while contacting the external service.',
          fix: 'Check whether the target host is reachable, review DNS/URL changes, or increase the node timeout.',
        }
      : {
          cause: 'Netzwerk- oder Timeout-Fehler beim Verbindungsaufbau zum Zielsystem.',
          fix: 'Erreichbarkeit des Ziel-Hosts und eventuelle URL-/Timeout-Änderungen prüfen.',
        };
  }
  if (/cannot read propert|undefined|null|syntaxerror|json/.test(m)) {
    return en
      ? {
          cause: 'Data structure or expression error: an expected input field is missing, null, or not valid JSON.',
          fix: 'Check expressions in the failing node and whether an upstream node changed its output fields.',
        }
      : {
          cause: 'Datenstruktur- oder Expression-Fehler: Ein erwartetes Feld im Input fehlt, ist leer oder kein gültiges JSON.',
          fix: 'Expressions im scheiternden Node und Änderungen an vorgelagerten Nodes prüfen.',
        };
  }
  return null;
}

function buildDeterministicDiagnosis(opts: {
  wfName: string;
  currentVer: VersionRow;
  baseVer: VersionRow | null;
  diff: WorkflowDiff | null;
  errorNode: string | null;
  errorMessage: string | null;
  lang: LocaleCode;
}): DiagnosisResult {
  const { currentVer, baseVer, diff, errorNode, errorMessage, lang } = opts;
  const en = lang === 'en';
  const pattern = classifyErrorPattern(errorMessage, lang);

  let culpritChange: string | null = null;
  let nodeTouched = false;

  if (diff && baseVer) {
    const direct = errorNode
      ? diff.nodes.find((n) => (n.after?.name === errorNode || n.before?.name === errorNode) && n.status !== 'unchanged')
      : undefined;
    if (direct) {
      nodeTouched = true;
      const fields = direct.fields.slice(0, 5).join(', ');
      culpritChange =
        direct.status === 'added'
          ? en
            ? `Node “${errorNode}” was newly added in v${currentVer.number} (compared to v${baseVer.number}).`
            : `Node „${errorNode}“ wurde in v${currentVer.number} (gegenüber v${baseVer.number}) neu hinzugefügt.`
          : en
            ? `Node “${errorNode}” was modified in v${currentVer.number} vs. v${baseVer.number}${fields ? ` (${fields})` : ''}.`
            : `Node „${errorNode}“ wurde in v${currentVer.number} gegenüber v${baseVer.number} geändert${fields ? ` (${fields})` : ''}.`;
    } else if (diff.summary.modified.length || diff.summary.added.length || diff.summary.removed.length) {
      nodeTouched = true;
      const touched = [...diff.summary.modified, ...diff.summary.added].slice(0, 4).join(', ');
      culpritChange = en
        ? `Between v${baseVer.number} and v${currentVer.number}, ${touched || 'workflow connections/settings'} changed before the failure occurred.`
        : `Zwischen v${baseVer.number} und v${currentVer.number} wurden ${touched || 'Verbindungen/Einstellungen'} geändert.`;
    }
  }

  const headline = errorNode
    ? en
      ? `Failure at node “${errorNode}”${baseVer && nodeTouched ? ` after changes in v${currentVer.number}` : ''}`
      : `Fehler am Node „${errorNode}“${baseVer && nodeTouched ? ` nach Änderung in v${currentVer.number}` : ''}`
    : en
      ? `Workflow failure in v${currentVer.number}`
      : `Workflow-Fehler in Version v${currentVer.number}`;

  const cause =
    pattern?.cause ??
    (errorMessage
      ? en
        ? `Node ${errorNode ? `“${errorNode}” ` : ''}aborted with: ${errorMessage}`
        : `Node ${errorNode ? `„${errorNode}“ ` : ''}brach mit folgender Meldung ab: ${errorMessage}`
      : en
        ? 'Execution failed without a detailed error message from n8n.'
        : 'Die Ausführung ist ohne detaillierte Fehlermeldung aus n8n fehlgeschlagen.');

  const suggestedFix: string[] = [];
  if (pattern?.fix) suggestedFix.push(pattern.fix);
  if (culpritChange && baseVer) {
    suggestedFix.push(
      en
        ? `Review the diff between v${baseVer.number} and v${currentVer.number} or roll back directly to v${baseVer.number}.`
        : `Änderungen zwischen v${baseVer.number} und v${currentVer.number} prüfen oder direkt auf die stabile Version v${baseVer.number} zurückspielen.`,
    );
  } else {
    suggestedFix.push(
      en
        ? 'Inspect the last failed execution in n8n to verify input data and external service status.'
        : 'Letzten Fehllauf in n8n prüfen, um Eingabedaten und den Status externer Dienste zu kontrollieren.',
    );
  }

  const recommendRollback = !!baseVer && nodeTouched;
  return {
    source: 'diff',
    headline,
    cause,
    culpritChange,
    suggestedFix,
    recommendRollback,
    rollbackVersionId: baseVer?.id ?? null,
    rollbackVersionNumber: baseVer?.number ?? null,
    analyzedVersionNumber: currentVer.number,
    comparedVersionNumber: baseVer?.number ?? null,
    generatedAt: Date.now(),
  };
}

async function askMeliousForDiagnosis(opts: {
  wfName: string;
  currentVer: VersionRow;
  baseVer: VersionRow | null;
  currentSnap: Snapshot;
  diff: WorkflowDiff | null;
  errorNode: string | null;
  errorMessage: string | null;
  lang: LocaleCode;
  fallback: DiagnosisResult;
}): Promise<DiagnosisResult> {
  const cfg = getAiConfig();
  if (!cfg.enabled || !cfg.apiKey) return opts.fallback;

  const langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(opts.lang) ?? opts.lang;
  const lines: string[] = [
    `Workflow: "${redactText(opts.wfName, 120) ?? opts.wfName}" (v${opts.currentVer.number})`,
    `Failing node: ${opts.errorNode ? `"${redactText(opts.errorNode, 120)}"` : 'unknown'}`,
    `Error message: ${redactText(opts.errorMessage, 300) ?? 'none'}`,
  ];

  if (opts.errorNode) {
    const failingWfNode = opts.currentSnap.nodes.find((n) => n.name === opts.errorNode);
    if (failingWfNode) {
      lines.push(
        `Failing node config (${failingWfNode.type.split('.').pop()}): parameters=${shortRedacted(failingWfNode.parameters, 400)}, hasCredentials=${!!failingWfNode.credentials}`,
      );
    }
  }

  if (opts.diff && opts.baseVer) {
    lines.push('', `Diff from stable v${opts.baseVer.number} to v${opts.currentVer.number}:`);
    for (const c of opts.diff.nodes.filter((n) => n.status !== 'unchanged').slice(0, 15)) {
      if (c.status === 'added') lines.push(`- Added node "${c.after!.name}": ${shortRedacted(c.after!.parameters, 250)}`);
      if (c.status === 'removed') lines.push(`- Removed node "${c.before!.name}"`);
      if (c.status === 'modified') {
        lines.push(`- Modified node "${c.after!.name}":`);
        for (const f of c.fields.slice(0, 8)) {
          lines.push(`    ${f}: ${shortRedacted(getField(c.before, f), 200)} -> ${shortRedacted(getField(c.after, f), 200)}`);
        }
      }
    }
  }

  const sys = `You diagnose failed n8n workflow runs for an operator on mobile.
Reply with JSON only:
{
  "headline": string (in ${langName}, <= 80 chars, concise root cause),
  "cause": string (in ${langName}, 1-3 short sentences explaining why it fails),
  "culpritChange": string | null (in ${langName}, which change in the diff likely caused it, or null if unrelated/external),
  "suggestedFix": string[] (in ${langName}, 1-3 concrete, short action steps),
  "recommendRollback": boolean (true only if rolling back to the previous version would likely fix the issue)
}
State only facts supported by the error and diff. No markdown fences, no emojis.`;

  try {
    const res = await safeFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.15,
        max_tokens: 550,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: lines.join('\n').slice(0, 10_000) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return opts.fallback;
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const raw = (data.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as Record<string, unknown>;
    const headline = String(parsed.headline ?? '').trim().slice(0, 140);
    const cause = String(parsed.cause ?? '').trim().slice(0, 600);
    if (!headline || !cause) return opts.fallback;
    const culpritChange = typeof parsed.culpritChange === 'string' && parsed.culpritChange.trim()
      ? parsed.culpritChange.trim().slice(0, 350)
      : opts.fallback.culpritChange;
    const suggestedFix = Array.isArray(parsed.suggestedFix)
      ? parsed.suggestedFix.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
      : opts.fallback.suggestedFix;
    return {
      source: 'ai',
      headline,
      cause,
      culpritChange,
      suggestedFix: suggestedFix.length ? suggestedFix : opts.fallback.suggestedFix,
      recommendRollback: typeof parsed.recommendRollback === 'boolean' ? parsed.recommendRollback && !!opts.baseVer : opts.fallback.recommendRollback,
      rollbackVersionId: opts.baseVer?.id ?? null,
      rollbackVersionNumber: opts.baseVer?.number ?? null,
      analyzedVersionNumber: opts.currentVer.number,
      comparedVersionNumber: opts.baseVer?.number ?? null,
      generatedAt: Date.now(),
    };
  } catch {
    return opts.fallback;
  }
}

export async function diagnoseWorkflowFailure(input: {
  workflowId: number;
  versionId?: number | null;
  rollbackVersionId?: number | null;
  errorNode?: string | null;
  errorMessage?: string | null;
  language?: string;
}): Promise<{ instanceId: number; diagnosis: DiagnosisResult } | null> {
  const wf = db
    .prepare('SELECT id, instance_id, name FROM workflows WHERE id = ?')
    .get(input.workflowId) as { id: number; instance_id: number; name: string } | undefined;
  if (!wf) return null;

  const currentVer = (input.versionId
    ? db.prepare('SELECT id, workflow_id, number FROM versions WHERE id = ? AND workflow_id = ?').get(input.versionId, wf.id)
    : db.prepare('SELECT id, workflow_id, number FROM versions WHERE workflow_id = ? ORDER BY number DESC LIMIT 1').get(wf.id)) as VersionRow | undefined;
  if (!currentVer) return null;

  const baseVer = (input.rollbackVersionId
    ? db.prepare('SELECT id, workflow_id, number FROM versions WHERE id = ? AND workflow_id = ?').get(input.rollbackVersionId, wf.id)
    : db.prepare('SELECT id, workflow_id, number FROM versions WHERE workflow_id = ? AND number < ? ORDER BY number DESC LIMIT 1').get(wf.id, currentVer.number)) as
    | VersionRow
    | undefined;

  const currentSnap = loadSnapshot(currentVer.id);
  if (!currentSnap) return null;
  const baseSnap = baseVer ? loadSnapshot(baseVer.id) ?? null : null;
  const diff = baseSnap ? diffWorkflows(baseSnap, currentSnap) : null;

  const lang: LocaleCode = isLocale(input.language) ? input.language : serverLocale;
  const cleanNode = redactText(input.errorNode ?? null, 120);
  const cleanMsg = redactText(input.errorMessage ?? null, 300);

  const fallback = buildDeterministicDiagnosis({
    wfName: wf.name,
    currentVer,
    baseVer: baseVer ?? null,
    diff,
    errorNode: cleanNode,
    errorMessage: cleanMsg,
    lang,
  });

  const diagnosis = await askMeliousForDiagnosis({
    wfName: wf.name,
    currentVer,
    baseVer: baseVer ?? null,
    currentSnap,
    diff,
    errorNode: cleanNode,
    errorMessage: cleanMsg,
    lang,
    fallback,
  });

  return { instanceId: wf.instance_id, diagnosis };
}
