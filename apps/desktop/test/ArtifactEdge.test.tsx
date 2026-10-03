import { cleanup, fireEvent, render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactEdge,
  findRoutedFileArtifact,
  type ArtifactEdgeData,
  type ArtifactFlowEdge,
} from '../src/renderer/src/ArtifactEdge';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    BaseEdge: () => <svg aria-hidden="true" />,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    getSmoothStepPath: () => ['M 0 0 L 100 100', 50, 50],
  };
});

describe('artifact connector edge', () => {
  afterEach(cleanup);

  it('routes only produced file artifacts from the connected source port', () => {
    const artifacts = [
      artifact('wrong-port', 'file', '/tmp/wrong.md'),
      artifact('report', 'directory', '/tmp/reports'),
      artifact('report', 'file', '/tmp/report.md'),
    ];

    expect(findRoutedFileArtifact(artifacts, 'report')?.path).toBe(
      '/tmp/report.md',
    );
    expect(findRoutedFileArtifact(artifacts, 'missing')).toBeUndefined();
  });

  it('opens the routed file from an accessible connector icon', () => {
    const onOpenFile = vi.fn();
    const { getByRole } = render(
      <ArtifactEdge
        {...edgeProps({
          filePath: '/tmp/report.md',
          fileLabel: 'Research report',
          onOpenFile,
        })}
      />,
    );

    fireEvent.click(
      getByRole('button', {
        name: 'Open Research report in default editor',
      }),
    );
    expect(onOpenFile).toHaveBeenCalledWith('/tmp/report.md');
  });

  it('does not add an icon before a file artifact exists', () => {
    const { queryByRole } = render(<ArtifactEdge {...edgeProps({})} />);
    expect(queryByRole('button')).not.toBeInTheDocument();
  });
});

function edgeProps(data: ArtifactEdgeData): EdgeProps<ArtifactFlowEdge> {
  return {
    id: 'source-to-destination',
    source: 'source',
    target: 'destination',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data,
  };
}

function artifact(portId: string, entity: 'file' | 'directory', path: string) {
  return {
    id: `run:source:${portId}:${entity}`,
    kind: 'filesystem-reference' as const,
    path,
    entity,
    provenance: {
      runId: 'run',
      blockId: 'source',
      portId,
      createdAt: '2026-07-21T21:00:00.000Z',
    },
  };
}
