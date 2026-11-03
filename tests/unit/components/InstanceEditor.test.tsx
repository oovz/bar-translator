/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { InstanceEditor } from '@/entrypoints/options/components/InstanceEditor';
import { createDefaultSetup, validateSetup } from '@/utils/instances';
import { testConfiguredInstance, testInstance } from '@/services';
import { reconcileSetupAccess } from '@/utils/storage';
import type { DeepLInstance, LibreTranslateInstance } from '@/src/types';
vi.mock('@/services', () => ({ testInstance: vi.fn(), testConfiguredInstance: vi.fn() }));
vi.mock('@/utils/storage', () => ({ reconcileSetupAccess: vi.fn(async () => {}) }));
let failSave = false;
let saved = createDefaultSetup();
let granted = false;
const close = vi.fn();
const draft: DeepLInstance = { id: 'new-account', providerId: 'deepl', name: 'Personal' };
function Harness({ initial = draft }: { initial?: DeepLInstance | LibreTranslateInstance } = {}) {
 const [setup, setSetup] = useState(saved);
 const instance = setup.instances.find(i => i.id === initial.id) as DeepLInstance | LibreTranslateInstance | undefined;
 return <InstanceEditor instance={instance ?? initial} isNew={!instance} isAdding enabled={false} allowed={granted} transitioning={false}
 onTransitionBlockedChange={() => {}} onCancel={close} updateSetup={async update => { if (failSave) return false; saved = validateSetup(await update(saved)); setSetup(saved); return true; }} />;
}
beforeEach(() => {
 saved = createDefaultSetup(); granted = false; failSave = false; vi.clearAllMocks();
 vi.mocked(chrome.permissions.contains).mockImplementation(async () => granted);
 vi.mocked(chrome.permissions.request).mockImplementation(async () => { granted = true; return true; });
 vi.mocked(testConfiguredInstance).mockResolvedValue({ valid: true });
});
it('saves for later without requesting access or testing credentials', async () => {
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('saveForLater'));
 await waitFor(() => expect(saved.instances.find(i => i.id === draft.id)).toMatchObject({ credential: { key: 'secret:fx' } }));
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect(chrome.permissions.request).not.toHaveBeenCalled(); expect(testInstance).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});
it('requests access in the click gesture before persistence and enables without a credential test', async () => {
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('addAndEnable'));
 expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
 await waitFor(() => expect(saved.preferences.fallbackOrder).toContain(draft.id));
 expect(testInstance).not.toHaveBeenCalled();
});
it('retains an inactive saved configuration and inputs after denial, and can retry', async () => {
 vi.mocked(chrome.permissions.request).mockImplementationOnce(async () => false);
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('addAndEnable'));
 await view.findByText('permissionDenied');
 expect(saved.instances.find(i => i.id === draft.id)).toMatchObject({ credential: { key: 'secret:fx' } });
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).value).toBe('secret:fx'); expect(close).not.toHaveBeenCalled();
 fireEvent.click(view.getByText('addAndEnable'));
 await waitFor(() => expect(saved.preferences.fallbackOrder).toContain(draft.id));
});

function pendingPermission() {
 let finish!: (value: boolean) => void;
 const promise = new Promise<boolean>(resolve => { finish = resolve; });
 vi.mocked(chrome.permissions.request).mockImplementationOnce(() => promise);
 return () => { granted = true; finish(true); };
}
function startAdding() {
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('addAndEnable'));
 return view;
}
it('reconciles a granted host when persistence fails', async () => {
 failSave = true;
 const allow = pendingPermission();
 const view = startAdding();
 await view.findByText('settingsSaveFailed');
 allow();
 await waitFor(() => expect(reconcileSetupAccess).toHaveBeenCalled());
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
});
it('does not activate after inline setup unmounts while the permission prompt is pending', async () => {
 const allow = pendingPermission();
 const view = startAdding();
 await waitFor(() => expect(saved.instances.some(i => i.id === draft.id)).toBe(true));
 view.unmount();
 allow();
 await waitFor(() => expect(reconcileSetupAccess).toHaveBeenCalled());
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect(close).not.toHaveBeenCalled();
});
it('does not activate a credential replaced by another page while access is pending', async () => {
 const allow = pendingPermission();
 const view = startAdding();
 await waitFor(() => expect(saved.instances.some(i => i.id === draft.id)).toBe(true));
 saved = { ...saved, instances: saved.instances.map(i => i.id === draft.id ? { ...draft, credential: undefined } : i) };
 allow();
 await view.findByText('instanceChanged');
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect(reconcileSetupAccess).toHaveBeenCalled();
});
it('keeps the saved configuration inactive and reconciles access if activation cannot persist', async () => {
 const allow = pendingPermission();
 const view = startAdding();
 await waitFor(() => expect(saved.instances.some(i => i.id === draft.id)).toBe(true));
 failSave = true;
 allow();
 await view.findByText('settingsSaveFailed');
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect(saved.instances.some(i => i.id === draft.id)).toBe(true);
 expect(reconcileSetupAccess).toHaveBeenCalled();
 expect(close).not.toHaveBeenCalled();
});

it.each<DeepLInstance | LibreTranslateInstance>([
 draft,
 { id: 'managed', providerId: 'libretranslate', name: 'Managed', hosting: 'managed', endpoint: 'https://libretranslate.com' },
])('adds and enables $providerId before a required key is supplied', async initial => {
 const view = render(<Harness initial={initial} />);
 fireEvent.click(view.getByText('addAndEnable'));
 expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: initial.providerId === 'deepl'
  ? ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] : ['https://libretranslate.com/*'] });
 await waitFor(() => expect(saved.preferences.fallbackOrder).toContain(initial.id));
 expect(saved.instances.find(instance => instance.id === initial.id)).not.toHaveProperty('credential.key');
 expect(testInstance).not.toHaveBeenCalled();
 expect(testConfiguredInstance).not.toHaveBeenCalled();
 expect(close).toHaveBeenCalledOnce();
});
it('reports a synchronous permission request failure without discarding inputs', async () => {
 vi.mocked(chrome.permissions.request).mockImplementationOnce(() => { throw new Error('Browser access unavailable'); });
 const view = startAdding();
 await view.findByText('Browser access unavailable');
 expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).value).toBe('secret:fx');
 expect(close).not.toHaveBeenCalled();
});
it('does not issue a second permission request while setup is pending', async () => {
 const allow = pendingPermission();
 const view = startAdding();
 fireEvent.click(view.getByText('addAndEnable'));
 expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
 allow();
 await waitFor(() => expect(saved.preferences.fallbackOrder).toContain(draft.id));
});

it('tests the current add-dialog values without saving, enabling or retaining access', async () => {
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('testKey'));
 await view.findByText('valid');
 expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
 expect(testConfiguredInstance).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'deepl', credential: expect.objectContaining({ key: 'secret:fx' }) }));
 expect(saved.instances.some(instance => instance.id === draft.id)).toBe(false);
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect(close).not.toHaveBeenCalled();
 await waitFor(() => expect(reconcileSetupAccess).toHaveBeenCalled());
});

it('does not test or persist a draft when the add-dialog permission is denied', async () => {
 vi.mocked(chrome.permissions.request).mockImplementationOnce(async () => false);
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('testKey'));
 await view.findByText('permissionDenied');
 expect(testConfiguredInstance).not.toHaveBeenCalled();
 expect(saved.instances.some(instance => instance.id === draft.id)).toBe(false);
 expect(close).not.toHaveBeenCalled();
});

it('reports a failed add-dialog preflight without enabling or saving', async () => {
 vi.mocked(testConfiguredInstance).mockResolvedValueOnce({ valid: false });
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('testKey'));
 await view.findByText('keyTestFailed');
 expect(saved.preferences.fallbackOrder).not.toContain(draft.id);
 expect(saved.instances.some(instance => instance.id === draft.id)).toBe(false);
});

it('disables the add-dialog test until a required key is present', () => {
 const view = render(<Harness />);
 expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false);
});

it('does not issue a second add-dialog test while access is pending', async () => {
 const allow = pendingPermission();
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 const testButton = view.getByText('testKey');
 fireEvent.click(testButton);
 fireEvent.click(testButton);
 expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
 allow();
 await view.findByText('valid');
 expect(testConfiguredInstance).toHaveBeenCalledTimes(1);
});

it('focuses the invalid name field when add-and-enable validation fails', () => {
 const view = render(<Harness />);
 const name = view.getByLabelText('instanceName');
 fireEvent.input(name, { target: { value: '' } });
 fireEvent.click(view.getByText('addAndEnable'));
 expect(document.activeElement).toBe(name);
});

it('focuses an invalid draft name and permits testing after it is corrected', async () => {
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 const name = view.getByLabelText('instanceName');
 fireEvent.input(name, { target: { value: '' } });
 fireEvent.click(view.getByText('testKey'));
 expect(document.activeElement).toBe(name);
 expect((await view.findByRole('alert')).textContent).toBe('instanceNameInvalid');
 expect(chrome.permissions.request).not.toHaveBeenCalled();
 fireEvent.input(name, { target: { value: 'Personal' } });
 fireEvent.click(view.getByText('testKey'));
 await view.findByText('valid');
 expect(testConfiguredInstance).toHaveBeenCalledOnce();
});

it('allows retrying a draft test after a synchronous permission request failure', async () => {
 vi.mocked(chrome.permissions.request).mockImplementationOnce(() => { throw new Error('Browser access unavailable'); });
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('testKey'));
 expect((await view.findByRole('alert')).textContent).toBe('Browser access unavailable');
 expect(testConfiguredInstance).not.toHaveBeenCalled();
 fireEvent.click(view.getByText('testKey'));
 await view.findByText('valid');
 expect(testConfiguredInstance).toHaveBeenCalledOnce();
});

it('reports a failed access cleanup as an error after a successful draft test', async () => {
 vi.mocked(reconcileSetupAccess).mockRejectedValueOnce(new Error('Browser unavailable'));
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('testKey'));
 expect((await view.findByRole('alert')).textContent).toBe('permissionRemoveFailed');
 expect(view.queryByRole('status')).toBeNull();
 expect(saved.instances.some(instance => instance.id === draft.id)).toBe(false);
 expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false);
});

it('attempts cleanup when a draft grant arrives after unmount', async () => {
 const allow = pendingPermission();
 vi.mocked(reconcileSetupAccess).mockRejectedValueOnce(new Error('Browser unavailable'));
 const view = render(<Harness />);
 fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'secret:fx' } });
 fireEvent.click(view.getByText('testKey'));
 view.unmount();
 allow();
 await waitFor(() => expect(reconcileSetupAccess).toHaveBeenCalled());
 expect(testConfiguredInstance).not.toHaveBeenCalled();
 expect(saved.instances.some(instance => instance.id === draft.id)).toBe(false);
 expect(close).not.toHaveBeenCalled();
});
