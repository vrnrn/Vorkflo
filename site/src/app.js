const scenarios = {
  report: {
    name: 'Parallel report',
    description: 'Four blocks. Two parallel branches. One final result.',
    nodes: [
      ['Draft a report', 'printf', 'PROCESS', 'terminal', 'TEXT'],
      ['Normalize text', 'tr', 'PROCESS', 'terminal', 'TEXT'],
      ['Count the words', 'wc', 'PROCESS', 'terminal', 'TEXT'],
      ['Assemble report', 'cat', 'PROCESS', 'file', 'TEXT'],
    ],
    output: 'GOOD TOOLS. GREAT TOGETHER.\nWord count: 4',
  },
  agents: {
    name: 'Agent workflow',
    description: 'A shared input. Two agent perspectives. One set of notes.',
    nodes: [
      ['Read the changes', 'git diff', 'PROCESS', 'branch', 'TEXT'],
      ['Review the code', 'codex', 'AI AGENT', 'agent', 'TEXT'],
      ['Suggest checks', 'cline', 'AI AGENT', 'agent', 'TEXT'],
      ['Collect the notes', 'cat', 'PROCESS', 'file', 'TEXT'],
    ],
    output: 'Review notes collected.\nSuggested checks ready for you to inspect.',
  },
  files: {
    name: 'File pipeline',
    description: 'One file. Parallel processing. A reusable result.',
    nodes: [
      ['Choose a clip', 'printf clip.mp4', 'PROCESS', 'file', 'TEXT'],
      ['Read metadata', 'ffprobe', 'PROCESS', 'terminal', 'JSON'],
      ['Create a preview', 'ffmpeg', 'PROCESS', 'terminal', 'FILE'],
      ['Build a manifest', 'python', 'PROCESS', 'file', 'JSON'],
    ],
    output: '{ "source": "clip.mp4", "preview": "preview.jpg" }',
  },
};

const demo = document.querySelector('.workflow-demo');
const nodes = [...demo.querySelectorAll('[data-node]')];
const controls = [...demo.querySelectorAll('[data-scenario]')];
const runButton = demo.querySelector('[data-run-demo]');
const runLabel = demo.querySelector('[data-run-label]');
const runState = demo.querySelector('[data-run-state]');
const status = demo.querySelector('[data-demo-status]');
const output = demo.querySelector('[data-demo-output]');
const wires = [...demo.querySelectorAll('[data-wire]')];
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
let current = 'report';
let timers = [];

function setNodeState(index, state) {
  nodes[index].dataset.state = state;
  nodes[index].querySelector('[data-node-status]').textContent = {
    ready: 'Ready',
    running: 'Running…',
    complete: 'Succeeded',
  }[state];
}

function resetRun() {
  timers.forEach(clearTimeout);
  timers = [];
  nodes.forEach((_, index) => setNodeState(index, 'ready'));
  wires.forEach((wire) => wire.classList.remove('is-complete'));
  runButton.disabled = false;
  runLabel.textContent = 'Run demo';
  runState.lastChild.textContent = 'Ready to run';
  output.hidden = true;
}

function selectScenario(key) {
  resetRun();
  current = key;
  const scenario = scenarios[key];
  const name = demo.querySelector('[data-demo-name]');
  name.replaceChildren(document.createTextNode(scenario.name));
  const extension = document.createElement('span');
  extension.className = 'file-extension';
  extension.textContent = '.vorkflo';
  name.append(extension);
  scenario.nodes.forEach(([title, command, type, icon, format], index) => {
    const node = nodes[index];
    node.querySelector('[data-node-title]').textContent = title;
    node.querySelector('[data-node-command]').textContent = command;
    node.querySelector('[data-node-type]').textContent = type;
    node.querySelector('[data-node-icon]').setAttribute('href', `#i-${icon}`);
    const port = node.querySelector('[data-node-output]');
    port.replaceChildren(document.createTextNode(`${format} `));
    const direction = document.createElement('span');
    direction.textContent = index === 3 ? '✓' : '→';
    port.append(direction);
  });
  controls.forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.scenario === key)),
  );
  status.textContent = scenario.description;
}

function finishRun() {
  nodes.forEach((_, index) => setNodeState(index, 'complete'));
  wires.forEach((wire) => wire.classList.add('is-complete'));
  demo.querySelector('[data-output-text]').textContent = scenarios[current].output;
  output.hidden = false;
  status.textContent = 'Demo complete. Every step is ready to inspect.';
  runState.lastChild.textContent = 'Run succeeded';
  runButton.disabled = false;
  runLabel.textContent = 'Run again';
  timers = [];
}

runButton.addEventListener('click', () => {
  resetRun();
  runButton.disabled = true;
  runLabel.textContent = 'Running…';
  runState.lastChild.textContent = 'Running demo';
  status.textContent = 'Simulating the workflow. No commands are executed.';
  if (motion.matches) {
    finishRun();
    return;
  }
  setNodeState(0, 'running');
  timers.push(
    setTimeout(() => {
      setNodeState(0, 'complete');
      wires[0].classList.add('is-complete');
      setNodeState(1, 'running');
      setNodeState(2, 'running');
    }, 650),
  );
  timers.push(
    setTimeout(() => {
      setNodeState(1, 'complete');
      setNodeState(2, 'complete');
      wires[1].classList.add('is-complete');
      setNodeState(3, 'running');
    }, 1450),
  );
  timers.push(setTimeout(finishRun, 2150));
});

controls.forEach((button) =>
  button.addEventListener('click', () => selectScenario(button.dataset.scenario)),
);
window.addEventListener('pagehide', resetRun);
demo.querySelector('[data-demo-controls]').hidden = false;
runButton.hidden = false;
