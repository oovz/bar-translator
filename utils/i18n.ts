export function t(key: string, substitutions?: string | string[]): string {
    return browser.i18n.getMessage(key as Parameters<typeof browser.i18n.getMessage>[0], substitutions) || key;
}
