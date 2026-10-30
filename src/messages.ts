/**
 * 扩展主进程的运行时文案。源码里的英文原文即键，非英文语言从 l10n/ 下的语言包查表，
 * 查不到时使用英文原文。不依赖 vscode 模块，便于在 VS Code 之外测试。
 */

import zhCn from '../l10n/bundle.l10n.zh-cn.json';

const catalogs: Record<string, Record<string, string>> = {
  'zh-cn': zhCn,
};

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED: readonly string[] = [DEFAULT_LOCALE, ...Object.keys(catalogs)];
let current = DEFAULT_LOCALE;

/**
 * 由设置项和 VS Code 显示语言得出实际语言。
 * setting 为 'auto' 时取 vscodeLanguage；结果不在支持列表内时用英文。
 */
export function resolve(setting: unknown, vscodeLanguage: unknown): string {
  const choice = String(setting || 'auto').toLowerCase();
  const id = choice === 'auto' ? String(vscodeLanguage || '').toLowerCase() : choice;
  return SUPPORTED.includes(id) ? id : DEFAULT_LOCALE;
}

export function setLocale(locale: string): string {
  current = SUPPORTED.includes(locale) ? locale : DEFAULT_LOCALE;
  return current;
}

/** 翻译 message，并把 {0}、{1}… 替换为 args 中对应的值 */
export function t(message: string, ...args: unknown[]): string {
  const catalog = catalogs[current];
  const text = catalog && catalog[message] !== undefined ? catalog[message] : message;
  return text.replace(/\{(\d+)\}/g, (whole, i: string) => {
    const value = args[Number(i)];
    return value !== undefined ? String(value) : whole;
  });
}
