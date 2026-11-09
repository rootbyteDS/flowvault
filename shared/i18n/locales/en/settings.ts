import type { Messages } from '../../types.ts';

export const settings: Messages['settings'] = {
  title: 'Settings',
  language: {
    title: 'Language',
    text: 'Language of the interface. The choice applies to this browser only. You set the language of the AI change texts under “AI change texts”.',
  },
  health: {
    title: 'Failure rate per version',
    titleTip:
      'For every saved version, FlowVault counts how many executions in n8n failed afterwards.\n\nThat way you see right in the version history <b>which change broke something</b>, which node fails, and which version you can go back to.',
    noResponse: 'Not responding',
    on: 'On',
    off: 'Off',
    intro:
      'Shows for each version how often the workflow failed in n8n afterwards, and warns when a change broke something. A Git repository cannot do that: it only knows the code, not how it runs in production.',
    unavailable:
      'The execution analysis is not responding right now. FlowVault restarts it automatically – try again in a few seconds. If it stays that way, the reason is in the server log. Versions, comparing and restoring keep working.',
    perInstance: 'Fetch per instance',
    perInstanceTip:
      'For each connected n8n instance: when FlowVault last fetched executions and how many are stored.\n\n<b>Green dot</b>: the last fetch worked. <b>Red dot</b>: it failed, the reason is shown below. The next fetch retries automatically.',
    nothingPolled: 'Nothing fetched yet. As soon as an instance is connected, the first fetch starts by itself.',
    pollingOff: 'Fetching is switched off.',
    stored: {
      one: '<n>{formatted}</n> execution stored · fetched {when}',
      other: '<n>{formatted}</n> executions stored · fetched {when}',
    },
    firstPoll: 'First fetch in progress',
    whenToWarn: 'When to warn?',
    example: {
      one: 'Example with these values: if a workflow previously had {example} % errors, FlowVault warns from {threshold} % once the new version has had at least {count} run.',
      other: 'Example with these values: if a workflow previously had {example} % errors, FlowVault warns from {threshold} % once the new version has had at least {count} runs.',
    },
    alerts: 'Warn and suggest a rollback',
    alertsHint: 'On the overview and on the workflow. Nothing is ever rolled back automatically, only when you click.',
    alertsTip:
      'The warning appears on the overview and at the top of the workflow page, together with the last version that ran stably.\n\nIt disappears on its own when you roll back or a newer version runs normally again. If you dismiss it, it does not come back for the same version, but it does for a later one.\n\nOff: the failure rate is still shown and conspicuous versions are marked red, just without a warning.',
    threshold: 'Increase of (percentage points)',
    thresholdHint: 'Smaller = more sensitive, more warnings',
    thresholdTip:
      '<b>Percentage points, not percent</b>: going from 5 % to 25 % errors is 20 percentage points.\n\nThe failure rate of the new version is compared with that of the versions before it. If it is at least this much higher, the version counts as conspicuous.\n\nA good start: 20. For workflows that must never fail, more like 5 to 10.',
    minRuns: 'Minimum runs',
    minRunsHint: 'A few runs are chance. Below this, values are shown but not judged.',
    minRunsTip:
      'With 2 runs and one error that would already be 50 %. That is why FlowVault only judges a version once it has this many completed runs. The same limit applies to the versions before it.\n\nRare workflows, e.g. once a day, take correspondingly many days until they are judged. A smaller value is worthwhile there.',
    manual: 'Count test runs from the editor',
    manualHint: 'Usually off: while building, test runs often fail on purpose.',
    manualTip:
      '<b>Test runs</b> are what you start in the n8n editor with “Execute workflow” or “Test step”.\n\n<b>Production runs</b> come from triggers, webhooks, schedules or other workflows. Only those tell you whether the workflow works in production.',
    storage: 'Fetching and storage',
    storageText:
      'Only status, time and – for errors – node name and message are stored, in <code>data/health.db</code>. Input and output data never. The instance’s API key needs read access to executions.',
    enabled: 'Fetch executions regularly',
    enabledHint: 'Off: no new data, existing data stays visible.',
    enabledTip:
      'Switches the whole feature: when on, FlowVault regularly asks every instance for new executions.\n\nOff: no new ones are fetched and no new warnings are created. Executions already stored stay until you switch it on again.',
    pollMinutes: 'Every (minutes)',
    pollMinutesHint: 'Shorter = warnings come sooner',
    pollMinutesTip:
      'How often FlowVault fetches new executions. A warning can come at the earliest with the next fetch.\n\nShorter intervals create slightly more requests to n8n, but that is no problem for most instances. 5 minutes usually fits.',
    lookback: 'Look back (days)',
    lookbackHint: 'On the first fetch. n8n often deletes old runs itself.',
    lookbackTip:
      'How far back FlowVault fetches executions, mainly on the first fetch of a new instance.\n\nWhat n8n has already deleted can no longer be fetched. By default n8n cleans up after 14 days (execution pruning).',
    retention: 'Keep (days)',
    retentionHint: 'FlowVault deletes them afterwards',
    retentionTip:
      'How long FlowVault keeps executions in its own database, even if n8n deleted them long ago.\n\nOlder ones drop out, so the failure rate of very old versions disappears as well. The value is at least as large as the look-back.',
    pollNow: 'Fetch now',
    pollNowTitle: 'Fetches new executions of all instances right away and analyses them',
    discard: 'Discard changes',
    saved: 'Saved. Applies from the next analysis.',
    polled: 'Executions fetched and analysed',
  },
  ai: {
    title: 'AI change texts with Melious',
    active: 'On · <m>{model}</m>',
    off: 'Off',
    intro:
      'Melious writes a short change text for every new version. The models run on EU infrastructure, and Melious does not train on your data. Only the changed nodes and parameters are sent. Only if you request a text for a first version yourself does the whole workflow go out. FlowVault removes values of fields such as password, token or apiKey, as well as typical key formats (Bearer, JWT, sk_…, ghp_…), beforehand. That is a heuristic – credentials hard-coded in code belong in n8n credentials.',
    apiKey: 'API key',
    keyKept: 'Saved ({hint}). Leave empty to keep it.',
    keyHint: 'Create one at <a>melious.ai</a>. It is stored encrypted.',
    model: 'Model',
    modelsLoaded: { one: '{count} model loaded', other: '{count} models loaded' },
    modelsLoadHint: 'Use “Test connection” to load the available models',
    baseUrl: 'API address',
    baseUrlHint: 'Default: https://api.melious.ai/v1. If you enter a new address, the API key must be entered again.',
    language: 'Language of the texts',
    languageHint: 'The AI writes the change texts in this language. Texts that were already generated stay unchanged.',
    use: 'Use AI texts',
    useHint: 'Switches the integration on or off as a whole',
    auto: 'Automatically for new versions',
    autoHint: 'Otherwise only on demand in the version view',
    test: 'Test connection',
    changeUrl: 'Change API address',
    connected: { one: 'Connected, {count} model available', other: 'Connected, {count} models available' },
    saved: 'AI settings saved',
    queued: { one: '{count} version queued', other: '{count} versions queued' },
    pending: { one: '<n>{count}</n> text is being generated', other: '<n>{count}</n> texts are being generated' },
    missing: {
      one: '<n>{count}</n> existing version has no AI text yet',
      other: '<n>{count}</n> existing versions have no AI text yet',
    },
    backfill: 'Catch up',
  },
  how: {
    title: 'How FlowVault works',
    pull: 'For each instance, all workflows are fetched through the n8n public API.',
    versions:
      'A new version is only created when content, name, status, tags or settings change – pure runtime data (staticData) is ignored.',
    deleted: 'Workflows deleted in n8n are kept with their complete history.',
    keys:
      'API keys are stored encrypted with AES-256-GCM. Be sure to back up the key as well (<code>data/secret.key</code> or <code>APP_SECRET</code>).',
    health:
      'For the failure rate per version, FlowVault stores only status, time and – for errors – node and message of each execution (<code>data/health.db</code>).',
    ai: 'AI texts (optional) are generated by Melious. Without an API key, no workflow content leaves FlowVault.',
    data: 'All data lives in <code>data/flowvault.db</code> (SQLite).',
  },
};
