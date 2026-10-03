import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from '@vorkflo/engine';

export async function readWorkflowFile(
  filePath: string,
): Promise<WorkflowDefinition> {
  return parseWorkflowDefinition(JSON.parse(await readFile(filePath, 'utf8')));
}

export async function writeWorkflowFile(
  filePath: string,
  input: unknown,
): Promise<WorkflowDefinition> {
  const workflow = parseWorkflowDefinition(input);
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await writeFile(
      temporary,
      `${JSON.stringify(workflow, null, 2)}\n`,
      'utf8',
    );
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  return workflow;
}
