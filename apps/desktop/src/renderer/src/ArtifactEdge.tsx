import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { FileText } from 'lucide-react';
import type { Artifact, FilesystemReferenceArtifact } from '@vorkflo/engine';

export interface ArtifactEdgeData extends Record<string, unknown> {
  readonly filePath?: string;
  readonly fileLabel?: string;
  readonly onOpenFile?: (path: string) => void;
}

export type ArtifactFlowEdge = Edge<ArtifactEdgeData, 'artifact'>;

export function findRoutedFileArtifact(
  artifacts: readonly Artifact[],
  portId: string,
): FilesystemReferenceArtifact | undefined {
  return artifacts.find(
    (candidate): candidate is FilesystemReferenceArtifact =>
      candidate.kind === 'filesystem-reference' &&
      candidate.entity !== 'directory' &&
      'portId' in candidate.provenance &&
      candidate.provenance.portId === portId,
  );
}

export const ArtifactEdge = memo(function ArtifactEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  data,
}: EdgeProps<ArtifactFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const filePath = data?.filePath;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerStart === undefined ? {} : { markerStart })}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(style === undefined ? {} : { style })}
      />
      {filePath !== undefined && data?.onOpenFile !== undefined && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="artifact-edge-file-button nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            aria-label={`Open ${data.fileLabel ?? 'file output'} in default editor`}
            title={`${filePath}\nOpen in default editor`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenFile?.(filePath);
            }}
          >
            <FileText size={13} aria-hidden="true" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
