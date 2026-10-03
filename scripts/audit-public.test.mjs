import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPublicText } from './audit-public.mjs';

test('reports sensitive locations without exposing detected values', () => {
  const credential = ['gh', 'p_', 'x'.repeat(30)].join('');
  const issues = inspectPublicText('fixture.txt', `header\n${credential}\n`);
  assert.deepEqual(issues, [
    { path: 'fixture.txt', line: 2, rule: 'github-token' },
  ]);
  assert.ok(!JSON.stringify(issues).includes(credential));
});
test('rejects real home paths and emails but permits synthetic fixtures', () => {
  const home = ['/', 'Users', '/', 'private-person', '/', 'project'].join('');
  const email = ['private-person', '@', 'mail.test'].join('');
  assert.deepEqual(
    inspectPublicText('fixture.txt', `${home}\n${email}`).map(
      (issue) => issue.rule,
    ),
    ['personal-home-path', 'personal-email'],
  );
  assert.deepEqual(
    inspectPublicText(
      'test.ts',
      '/home/test/.vorkflo/models.json\ntest@vorkflo.invalid',
    ),
    [],
  );
});
test('detects credential URLs outside controlled rejection tests', () => {
  const url = ['https://', 'user', ':', 'password', '@', 'example.com/'].join(
    '',
  );
  assert.equal(inspectPublicText('README.md', url)[0].rule, 'credential-url');
  assert.deepEqual(inspectPublicText('apps/desktop/test/url.test.ts', url), []);
});
