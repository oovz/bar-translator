import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, launchExtension } from './fixtures';

test('routes an actual extension worker request without reaching its server', async ({ context }) => {
    const serverHits: string[] = [];
    const server = createServer((_request, response) => {
        serverHits.push('reached');
        response.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
        response.end('unrouted');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture`;
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        let routedFromWorker = false;
        await context.route(url, async route => {
            routedFromWorker = route.request().serviceWorker() !== null;
            await route.fulfill({ status: 201, body: 'routed fixture', headers: { 'Access-Control-Allow-Origin': '*' } });
        });
        const result = await worker.evaluate(async endpoint => {
            const response = await fetch(endpoint);
            return { status: response.status, text: await response.text() };
        }, url);
        expect(result).toEqual({ status: 201, text: 'routed fixture' });
        expect(routedFromWorker).toBe(true);
        expect(serverHits).toEqual([]);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('aborts an unapproved worker request and reports only its origin', async ({ headless }) => {
    const extension = await launchExtension('', headless);
    const worker = extension.context.serviceWorkers()[0] ?? await extension.context.waitForEvent('serviceworker');
    try {
        const rejected = await worker.evaluate(async () => {
            try {
                await fetch('https://unapproved.invalid/private-text?api_key=synthetic-secret');
                return false;
            } catch {
                return true;
            }
        });
        expect(rejected).toBe(true);
    } finally {
        await extension.close(['GET https://unapproved.invalid']);
    }
});

test('denies a startup worker request before a Playwright route can exist', async ({ headless }) => {
    const serverHits: string[] = [];
    const server = createServer((_request, response) => {
        serverHits.push('reached');
        response.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
        response.end('escaped');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const directory = await mkdtemp(path.join(tmpdir(), 'bar-startup-boundary-'));
    let extension: Awaited<ReturnType<typeof launchExtension>> | undefined;
    try {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
            manifest_version: 3, name: 'Startup network boundary probe', version: '1.0',
            permissions: ['storage'], host_permissions: [`${origin}/*`],
            background: { service_worker: 'worker.js' },
        }));
        // A tiny probe extension tests the harness itself. This is separate from
        // production WXT acceptance and deliberately starts a request immediately.
        await writeFile(path.join(directory, 'worker.js'),
            `globalThis.startupRequest = fetch(${JSON.stringify(`${origin}/startup?sample=private`)}).then(r => ({ status: r.status }), () => ({ rejected: true }));`);
        extension = await launchExtension('', headless, { extensionPath: directory, installRouting: false });
        const worker = extension.context.serviceWorkers()[0] ?? await extension.context.waitForEvent('serviceworker');
        await worker.evaluate(() => Reflect.get(globalThis, 'startupRequest'));
        expect(extension.startupDenials).toContainEqual({ method: 'GET', origin });
        expect(serverHits).toEqual([]);
        expect(JSON.stringify(extension.startupDenials)).not.toContain('sample=private');
    } finally {
        try {
            await extension?.close();
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await rm(directory, { recursive: true, force: true });
        }
    }
});
