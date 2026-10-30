/**
 * webview 内的多语言支持。语言包在 locales/ 下，按键查表，英文为缺省和回退语言。
 * 语言由扩展端写在 <html lang> 上（取自 vscode.env.language），未收录的语言使用英文，
 * 与 VS Code 自身对扩展本地化文件的回退规则一致。
 */

import en from './locales/en.json';
import zhCn from './locales/zh-cn.json';

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;

export const catalogs: Record<string, Catalog> = {
  en,
  'zh-cn': zhCn,
};

export const DEFAULT_LOCALE = 'en';
let current = DEFAULT_LOCALE;

export function resolveLocale(lang: string | null | undefined): string {
  const id = String(lang || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(catalogs, id) ? id : DEFAULT_LOCALE;
}

export function setLocale(lang: string | null | undefined): string {
  current = resolveLocale(lang);
  return current;
}

function lookup(key: string): string {
  const own = catalogs[current][key];
  if (own !== undefined) return own;
  const fallback = catalogs[DEFAULT_LOCALE][key];
  return fallback !== undefined ? fallback : key;
}

/** 把 {name} 占位符替换为 params 中的值，缺少的参数原样保留 */
function format(template: string, params?: Params): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params && params[name] !== undefined ? String(params[name]) : whole,
  );
}

export function t(key: string, params?: Params): string {
  return format(lookup(key), params);
}

/**
 * 带数量的文案。当前语言收录了 `${key}.one` 且 n 恰为 1 时使用单数形式，
 * 否则用基础键；占位符 {n} 默认取 n，params 中的同名参数优先。
 */
export function tn(key: string, n: number, params?: Params): string {
  const one = `${key}.one`;
  const useOne = n === 1 && catalogs[current][one] !== undefined;
  return format(lookup(useOne ? one : key), { n, ...params });
}

function shortcutName(shortcut: string): string {
  return shortcut === 'Space' ? t('key.space') : shortcut;
}

/**
 * 翻译页面里的静态文案：
 * - data-i18n：替换元素文本
 * - data-i18n-aria：设置 aria-label；同时有 data-shortcut 时，title 为“名称 (快捷键)”
 * - data-i18n-title：设置悬停提示 title
 */
export function applyStatic(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n || '');
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const label = t(el.dataset.i18nAria || '');
    el.setAttribute('aria-label', label);
    if (el.dataset.shortcut) el.title = `${label} (${shortcutName(el.dataset.shortcut)})`;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle || '');
  }
}
