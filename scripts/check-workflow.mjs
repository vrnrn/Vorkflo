#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import {
  createExecutionPlan,
  parseWorkflowDefinition,
  validateWorkflow,
} from '@vorkflo/engine';

const workflowPath = process.argv[2];

if (workflowPath === undefined) {
  console.error('Usage: npm run workflow:check -- <workflow-file>');
  process.exitCode = 2;
} else {
  try {
    const serialized = await readFile(workflowPath, 'utf8');
    const workflow = parseWorkflowDefinition(JSON.parse(serialized));
    const validation = validateWorkflow(workflow);

    if (!validation.valid) {
      for (const issue of validation.issues) {
        console.error(`${issue.code} ${issue.path}: ${issue.message}`);
      }
      process.exitCode = 1;
    } else {
      const plan = createExecutionPlan(workflow);
      console.log(`Valid workflow: ${workflow.name} (${workflow.id})`);
      console.log(`Blocks: ${workflow.blocks.length}`);
      console.log(`Execution layers: ${JSON.stringify(plan.layers)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to read workflow: ${message}`);
    process.exitCode = 1;
  }
}
