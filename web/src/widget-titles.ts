import type { WidgetId } from '../../shared/dashboard.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';

/** One title for the card, visibility picker and accessible action labels. */
export const WIDGET_TITLES: Record<WidgetId, MessageKey> = {
  health: 'dashboard.customize.health',
  instanceCount: 'dashboard.stats.instances',
  workflowCount: 'dashboard.stats.workflows',
  versionCount: 'dashboard.stats.versions',
  storage: 'dashboard.stats.storage',
  history: 'dashboard.customize.history',
  executions: 'dashboard.executions.title',
  activity: 'dashboard.recent',
  instances: 'dashboard.customize.instances',
};
