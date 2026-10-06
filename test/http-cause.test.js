import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '../src/http.js';

test('createHttp: komunikat „fetch failed” zawiera prawdziwą przyczynę z e.cause', async () => {
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }); };
  const http = createHttp({ fetchImpl, retries: 0 });
  await assert.rejects(() => http.text('https://example.test/x'), /fetch failed \(ECONNRESET: read ECONNRESET\) dla https:\/\/example\.test\/x/);
});
