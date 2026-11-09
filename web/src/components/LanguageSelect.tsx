import { Languages } from 'lucide-react';
import { isLocale } from '../../../shared/i18n/index.ts';
import { t, useI18n } from '../i18n.tsx';
import { cx } from '../util.ts';

/**
 * Sprachwähler. Die Wahl gilt für diesen Browser; der Name jeder Sprache steht in ihr selbst,
 * damit man sie auch findet, wenn die Oberfläche gerade in einer unbekannten Sprache läuft.
 */
export function LanguageSelect({ className }: { className?: string }) {
  const { locale, locales, setLocale } = useI18n();
  return (
    <label className={cx('relative inline-flex items-center', className)}>
      <Languages className="pointer-events-none absolute left-3 size-4 text-dim" />
      <select
        value={locale}
        aria-label={t('language.label')}
        onChange={(e) => isLocale(e.target.value) && setLocale(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-line-2 bg-sidebar pr-8 pl-9 text-sm text-text outline-none transition-colors focus:border-accent"
      >
        {locales.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 size-3 text-dim" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="m2.5 4.5 3.5 3.5 3.5-3.5" />
      </svg>
    </label>
  );
}
