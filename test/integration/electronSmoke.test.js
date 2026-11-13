'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ELECTRON_BIN = require('electron');
const RUNNER_PATH = path.join(__dirname, 'electronRunner.js');

function killProcessTree(child, signal) {
    if (!child || !child.pid) return;
    try {
        process.kill(-child.pid, signal);
    } catch {
        try {
            child.kill(signal);
        } catch {
            // Ignore already-exited processes
        }
    }
}

function runProcess(command, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: ROOT_DIR,
            detached: true,
            env: {
                ...process.env,
                ELECTRON_ENABLE_LOGGING: '1',
                ...(opts.env || {})
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
            killProcessTree(child, 'SIGKILL');
            reject(new Error(`Timed out waiting for ${command} ${args.join(' ')}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        }, opts.timeoutMs || 25000);

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

test('Electron BaseWindow + WebContentsView overlays + sandboxed preload smoke test', async () => {
    assert.ok(fs.existsSync(ELECTRON_BIN), 'electron binary must be installed in node_modules');

    const result = await runProcess(ELECTRON_BIN, [RUNNER_PATH], {
        env: {
            ...process.env,
            ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
        }
    });
    assert.equal(
        result.code,
        0,
        `Smoke runner exited with ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
    assert.match(result.stdout, /ELECTRON_SMOKE_OK/);
});

test('Real main entrypoint boots headless (--tray) and accepts single-instance --toggle', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-home-'));
    const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-app-'));
    const env = {
        ...process.env,
        HOME: tmpHome,
        XDG_CONFIG_HOME: tmpHome,
        XDG_DATA_HOME: tmpHome,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    };

    const primary = spawn(
        ELECTRON_BIN,
        [ROOT_DIR, '--tray', '--dev', `--user-data-dir=${tmpData}`],
        { cwd: ROOT_DIR, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let primaryOut = '';
    let primaryErr = '';
    primary.stdout.on('data', (d) => { primaryOut += d.toString(); });
    primary.stderr.on('data', (d) => { primaryErr += d.toString(); });

    try {
        // Wait for primary instance to write its log file and claim the single-instance lock
        const deadline = Date.now() + 8000;
        const logDir = path.join(tmpData, 'logs');
        while (Date.now() < deadline) {
            if (primary.exitCode !== null) {
                throw new Error(
                    `Primary instance exited prematurely with ${primary.exitCode}\nSTDOUT:\n${primaryOut}\nSTDERR:\n${primaryErr}`
                );
            }
            if (fs.existsSync(logDir) && fs.readdirSync(logDir).length > 0) {
                break;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(
            fs.existsSync(logDir) && fs.readdirSync(logDir).length > 0,
            `Primary instance did not initialize userData logs.\nSTDOUT:\n${primaryOut}\nSTDERR:\n${primaryErr}`
        );

        // Give app.whenReady() a brief window to finish binding single-instance handler
        await new Promise((r) => setTimeout(r, 300));

        const secondary = await runProcess(
            ELECTRON_BIN,
            [ROOT_DIR, '--toggle', `--user-data-dir=${tmpData}`],
            { env, timeoutMs: 10000 }
        );
        assert.equal(
            secondary.code,
            0,
            `Secondary --toggle instance should exit 0.\nSTDOUT:\n${secondary.stdout}\nSTDERR:\n${secondary.stderr}`
        );
    } finally {
        killProcessTree(primary, 'SIGTERM');
        await new Promise((resolve) => {
            const killTimer = setTimeout(() => {
                killProcessTree(primary, 'SIGKILL');
                resolve();
            }, 3000);
            primary.once('exit', () => {
                clearTimeout(killTimer);
                resolve();
            });
        });
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpData, { recursive: true, force: true });
    }
});
