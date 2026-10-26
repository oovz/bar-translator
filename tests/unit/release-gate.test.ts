import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface Scenario {
    runs: string[];
    states: Record<string, string[]>;
    apiError?: number;
}

function runGate(scenario: Scenario, allowMissing = true) {
    const root = mkdtempSync(path.join(tmpdir(), 'release-ci-gate-'));
    try {
        const bin = path.join(root, 'bin');
        mkdirSync(bin);
        const stateFile = path.join(root, 'state.json');
        const output = path.join(root, 'output');
        const sha = 'a'.repeat(40);
        writeFileSync(stateFile, JSON.stringify({ ...scenario, sha, listCalls: 0, views: [] }));
        writeFileSync(output, '');
        writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "%s\\n" "$RESOLVED_COMMIT"\n', { mode: 0o755 });
        writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.RELEASE_GATE_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
if (state.apiError) process.exit(state.apiError);
if (args[0] === 'run' && args[1] === 'list') {
    if (args[args.indexOf('--commit') + 1] !== state.sha || args[args.indexOf('--workflow') + 1] !== 'ci.yml' || args[args.indexOf('--event') + 1] !== 'push') process.exit(9);
    const id = state.runs[Math.min(state.listCalls++, state.runs.length - 1)] || '';
    fs.writeFileSync(file, JSON.stringify(state));
    process.stdout.write(id + '\\n');
} else if (args[0] === 'run' && args[1] === 'view') {
    const id = args[2];
    const results = state.states[id];
    if (!results) process.exit(8);
    const result = results.length > 1 ? results.shift() : results[0];
    state.views.push(id);
    fs.writeFileSync(file, JSON.stringify(state));
    process.stdout.write(result + '\\n');
} else process.exit(9);
`, { mode: 0o755 });
        const result = spawnSync('bash', [path.resolve('.github/scripts/wait-for-ci.sh')], {
            encoding: 'utf8', timeout: 10_000,
            env: {
                ...process.env,
                PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
                GH_TOKEN: 'synthetic-token', GITHUB_REPOSITORY: 'example/repo',
                GITHUB_SHA: 'b'.repeat(40), RESOLVED_COMMIT: sha,
                GITHUB_OUTPUT: output, RELEASE_GATE_STATE: stateFile,
                CI_ALLOW_MISSING: String(allowMissing),
            },
        });
        return {
            status: result.status,
            output: readFileSync(output, 'utf8'),
            views: JSON.parse(readFileSync(stateFile, 'utf8')).views as string[],
        };
    } finally { rmSync(root, { recursive: true, force: true }); }
}

describe.skipIf(process.platform === 'win32')('Ubuntu release CI gate', () => {
    it('waits for success on the resolved tagged commit', () => {
        const result = runGate({ runs: ['100'], states: { '100': ['in_progress ', 'completed success'] } });
        expect(result.status).toBe(0);
        expect(result.output).toBe('run_checks=false\n');
        expect(result.views.length).toBeGreaterThanOrEqual(2);
    });

    it('blocks an older success when a newer matching run fails', () => {
        const result = runGate({
            runs: ['100', '100', '200'],
            states: { '100': ['in_progress ', 'completed success'], '200': ['completed failure'] },
        });
        expect(result.status).toBe(1);
        expect(result.output).toBe('');
        expect(result.views).toContain('200');
    });

    it('rechecks the latest run after observing success', () => {
        const result = runGate({
            runs: ['100', '100', '200'],
            states: { '100': ['completed success'], '200': ['completed failure'] },
        });
        expect(result.status).toBe(1);
        expect(result.output).toBe('');
        expect(result.views).toContain('200');
    });

    it.each([true, false])('requires fallback validation when CI is missing (allowed: %s)', allowMissing => {
        const result = runGate({ runs: [''], states: {} }, allowMissing);
        expect(result.status).toBe(allowMissing ? 0 : 1);
        expect(result.output).toBe(allowMissing ? 'run_checks=true\n' : '');
    });

    it('blocks API errors instead of treating them as absent CI', () => {
        const result = runGate({ runs: [], states: {}, apiError: 7 });
        expect(result.status).toBe(7);
        expect(result.output).toBe('');
    });
});
