import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureHttp } from '../src/http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(here, 'fixtures');
export const loadCfg = async () => JSON.parse(await readFile(path.join(here, '..', 'config', 'default.json'), 'utf8'));
export const fixtureHttp = async () => createFixtureHttp(JSON.parse(await readFile(path.join(fixturesDir, 'manifest.json'), 'utf8')), fixturesDir);
// 2026-10-02 17:40 czasu warszawskiego (CEST = UTC+2)
export const NOW = new Date('2026-10-02T15:40:00Z');
