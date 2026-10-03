import { describe, expect, it, vi } from 'vitest';
import { createProcessBlock, createWorkflow } from '../src/shared/defaults';
import { addInputPort } from '../src/renderer/src/workflow';
import {
  addWorkflowInput,
  bindWorkflowInput,
  buildWorkflowRunInputs,
  parseRunInputValue,
  removeWorkflowInput,
  serializeRunInputValue,
  unbindWorkflowInput,
  updateWorkflowInput,
} from '../src/renderer/src/workflow-inputs';

describe('workflow inputs', () => {
  it('declares, updates, binds, unbinds, and removes portable inputs', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'binding-id' });
    const block = addInputPort(createProcessBlock('consumer'));
    let workflow = { ...createWorkflow(), blocks: [block] };
    const added = addWorkflowInput(workflow, 'json');
    workflow = updateWorkflowInput(added.workflow, {
      ...added.workflow.inputs[0]!,
      name: 'Configuration',
    });
    workflow = bindWorkflowInput(
      workflow,
      added.inputId,
      block.id,
      block.inputs[0]!.id,
    );

    expect(workflow.inputs[0]).toMatchObject({
      id: 'input-1',
      name: 'Configuration',
      artifactKind: 'json',
    });
    expect(workflow.inputBindings).toEqual([
      {
        id: 'binding-id',
        inputId: 'input-1',
        to: { blockId: 'consumer', portId: 'input-1' },
      },
    ]);
    expect(
      unbindWorkflowInput(workflow, block.id, block.inputs[0]!.id)
        .inputBindings,
    ).toEqual([]);
    expect(removeWorkflowInput(workflow, added.inputId)).toMatchObject({
      inputs: [],
      inputBindings: [],
    });
    vi.unstubAllGlobals();
  });

  it('parses and serializes all run input kinds', () => {
    expect(parseRunInputValue('text', ' hello ')).toEqual({
      kind: 'text',
      value: ' hello ',
    });
    expect(parseRunInputValue('json', '{"answer":42}')).toEqual({
      kind: 'json',
      value: { answer: 42 },
    });
    expect(parseRunInputValue('filesystem-reference', ' /tmp/file ')).toEqual({
      kind: 'filesystem-reference',
      path: '/tmp/file',
      entity: 'unknown',
    });
    expect(
      serializeRunInputValue({ kind: 'json', value: { answer: 42 } }),
    ).toBe('{\n  "answer": 42\n}');
  });

  it('validates required and malformed values before a run', () => {
    let workflow = addWorkflowInput(createWorkflow(), 'text').workflow;
    workflow = addWorkflowInput(workflow, 'json').workflow;
    workflow = addWorkflowInput(workflow, 'filesystem-reference').workflow;

    const missing = buildWorkflowRunInputs(workflow, {});
    expect(missing.valid).toBe(false);
    expect(Object.keys(missing.errors)).toEqual([
      'input-1',
      'input-2',
      'input-3',
    ]);

    const malformed = buildWorkflowRunInputs(workflow, {
      'input-1': 'first',
      'input-2': 'not json',
      'input-3': '/tmp/reference',
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.errors['input-2']).toBeDefined();

    const valid = buildWorkflowRunInputs(workflow, {
      'input-1': 'first',
      'input-2': '{"ok":true}',
      'input-3': '/tmp/reference',
    });
    expect(valid).toMatchObject({ valid: true, errors: {} });
    expect(valid.inputs).toEqual({
      'input-1': { kind: 'text', value: 'first' },
      'input-2': { kind: 'json', value: { ok: true } },
      'input-3': {
        kind: 'filesystem-reference',
        path: '/tmp/reference',
        entity: 'unknown',
      },
    });
  });
});
