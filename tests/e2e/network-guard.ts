import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/** Deny HTTP forwarding and HTTPS tunnels before the browser process starts. */
export async function startNetworkGuard() {
    const attempts: { method: string; origin: string }[] = [];
    const sockets = new Set<Socket>();
    const errors: string[] = [];
    const record = (method: string, value: string) => {
        try {
            const url = new URL(method === 'CONNECT' ? `https://${value}` : value);
            // Browser internal traffic also reaches this proxy. Never retain paths,
            // queries, headers or bodies, which may contain translation data/keys.
            attempts.push({ method, origin: url.origin });
        } catch {
            attempts.push({ method, origin: '<invalid origin>' });
        }
    };
    const server = createServer((request, response) => {
        record(request.method ?? 'UNKNOWN', request.url ?? '');
        response.writeHead(502, { Connection: 'close' });
        response.end();
    });
    server.on('connect', (request, socket) => {
        record('CONNECT', request.url ?? '');
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', (error: NodeJS.ErrnoException) => {
            // A rejected tunnel is commonly reset by Chromium during teardown.
            if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') errors.push(error.code ?? 'socket error');
        });
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    server.on('error', (error: NodeJS.ErrnoException) => errors.push(error.code ?? 'proxy error'));
    const port = (server.address() as AddressInfo).port;
    return {
        proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
        attempts,
        async close() {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            if (errors.length) throw new Error(`Test network guard failed: ${errors.join(', ')}`);
        },
    };
}
