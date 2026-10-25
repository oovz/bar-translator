import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { startAllowlistProxy, startLibreFixture } from './network.mjs';

function throughProxy(proxy, target, method = 'GET') {
    return new Promise((resolve, reject) => {
        const outgoing = request(proxy, { path: target, method }, response => {
            response.resume();
            response.once('end', () => resolve(response.statusCode));
        });
        outgoing.on('connect', (response, socket) => {
            socket.destroy();
            resolve(response.statusCode);
        });
        outgoing.on('error', reject);
        outgoing.end();
    });
}

test('Firefox proxy forwards only exact fixture routes and records only origins', async t => {
    const fixture = await startLibreFixture();
    t.after(() => fixture.close());
    const proxy = await startAllowlistProxy(fixture.origin);
    t.after(() => proxy.close());
    assert.equal(await throughProxy(proxy.origin, `${fixture.origin}/libre/languages`), 200);
    for (const [target, method] of [
        [`${fixture.origin}/libre/languages?api_key=synthetic-secret`, 'GET'],
        [`${fixture.origin}/other`, 'GET'],
        ['http://127.0.0.1:1/libre/languages', 'GET'],
        ['https://unapproved.invalid/private?api_key=synthetic-secret', 'GET'],
        [`${fixture.origin}/libre/languages`, 'POST'],
        ['unapproved.invalid:443', 'CONNECT'],
    ]) assert.equal(await throughProxy(proxy.origin, target, method), 502);
    assert.equal(fixture.requests.length, 1);
    assert.equal(proxy.attempts.filter(attempt => attempt.allowed).length, 1);
    assert.ok(proxy.attempts.every(attempt => Object.keys(attempt).sort().join(',') === 'allowed,method,origin'));
    assert.ok(!JSON.stringify(proxy.attempts).includes('synthetic-secret'));
    assert.ok(!JSON.stringify(proxy.attempts).includes('/libre'));
    assert.deepEqual(fixture.violations, []);
});
