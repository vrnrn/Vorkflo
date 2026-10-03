import { z } from 'zod';

import type { JsonValue } from './artifact.js';

export const artifactKindSchema = z.enum([
  'text',
  'json',
  'filesystem-reference',
]);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    objectRecordSchema(z.string(), jsonValueSchema),
  ]),
);

const identifierSchema = z.string().trim().min(1);

const MAX_PROCESS_TIMEOUT_MS = 2_147_483_647;

export const processTemplateInputSchema = z.union([
  z
    .object({
      portId: identifierSchema,
    })
    .strict(),
  z
    .object({
      value: z.string(),
    })
    .strict(),
]);

const templateInputsSchema = objectRecordSchema(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
  processTemplateInputSchema,
);

const reservedEnvironmentVariableNames = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

export const environmentVariableNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Environment variable names must be portable identifiers.',
  )
  .refine(
    (name) => !reservedEnvironmentVariableNames.has(name),
    'Environment variable name is reserved.',
  );

export const inputPortSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    artifactKind: artifactKindSchema,
    required: z.boolean().default(true),
  })
  .strict();

export const outputPortSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    artifactKind: artifactKindSchema,
  })
  .strict();

const literalArgumentSchema = z
  .object({
    type: z.literal('literal'),
    value: z.string(),
  })
  .strict();

const inputArgumentSchema = z
  .object({
    type: z.literal('input'),
    portId: identifierSchema,
  })
  .strict();

const templateArgumentSchema = z
  .object({
    type: z.literal('template'),
    template: z.string(),
    inputs: templateInputsSchema,
  })
  .strict();

export const argumentSchema = z.discriminatedUnion('type', [
  literalArgumentSchema,
  inputArgumentSchema,
  templateArgumentSchema,
]);

const literalEnvironmentValueSchema = z
  .object({
    source: z.literal('literal'),
    value: z.string(),
  })
  .strict();

const hostEnvironmentValueSchema = z
  .object({
    source: z.literal('host'),
    name: environmentVariableNameSchema,
  })
  .strict();

const inputEnvironmentValueSchema = z
  .object({
    source: z.literal('input'),
    portId: identifierSchema,
  })
  .strict();

export const environmentValueSchema = z.discriminatedUnion('source', [
  literalEnvironmentValueSchema,
  hostEnvironmentValueSchema,
  inputEnvironmentValueSchema,
]);

type EnvironmentValue = z.infer<typeof environmentValueSchema>;

const environmentRecordSchema = objectRecordSchema(
  environmentVariableNameSchema,
  environmentValueSchema,
) as z.ZodType<Record<string, EnvironmentValue>>;

const stdinPortBindingSchema = z
  .object({
    portId: identifierSchema,
  })
  .strict();

const stdinTemplateBindingSchema = z
  .object({
    template: z.string(),
    inputs: templateInputsSchema,
  })
  .strict();

export const processStdinSchema = z.union([
  stdinPortBindingSchema,
  stdinTemplateBindingSchema,
]);

const stdoutOutputBindingSchema = z
  .object({
    type: z.literal('stdout'),
    portId: identifierSchema,
  })
  .strict();

const stderrOutputBindingSchema = z
  .object({
    type: z.literal('stderr'),
    portId: identifierSchema,
  })
  .strict();

const filesystemOutputBindingSchema = z
  .object({
    type: z.literal('filesystem'),
    portId: identifierSchema,
    path: z.string().trim().min(1),
    entity: z.enum(['file', 'directory', 'unknown']).optional(),
  })
  .strict();

export const outputBindingSchema = z.discriminatedUnion('type', [
  stdoutOutputBindingSchema,
  stderrOutputBindingSchema,
  filesystemOutputBindingSchema,
]);

const textWorkflowRunInputValueSchema = z
  .object({
    kind: z.literal('text'),
    value: z.string(),
  })
  .strict();

const jsonWorkflowRunInputValueSchema = z
  .object({
    kind: z.literal('json'),
    value: jsonValueSchema,
  })
  .strict();

const filesystemWorkflowRunInputValueSchema = z
  .object({
    kind: z.literal('filesystem-reference'),
    path: z.string().trim().min(1),
    entity: z.enum(['file', 'directory', 'unknown']).optional(),
  })
  .strict();

export const workflowRunInputValueSchema = z.discriminatedUnion('kind', [
  textWorkflowRunInputValueSchema,
  jsonWorkflowRunInputValueSchema,
  filesystemWorkflowRunInputValueSchema,
]);

export const workflowRunInputsSchema = objectRecordSchema(
  identifierSchema,
  workflowRunInputValueSchema,
);

export const workflowInputSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    artifactKind: artifactKindSchema,
    required: z.boolean(),
    defaultValue: workflowRunInputValueSchema.optional(),
  })
  .strict();

export const workflowInputBindingSchema = z
  .object({
    id: identifierSchema,
    inputId: identifierSchema,
    to: z
      .object({
        blockId: identifierSchema,
        portId: identifierSchema,
      })
      .strict(),
  })
  .strict();

export const processInvocationSchema = z
  .object({
    executable: z.string().trim().min(1),
    arguments: z.array(argumentSchema).default([]),
    workingDirectory: z.string().trim().min(1).optional(),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(MAX_PROCESS_TIMEOUT_MS)
      .optional(),
    environment: environmentRecordSchema
      .optional()
      .transform(
        (environment) => environment ?? nullPrototypeRecord<EnvironmentValue>(),
      ),
    stdin: processStdinSchema.optional(),
    shell: z.boolean().default(false),
    outputs: z.array(outputBindingSchema).default([]),
  })
  .strict();

export const processBlockSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1),
    kind: z.literal('process'),
    inputs: z.array(inputPortSchema).default([]),
    outputs: z.array(outputPortSchema).default([]),
    invocation: processInvocationSchema,
  })
  .strict();

export const connectionSchema = z
  .object({
    id: identifierSchema,
    from: z
      .object({
        blockId: identifierSchema,
        portId: identifierSchema,
      })
      .strict(),
    to: z
      .object({
        blockId: identifierSchema,
        portId: identifierSchema,
      })
      .strict(),
  })
  .strict();

const blockPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

type BlockPosition = z.infer<typeof blockPositionSchema>;

const blockPositionsSchema = objectRecordSchema(
  identifierSchema,
  blockPositionSchema,
) as z.ZodType<Record<string, BlockPosition>>;

const workflowDefinitionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifierSchema,
    name: z.string().trim().min(1),
    blocks: z.array(processBlockSchema),
    connections: z.array(connectionSchema),
    layout: z
      .object({
        blockPositions: blockPositionsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const editorMetadataSchema = objectRecordSchema(z.string(), jsonValueSchema);

export const workflowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: identifierSchema,
    name: z.string().trim().min(1),
    inputs: z.array(workflowInputSchema),
    inputBindings: z.array(workflowInputBindingSchema),
    blocks: z.array(processBlockSchema),
    connections: z.array(connectionSchema),
    layout: z
      .object({
        blockPositions: blockPositionsSchema,
      })
      .strict()
      .optional(),
    editor: editorMetadataSchema.optional(),
  })
  .strict();

const serializedWorkflowDefinitionSchema = z.discriminatedUnion(
  'schemaVersion',
  [workflowDefinitionV1Schema, workflowDefinitionSchema],
);

export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type InputPort = z.infer<typeof inputPortSchema>;
export type OutputPort = z.infer<typeof outputPortSchema>;
export type ProcessArgument = z.infer<typeof argumentSchema>;
export type ProcessTemplateInput = z.infer<typeof processTemplateInputSchema>;
export type ProcessStdin = z.infer<typeof processStdinSchema>;
export type ProcessInvocation = z.infer<typeof processInvocationSchema>;
export type ProcessBlock = z.infer<typeof processBlockSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type WorkflowRunInputValue = z.infer<typeof workflowRunInputValueSchema>;
export type WorkflowRunInputs = z.infer<typeof workflowRunInputsSchema>;
export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type WorkflowInputBinding = z.infer<typeof workflowInputBindingSchema>;
export type WorkflowDefinitionV1 = z.infer<typeof workflowDefinitionV1Schema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
  const workflow = serializedWorkflowDefinitionSchema.parse(input);
  return workflow.schemaVersion === 1
    ? migrateWorkflowDefinitionV1(workflow)
    : workflow;
}

export function migrateWorkflowDefinitionV1(
  workflow: WorkflowDefinitionV1,
): WorkflowDefinition {
  return {
    schemaVersion: 2,
    id: workflow.id,
    name: workflow.name,
    inputs: [],
    inputBindings: [],
    blocks: workflow.blocks,
    connections: workflow.connections,
    ...(workflow.layout === undefined ? {} : { layout: workflow.layout }),
  };
}

export function parseWorkflowRunInputs(input: unknown): WorkflowRunInputs {
  return workflowRunInputsSchema.parse(input);
}

const invalidRecordInput = Symbol('invalid-record-input');

function objectRecordSchema<Value>(
  keySchema: z.ZodType<string>,
  valueSchema: z.ZodType<Value>,
) {
  return z
    .preprocess(
      (input) => {
        if (
          typeof input !== 'object' ||
          input === null ||
          Array.isArray(input) ||
          !hasRecordPrototype(input) ||
          !hasOnlyEnumerableStringKeys(input)
        ) {
          return invalidRecordInput;
        }
        return Object.keys(input).map((key) => [
          key,
          (input as Record<string, unknown>)[key],
        ]);
      },
      z.array(z.tuple([keySchema, valueSchema])),
    )
    .transform((entries) => nullPrototypeRecord(entries));
}

function hasOnlyEnumerableStringKeys(input: object): boolean {
  return Reflect.ownKeys(input).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return (
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    );
  });
}

function hasRecordPrototype(input: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function nullPrototypeRecord<Value>(
  entries: readonly (readonly [string, Value])[] = [],
): Record<string, Value> {
  const record = Object.create(null) as Record<string, Value>;
  for (const [key, value] of entries) {
    record[key] = value;
  }
  return record;
}
