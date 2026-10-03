import type { ArtifactKind } from './schema.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface BlockOutputArtifactProvenance {
  readonly runId: string;
  readonly blockId: string;
  readonly portId: string;
  readonly createdAt: string;
}

export interface WorkflowInputArtifactProvenance {
  readonly source: 'workflow-input';
  readonly runId: string;
  readonly inputId: string;
  readonly createdAt: string;
  readonly valueSource: 'supplied' | 'default';
}

export type ArtifactProvenance =
  BlockOutputArtifactProvenance | WorkflowInputArtifactProvenance;

interface ArtifactBase {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly provenance: ArtifactProvenance;
}

export interface TextArtifact extends ArtifactBase {
  readonly kind: 'text';
  readonly value: string;
}

export interface JsonArtifact extends ArtifactBase {
  readonly kind: 'json';
  readonly value: JsonValue;
}

export interface FilesystemReferenceArtifact extends ArtifactBase {
  readonly kind: 'filesystem-reference';
  readonly path: string;
  readonly entity: 'file' | 'directory' | 'unknown';
}

export type Artifact =
  TextArtifact | JsonArtifact | FilesystemReferenceArtifact;
