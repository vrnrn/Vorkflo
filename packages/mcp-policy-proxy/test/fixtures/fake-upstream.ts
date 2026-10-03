import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const pidFile = process.env['TEST_PID_FILE'];
if (pidFile !== undefined) {
  const grandchild = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    {
      stdio: 'ignore',
    },
  );
  await writeFile(
    pidFile,
    `${process.pid}\n${String(grandchild.pid)}\n`,
    'utf8',
  );
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line) as {
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: {
        forwarded: true,
        method: request.method,
        params: request.params,
        environment: {
          allowed: process.env['ALLOWED_TEST_VALUE'],
          secret: process.env['SECRET_NOT_ALLOWED'],
        },
      },
    })}\n`,
  );
});
