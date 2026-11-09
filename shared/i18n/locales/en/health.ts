import type { Messages } from '../../types.ts';

export const health: Messages['health'] = {
  runs: { one: '{count} run', other: '{count} runs' },
  range: { single: 'v{to}', span: 'v{from} to v{to}' },
  pollError: {
    unauthorized: 'n8n rejects the API key',
    unauthorizedFix: 'Enter a valid API key for the instance.',
    forbidden: 'The API key is not allowed to read executions',
    forbiddenFix: 'In n8n, create a key under Settings → n8n API with read access to executions and enter it for the instance.',
    unreachable: 'The n8n instance is not reachable',
    unreachableFix: 'Is n8n running and is the URL correct? The next fetch retries automatically.',
  },
  steps: {
    fetch: 'Fetch executions',
    fetchText:
      'Every {minutes} min, FlowVault asks n8n for new executions. Only status, time and – for errors – the node with its message are stored. Input and output data never.',
    assign: 'Assign to the version',
    assignText:
      'Each execution counts for the version that was saved in n8n at that time. That way every version has its own failure rate.',
    compare: 'Compare with before',
    compareOn:
      'If a new version has at least {runs} and its failure rate is {threshold} percentage points or more above the versions before it, FlowVault warns and suggests the last stable version. Nothing is rolled back unless you click.',
    compareOff:
      'If a new version has at least {runs} and its failure rate is {threshold} percentage points or more above the versions before it, it is marked. Warnings are currently off. Nothing is rolled back unless you click.',
  },
  explainer: {
    label: 'How is this calculated?',
    rateWithManual:
      '<h>Failure rate</h> = failed runs ÷ completed runs of this version. Canceled and still running executions do not count.',
    rateWithoutManual:
      '<h>Failure rate</h> = failed runs ÷ completed runs of this version, without test runs from the editor. Canceled and still running executions do not count.',
    compare:
      '<h>Comparison</h>: the up to five versions before it, combined, until at least {runs} are together. A warning comes from an increase of {threshold} percentage points, e.g. from {from} % to {to} %.',
    assign:
      '<h>Assignment</h>: by the time of saving in n8n. If you save several times between two backups, the runs in between count for the previous saved version.',
    unattributed: {
      one: '{count} run happened before the first backup and belongs to no version.',
      other: '{count} runs happened before the first backup and belong to no version.',
    },
    lastPoll: 'Last fetched {when}.',
    changeThresholds: 'Change thresholds',
  },
  pill: {
    tip: {
      one: '{failed} of {total} run with this version failed',
      other: '{failed} of {total} runs with this version failed',
    },
    early: ' (provisional, judged from {min})',
    regression: '. Significantly more than before.',
    errors: '{rate} errors',
    provisional: 'provisional',
  },
  nodes: {
    where: 'Where it fails',
    whereTip:
      'The node at which the execution aborted, with the latest error message from n8n. The percentage refers to all runs of this version.\n\nFlowVault fetches details for at most 200 errors per fetch. With very many errors, the numbers per node can therefore be somewhat lower than the overall rate.',
    line: '<n>“{name}”</n><m> in {rate} of runs ({failed}×)</m>',
    isNew: 'new since this version',
    isNewTip:
      'In the versions before, this node almost never failed – in at most 2 % of runs.\n\nA strong hint that the change in this version is the cause. Look at the “Changes” tab to see what is different about this node.',
    canvas: 'On the canvas, these nodes have a red outline.',
  },
  panel: {
    unavailable: 'Failure rate currently unavailable',
    unavailableHint: 'FlowVault restarts the analysis automatically. Versions, comparing and restoring keep working.',
    disabled: 'Failure rate per version is switched off',
    disabledHint: 'Shows per version how often the workflow failed in n8n. <link>Switch on</link>',
    pollFailed: 'Executions could not be fetched: {reason}',
    lastGood: 'Last successful state {when}.',
    firstPoll: 'FlowVault is fetching the executions from n8n for the first time',
    firstPollHint: 'This usually takes under a minute. The page refreshes on its own.',
    whyInactive: 'The workflow is not active in n8n.',
    whyManual: 'Test runs from the editor are not counted.',
    whyLookback: 'Executions of the last {days} days are fetched, as far as n8n still has them.',
    noRunsPast: 'While v{number} was current, there were no counted runs',
    noRunsYet: 'With v{number} there have been no counted runs yet',
    provisional: 'Provisional: only {total} of {min} runs so far. From {min} on, FlowVault compares with the versions before.',
    provisionalLabel: 'Provisional',
    provisionalTip:
      'With few runs the rate fluctuates strongly: one error in 2 runs is already 50 %.\n\nThat is why a verdict and a possible warning only come from {runs} on. You set the limit in the settings.',
    noBase: 'No comparison possible: before v{number} there were too few counted runs.',
    noBaseLabel: 'No comparison possible',
    noBaseTip:
      'For a comparison, the versions before it also need at least {runs} combined.\n\nThis happens with the first version, with rarely running workflows, or when n8n has already deleted older executions.',
    fewer: 'Fewer errors than before.',
    slightlyMore: 'Slightly more errors than before, but below the warning threshold of {threshold} percentage points.',
    same: 'Nothing unusual, about the same as before.',
    since: 'Since v{number}, {rate} of runs fail',
    failedShare: '{rate} of runs failed',
    rateLabel: 'Failure rate',
    rateTip:
      '<b>Failure rate</b> = failed ÷ completed runs, while this version was current in n8n.\n\n{manual} Canceled and still running executions do not count.',
    manualCounted: 'Test runs from the editor are counted.',
    manualNotCounted: 'Test runs from the editor are not counted.',
    before: ', before {rate} ({range})',
    beforeLabel: 'Comparison with before',
    beforeTip:
      '<b>Comparison base</b>: the versions directly before, combined, until at least {runs} are together. At most five versions back.\n\nHere: {range} with {total}, of which {failed} failed.',
    counts: '{failed}/{runs}',
    canceledSuffix: ' · {count} canceled',
    canceledLabel: 'canceled',
    canceledTip: 'Executions stopped by hand. They count neither as success nor as failure.',
    rollbackHint:
      'v{number} is the last version that ran stably ({rate} errors). Rolling back deploys it to n8n; the current state stays saved here.',
    rollbackLabel: 'Rollback suggestion',
    rollbackTip:
      'FlowVault searches backwards for the most recent version whose failure rate was close to the time before the change.\n\nWhen you click, you see once more what will happen: overwrite or create as a copy. Afterwards a new version is created; the history stays complete.',
    rollbackButton: 'Roll back to v{number}',
  },
  alert: {
    dismissTip: 'Hides the warning for this version. If the failure rate of a later version rises, FlowVault warns again.',
    title: 'Since the change in v{number}, this workflow fails significantly more often',
    whyLabel: 'Why this warning?',
    why1: 'FlowVault compares the failure rate of the current version with the versions before it.',
    whyDetail: 'If, after at least {runs}, it is {threshold} percentage points or more above them, this warning appears.',
    why2: 'The warning disappears on its own once a newer version runs normally again or you roll back.',
    body: '{rate} of runs fail ({failed} of {total}), before it was {baseline}. Detected {when}.',
    bodyNode: '{rate} of runs fail ({failed} of {total}), before it was {baseline}. Mostly “{name}” fails. Detected {when}.',
    look: 'Look at what changed in v{number}.',
    lookUrgent: 'Look at what changed in v{number}. If it is urgent: v{rollback} last ran stably.',
    dismiss: 'Dismiss',
    dismissedVersion: 'Warning for v{number} dismissed',
    dismissed: 'Warning dismissed',
    viewChange: 'View change',
    cardTitle: { one: 'One workflow fails more often since a change', other: '{count} workflows fail more often since a change' },
    howDetected: 'How is this detected?',
    cardText: 'The failure rate of the current version is significantly above the previous one. Open the workflow to see the change.',
    row: '{instance} · since v{number}: <r>{rate}</r> errors instead of {baseline}',
    rowNode: ' · mostly “{name}”',
    rollbackTitle: 'v{number} last ran stably',
  },
};
