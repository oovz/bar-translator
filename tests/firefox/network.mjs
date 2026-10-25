import { createServer, request as httpRequest } from 'node:http';
import { URL } from 'node:url';

function managedServer(handler) {
    const sockets = new Set();
    const server = createServer(handler);
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', () => {});
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    return {
        server,
        async listen() {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', () => {
                    server.off('error', reject);
                    resolve();
                });
            });
            return `http://127.0.0.1:${server.address().port}`;
        },
        async close() {
            for (const socket of sockets) socket.destroy();
            if (server.listening) await new Promise((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
            });
        },
    };
}

function originOf(value) {
    try { return new URL(value).origin; }
    catch { return '<invalid origin>'; }
}

/** Firefox uses this proxy even for loopback. It never forwards a different origin,
 * route, query, credential, method, or HTTPS tunnel. Diagnostics retain origins only.
 */
export async function startAllowlistProxy(fixtureOrigin) {
    const attempts = [];
    const upstream = new Set();
    const proxy = managedServer((request, response) => {
        let url;
        try { url = new URL(request.url); } catch { /* Denied below. */ }
        const allowed = url?.origin === fixtureOrigin && !url.username && !url.password && !url.search &&
            ((request.method === 'GET' && url.pathname === '/libre/languages') ||
                (request.method === 'POST' && url.pathname === '/libre/translate'));
        attempts.push({ method: request.method, origin: originOf(request.url), allowed: Boolean(allowed) });
        if (!allowed) {
            response.writeHead(502, { Connection: 'close' });
            response.end();
            request.resume();
            return;
        }
        const forward = httpRequest(url, {
            method: request.method,
            // Do not forward proxy credentials, cookies, or browser-specific headers.
            headers: {
                Accept: 'application/json',
                ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            },
        }, incoming => {
            response.writeHead(incoming.statusCode, incoming.headers);
            incoming.pipe(response);
        });
        upstream.add(forward);
        forward.once('close', () => upstream.delete(forward));
        forward.on('error', () => {
            if (!response.headersSent) response.writeHead(502);
            response.end();
        });
        request.pipe(forward);
        response.once('close', () => forward.destroy());
    });
    proxy.server.on('connect', (request, socket) => {
        attempts.push({ method: 'CONNECT', origin: originOf(`https://${request.url}`), allowed: false });
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    const origin = await proxy.listen();
    return {
        origin,
        fixtureOrigin,
        attempts,
        async close() {
            for (const request of upstream) request.destroy();
            await proxy.close();
        },
    };
}

export const LITERAL_TRANSLATION = 'Hola <Firefox> & "fixture"';
export const CURRENT_TRANSLATION = 'Resultado actual de Firefox';
export const STALE_TRANSLATION = 'Resultado obsoleto de Firefox';
export const OVERRIDE_TRANSLATION = 'Firefox en chino tradicional';

/** Real HTTP with deliberately no CORS headers; production extension fetch is untouched. */
export async function startLibreFixture() {
    const requests = [];
    const violations = [];
    let held;
    let staleCancelled = false;
    const fixture = managedServer(async (request, response) => {
        try {
            let body = '';
            for await (const chunk of request) {
                body += chunk;
                if (body.length > 4096) throw new Error('fixture request exceeded its bound');
            }
            if (request.method === 'GET' && request.url === '/libre/languages' && !body) {
                requests.push({ method: 'GET' });
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify([
                    { code: 'en', name: 'English', targets: ['es', 'zh-Hant'] },
                    { code: 'es', name: 'Spanish', targets: ['en'] },
                    { code: 'zh-Hant', name: 'Chinese (traditional)', targets: ['en'] },
                ]));
                return;
            }
            if (request.method !== 'POST' || request.url !== '/libre/translate') throw new Error('unexpected fixture route');
            const payload = JSON.parse(body);
            const pairs = {
                Hello: ['en', 'es'],
                'hello firefox': ['auto', 'es'],
                'language override': ['auto', 'zh-Hant'],
                'stale firefox': ['auto', 'es'],
                'current firefox': ['auto', 'es'],
            };
            const pair = pairs[payload.q];
            if (!pair || payload.source !== pair[0] || payload.target !== pair[1] || payload.format !== 'text' ||
                Object.keys(payload).sort().join(',') !== 'format,q,source,target') throw new Error('unexpected fixture payload');
            requests.push({ method: 'POST', sample: payload.q });
            const translation = payload.q === 'current firefox' ? CURRENT_TRANSLATION :
                payload.q === 'stale firefox' ? STALE_TRANSLATION :
                    payload.q === 'language override' ? OVERRIDE_TRANSLATION : LITERAL_TRANSLATION;
            const complete = () => {
                if (response.destroyed) return;
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({ translatedText: translation }));
            };
            if (payload.q === 'stale firefox') {
                held = complete;
                response.once('close', () => { staleCancelled = !response.writableEnded; });
            }
            else complete();
        } catch {
            // Never retain request URLs, bodies, or parsing errors in diagnostics.
            violations.push('unexpected fixture request');
            response.writeHead(400);
            response.end();
        }
    });
    return {
        origin: await fixture.listen(),
        requests,
        violations,
        get staleCancelled() { return staleCancelled; },
        releaseStale() {
            if (!held) throw new Error('stale fixture response was not requested');
            held();
            held = undefined;
        },
        close: () => fixture.close(),
    };
}
