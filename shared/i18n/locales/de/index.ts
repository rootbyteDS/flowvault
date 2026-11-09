/**
 * Deutsche Texte – die Vorlage für alle anderen Sprachen: Ihre Struktur bestimmt, welche Schlüssel
 * jede Sprache liefern muss (siehe ../../types.ts).
 */
import { account, system } from './account.ts';
import { auth, changes, common, language, meta, nav, time, ui } from './core.ts';
import { errors, log, suggestReason, versionMessage } from './errors.ts';
import { health } from './health.ts';
import { instances, restore } from './instances.ts';
import { activity, dashboard, workflows } from './pages.ts';
import { promote, transform } from './promote.ts';
import { settings } from './settings.ts';
import { canvas, compare, diff, workflow } from './workflow.ts';

export const de = {
  meta, common, language, nav, ui, time, changes, auth,
  dashboard, activity, workflows, instances, restore,
  workflow, compare, diff, canvas, promote, transform,
  health, settings, account, system,
  errors, log, versionMessage, suggestReason,
};
