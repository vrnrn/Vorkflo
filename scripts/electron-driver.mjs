import assert from 'node:assert/strict';

/** Small CDP client used only by explicit, isolated desktop acceptance scripts. */
export async function connectElectron(port = '9222') {
  assert.match(String(port), /^\d{1,5}$/u);
  assert.ok(Number(port) > 0 && Number(port) <= 65535);
  const targets = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(5_000),
  }).then((response) => response.json());
  const page = targets.find((target) => target.type === 'page');
  if (page?.webSocketDebuggerUrl === undefined)
    throw new Error(`No Electron page target found on CDP port ${port}.`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const exceptions = [];
  let nextId = 1;
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(String(data));
    if (response.method === 'Runtime.exceptionThrown')
      exceptions.push(response.params.exceptionDetails.text);
    const request = pending.get(response.id);
    if (request === undefined) return;
    pending.delete(response.id);
    clearTimeout(request.timeout);
    if (response.error !== undefined)
      request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Electron debugging connection closed.'));
    }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  function command(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Electron command ${method} timed out.`));
      }, 15_000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails !== undefined)
      throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression, description, attempts = 200) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if ((await evaluate(expression)) === true) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }
  return {
    command,
    evaluate,
    waitFor,
    exceptions,
    close: () => socket.close(),
    page,
  };
}
