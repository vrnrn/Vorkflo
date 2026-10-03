import assert from 'node:assert/strict';
import test from 'node:test';
import { parseManifest } from '../src/manifest.js';

function manifest(): Record<string, unknown> {
  return {
    version: 1,
    upstream: { executable: '/absolute/browser-mcp', args: ['--stdio'] },
    environment: { inherit: ['PATH'] },
    policy: {
      allowedTools: ['browser_snapshot'],
      allowedHttpsOrigins: ['https://example.com'],
      maxToolCalls: 20,
    },
  };
}

test('manifest parsing rejects hidden authority and duplicate grants', () => {
  assert.throws(
    () => parseManifest({ ...manifest(), unexpected: true }),
    /Invalid manifest field: root/,
  );
  assert.throws(
    () =>
      parseManifest({
        ...manifest(),
        environment: { inherit: ['PATH', 'PATH'] },
      }),
    /unique identifiers/,
  );
  assert.throws(
    () =>
      parseManifest({
        ...manifest(),
        policy: {
          allowedTools: ['browser_snapshot', 'browser_snapshot'],
          allowedHttpsOrigins: ['https://example.com'],
          maxToolCalls: 20,
        },
      }),
    /Allowed tools must be unique/,
  );
});
