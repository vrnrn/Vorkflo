import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflow } from '../src/shared/defaults';
import { moveListItem, moveRecordEntry } from '../src/renderer/src/workflow';
import {
  readWorkflowFile,
  writeWorkflowFile,
} from '../src/main/workflow-files';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('workflow files', () => {
  it('round-trips structure, layout, and host environment references', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'workflow.vorkflo.json');
    const workflow = createWorkflow();

    await writeWorkflowFile(filePath, workflow);
    const loaded = await readWorkflowFile(filePath);
    const serialized = await readFile(filePath, 'utf8');

    expect(JSON.parse(JSON.stringify(loaded))).toEqual(
      JSON.parse(JSON.stringify(workflow)),
    );
    expect(serialized).toContain('"source": "host"');
    expect(serialized).toContain('"name": "PATH"');
    expect(serialized).not.toContain(process.env.PATH ?? '__missing_path__');
  });

  it('preserves edited connection, port, argument, and environment ordering', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'ordered.vorkflo.json');
    const base = createWorkflow();
    const source = base.blocks[0]!;
    const sink = {
      ...source,
      id: 'sink',
      name: 'Ordered sink',
      inputs: [
        {
          id: 'first',
          name: 'First',
          artifactKind: 'text' as const,
          required: true,
        },
        {
          id: 'second',
          name: 'Second',
          artifactKind: 'text' as const,
          required: true,
        },
      ],
      invocation: {
        ...source.invocation,
        arguments: [
          { type: 'input' as const, portId: 'first' },
          { type: 'input' as const, portId: 'second' },
        ],
        environment: {
          FIRST: { source: 'literal' as const, value: 'one' },
          SECOND: { source: 'literal' as const, value: 'two' },
          THIRD: { source: 'literal' as const, value: 'three' },
        },
      },
    };
    const secondSource = { ...source, id: 'second-source' };
    const connections = [
      {
        id: 'first-connection',
        from: { blockId: source.id, portId: 'stdout' },
        to: { blockId: sink.id, portId: 'first' },
      },
      {
        id: 'second-connection',
        from: { blockId: secondSource.id, portId: 'stdout' },
        to: { blockId: sink.id, portId: 'second' },
      },
    ];
    const edited = {
      ...base,
      blocks: [
        source,
        secondSource,
        {
          ...sink,
          inputs: moveListItem(sink.inputs, 0, 1),
          invocation: {
            ...sink.invocation,
            arguments: moveListItem(sink.invocation.arguments, 0, 1),
            environment: moveRecordEntry(sink.invocation.environment, 0, 2),
          },
        },
      ],
      connections: moveListItem(connections, 0, 1),
      layout: {
        blockPositions: {
          [source.id]: { x: 100, y: 100 },
          [secondSource.id]: { x: 100, y: 300 },
          [sink.id]: { x: 500, y: 200 },
        },
      },
    };

    await writeWorkflowFile(filePath, edited);
    const loaded = await readWorkflowFile(filePath);
    const loadedSink = loaded.blocks.find((block) => block.id === sink.id)!;

    expect(loaded.connections.map((connection) => connection.id)).toEqual([
      'second-connection',
      'first-connection',
    ]);
    expect(loadedSink.inputs.map((port) => port.id)).toEqual([
      'second',
      'first',
    ]);
    expect(
      loadedSink.invocation.arguments.map((argument) =>
        argument.type === 'input' ? argument.portId : argument.type,
      ),
    ).toEqual(['second', 'first']);
    expect(Object.keys(loadedSink.invocation.environment)).toEqual([
      'SECOND',
      'THIRD',
      'FIRST',
    ]);
  });

  it('rejects invalid workflow data without replacing an existing file', async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, 'workflow.vorkflo.json');
    const workflow = createWorkflow();
    await writeWorkflowFile(filePath, workflow);
    const before = await readFile(filePath, 'utf8');

    await expect(
      writeWorkflowFile(filePath, { ...workflow, schemaVersion: 99 }),
    ).rejects.toThrow();

    expect(await readFile(filePath, 'utf8')).toBe(before);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vorkflo-desktop-'));
  temporaryDirectories.push(directory);
  return directory;
}
