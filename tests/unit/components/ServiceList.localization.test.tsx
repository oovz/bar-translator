/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { createDefaultSetup } from '@/utils/instances';
vi.mock('sortablejs', () => ({ default: { create: vi.fn(() => ({ destroy: vi.fn() })) } }));
vi.mock('@/services', () => ({ testInstance: vi.fn() }));
vi.mock('@/utils/storage', () => ({ reconcileSetupAccess: vi.fn(async () => {}) }));
afterEach(async () => { await act(() => cleanup()); vi.mocked(chrome.i18n.getMessage).mockImplementation(key => key); });

it.each(['en', 'es', 'fr', 'ja', 'ko', 'zh_CN', 'zh_TW'])('renders provider descriptions and named disclosures using the %s browser catalog', async locale => {
    const messages: Record<string, { message: string }> = JSON.parse(readFileSync(resolve('public', '_locales', locale, 'messages.json'), 'utf8'));
    vi.mocked(chrome.i18n.getMessage).mockImplementation((key, substitutions) => {
        const values = typeof substitutions === 'string' ? [substitutions] : substitutions ?? [];
        return (messages[key]?.message ?? '').replace(/\$(\d+)/g, (_, number) => String(values[Number(number) - 1] ?? ''));
    });
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    const view = render(<ServiceList setup={createDefaultSetup()} updateSetup={async () => true} />);
    const google = view.container.querySelector<HTMLElement>('[data-id="google-web"]')!;
    expect(google.textContent).toContain(messages.googleProviderDescription?.message);
    await waitFor(() => expect(google.textContent).toContain(messages.providerReady?.message));
    expect(google.querySelector('.service-disclosure')).toBeNull();
    const deepl = view.container.querySelector<HTMLElement>('#available-providers [data-catalog-provider="deepl"]')!;
    expect(deepl.textContent).toContain(messages.deepLProviderDescription?.message);
    fireEvent.click(deepl.querySelector('[data-action="add-provider"]')!);
    const details = deepl.querySelector<HTMLButtonElement>('.service-disclosure')!;
    expect(details.getAttribute('aria-label')).toBe(messages.showServiceDetails?.message.replace('$1', 'DeepL'));
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(details.querySelector('.disclosure-chevron')).not.toBeNull();
    expect(view.container.textContent).not.toMatch(/googleProviderDescription|deepLProviderDescription|showServiceDetails/);
});
