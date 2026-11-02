import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeOffscreenDocument, copyToClipboard } from '@/utils/clipboard';

describe('offscreen document cleanup', () => {
    const getContexts = vi.fn();
    const closeDocument = vi.fn();
    beforeEach(() => {
        vi.stubEnv('FIREFOX', '');
        vi.stubGlobal('chrome', {
            runtime: { ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, getContexts },
            offscreen: { closeDocument },
        });
        getContexts.mockReset();
        closeDocument.mockReset();
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('closes an existing Chromium document', async () => {
        getContexts.mockResolvedValue([{}]);
        await closeOffscreenDocument();
        expect(closeDocument).toHaveBeenCalledOnce();
    });

    it('does not attempt to close a missing Chromium document', async () => {
        getContexts.mockResolvedValue([]);
        await closeOffscreenDocument();
        expect(getContexts).toHaveBeenCalledOnce();
        expect(closeDocument).not.toHaveBeenCalled();
    });

    it('does not use Chromium document APIs on Firefox', async () => {
        vi.stubEnv('FIREFOX', 'true');
        await closeOffscreenDocument();
        expect(getContexts).not.toHaveBeenCalled();
        expect(closeDocument).not.toHaveBeenCalled();
    });
});

describe('clipboard operation outcomes', () => {
    const contains = vi.fn();
    const getContexts = vi.fn();
    const createDocument = vi.fn();
    const closeDocument = vi.fn();
    const sendMessage = vi.fn();
    const writeText = vi.fn();
    beforeEach(() => {
        vi.stubEnv('FIREFOX', '');
        vi.stubGlobal('chrome', {
            permissions: { contains },
            runtime: { ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, getContexts, sendMessage },
            offscreen: { Reason: { CLIPBOARD: 'CLIPBOARD' }, createDocument, closeDocument },
        });
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        contains.mockReset().mockResolvedValue(true);
        getContexts.mockReset().mockResolvedValue([{}]);
        createDocument.mockReset().mockResolvedValue(undefined);
        closeDocument.mockReset().mockResolvedValue(undefined);
        sendMessage.mockReset().mockResolvedValue({ success: true });
        writeText.mockReset().mockResolvedValue(undefined);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it('reports denied access without creating a document or sending text', async () => {
        contains.mockResolvedValue(false);
        expect(await copyToClipboard('private text')).toBe(false);
        expect(getContexts).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('reports successful Firefox clipboard writes', async () => {
        vi.stubEnv('FIREFOX', 'true');
        expect(await copyToClipboard('translated text')).toBe(true);
        expect(writeText).toHaveBeenCalledWith('translated text');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('reports access revoked after document lookup without sending text', async () => {
        contains.mockResolvedValueOnce(true).mockResolvedValue(false);
        expect(await copyToClipboard('private text')).toBe(false);
        expect(getContexts).toHaveBeenCalledOnce();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it.each([{ success: false }, undefined])('reports an unsuccessful offscreen response: %j', async response => {
        sendMessage.mockResolvedValue(response);
        expect(await copyToClipboard('translated text')).toBe(false);
        expect(sendMessage).toHaveBeenCalledWith({ type: 'COPY_TO_CLIPBOARD', text: 'translated text' });
    });

    it('retains a newly created document while access remains granted', async () => {
        getContexts.mockResolvedValueOnce([]);
        expect(await copyToClipboard('translated text')).toBe(true);
        expect(createDocument).toHaveBeenCalledOnce();
        expect(closeDocument).not.toHaveBeenCalled();
    });

    it('closes a newly created document if its permission was revoked during creation', async () => {
        getContexts.mockResolvedValueOnce([]);
        createDocument.mockImplementationOnce(async () => { contains.mockResolvedValue(false); });
        expect(await copyToClipboard('private text')).toBe(false);
        expect(closeDocument).toHaveBeenCalledOnce();
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
