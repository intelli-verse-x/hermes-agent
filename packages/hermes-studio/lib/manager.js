import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import path from 'node:path';
import { canonicalWorkspacePath, studioEndpoint, workspaceId } from './protocol.js';
export const DEFAULT_STUDIO_PREFERENCES = Object.freeze({
    mode: 'absent',
    externalExecutable: null,
    downloadConsentVersion: null
});
export function artifactForRuntime(manifest, platform, arch) {
    const artifact = manifest.artifacts.find(item => item.platform === platform && item.arch === arch);
    if (!artifact)
        throw new Error(`No Hermes Studio artifact for ${platform}/${arch}`);
    if (!artifact.url.startsWith('https://'))
        throw new Error('Studio artifacts require HTTPS');
    if (!/^[a-f0-9]{64}$/i.test(artifact.sha256))
        throw new Error('Invalid artifact digest');
    return artifact;
}
export function assertSafeArchiveEntries(entries) {
    for (const entry of entries) {
        const normalized = entry.replaceAll('\\', '/');
        if (normalized.startsWith('/') ||
            /^[a-z]:\//i.test(normalized) ||
            normalized.split('/').includes('..') ||
            normalized.includes('\0')) {
            throw new Error(`Unsafe archive entry: ${entry}`);
        }
    }
}
export function verifyArtifact(bytes, expectedSha256) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedSha256.toLowerCase())
        throw new Error('Studio artifact checksum mismatch');
}
export function verifyManifest(manifest, publicKeyPem) {
    const { signature, ...signed } = manifest;
    const canonical = Buffer.from(JSON.stringify(signed));
    const valid = verify(null, canonical, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
    if (!valid)
        throw new Error('Studio manifest signature invalid');
}
export function requireDownloadConsent(preferences, version) {
    if (preferences.mode !== 'managed' || preferences.downloadConsentVersion !== version) {
        throw new Error('Explicit Studio download consent is required');
    }
}
export class CrashBudget {
    maxRestarts;
    windowMs;
    now;
    #crashes = [];
    constructor(maxRestarts = 3, windowMs = 5 * 60_000, now = Date.now) {
        this.maxRestarts = maxRestarts;
        this.windowMs = windowMs;
        this.now = now;
    }
    recordCrash() {
        const current = this.now();
        while (this.#crashes[0] !== undefined && this.#crashes[0] < current - this.windowMs)
            this.#crashes.shift();
        this.#crashes.push(current);
        return this.#crashes.length <= this.maxRestarts;
    }
    reset() {
        this.#crashes.length = 0;
    }
}
export class StudioProcessSupervisor {
    spawnStudio;
    #child = null;
    budget;
    constructor(spawnStudio, budget = new CrashBudget()) {
        this.spawnStudio = spawnStudio;
        this.budget = budget;
    }
    get pid() {
        return this.#child?.pid ?? null;
    }
    launch(executable, args, env, onCrash) {
        if (this.#child && !this.#child.killed)
            return this.#child.pid ?? 0;
        this.#child = this.spawnStudio(executable, args, env);
        this.#child.once('exit', code => {
            this.#child = null;
            if (code !== 0 && code !== null)
                onCrash(this.budget.recordCrash());
        });
        return this.#child.pid ?? 0;
    }
    focus() {
        if (!this.#child?.pid)
            return false;
        this.#child.kill('SIGUSR1');
        return true;
    }
    stop() {
        this.#child?.kill('SIGTERM');
        this.#child = null;
    }
}
export class HermesStudioManager {
    userData;
    supervisor;
    preferences;
    #status = {
        state: 'absent',
        mode: 'absent',
        version: null,
        activeVersion: null,
        workspaceCanonicalPath: null,
        workspaceId: null,
        sessionId: null,
        windowId: null,
        pid: null,
        detail: 'Hermes Studio is optional and has not been configured.'
    };
    constructor(userData, supervisor, preferences = DEFAULT_STUDIO_PREFERENCES) {
        this.userData = userData;
        this.supervisor = supervisor;
        this.preferences = preferences;
    }
    status() {
        return { ...this.#status };
    }
    configureBringYourOwn(executable) {
        if (!path.isAbsolute(executable))
            throw new Error('Editor executable path must be absolute');
        this.preferences = { mode: 'bring-your-own', externalExecutable: executable, downloadConsentVersion: null };
        this.#status = { ...this.#status, state: 'available', mode: 'bring-your-own', detail: 'External Theia-compatible editor configured.' };
        return this.status();
    }
    consentManagedInstall(version) {
        this.preferences = { mode: 'managed', externalExecutable: null, downloadConsentVersion: version };
        return { ...this.preferences };
    }
    launch(input, executable, version) {
        if (!input.sessionId.trim() || !input.windowId.trim())
            throw new Error('Exact session and window identity are required');
        const workspaceCanonicalPath = canonicalWorkspacePath(input.workspacePath);
        const launchId = randomUUID();
        const endpoint = studioEndpoint(this.userData, launchId);
        const pid = this.supervisor.launch(executable, ['--workspace', workspaceCanonicalPath], {
            ...process.env,
            HERMES_STUDIO_ENDPOINT: endpoint,
            HERMES_STUDIO_SESSION_ID: input.sessionId,
            HERMES_STUDIO_WINDOW_ID: input.windowId
        }, restartAllowed => {
            this.#status = {
                ...this.#status,
                state: 'degraded',
                pid: null,
                detail: restartAllowed ? 'Studio crashed; restart is available.' : 'Studio crash budget exhausted; manual recovery required.'
            };
        });
        this.#status = {
            state: 'running',
            mode: this.preferences.mode,
            version,
            activeVersion: version,
            workspaceCanonicalPath,
            workspaceId: workspaceId(workspaceCanonicalPath),
            sessionId: input.sessionId,
            windowId: input.windowId,
            pid,
            detail: 'Hermes Studio is linked to this exact governed session.'
        };
        return this.status();
    }
    stop() {
        this.supervisor.stop();
        this.#status = { ...this.#status, state: 'stopped', pid: null, detail: 'Studio stopped; Hermes chat remains available.' };
        return this.status();
    }
}
