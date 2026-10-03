import { join } from 'node:path';
import type { ProcessArgument, WorkflowDefinition } from '@vorkflo/engine';
import {
  compileComputerUseBlock,
  getComputerUseBlockMetadataIssue,
  getComputerUseBlockPresentation,
} from '../shared/computer-use-runtime.js';
import {
  BUNDLED_IMAGE_REPORT,
  BUNDLED_MCP_PROXY,
} from '../shared/runtime-helpers.js';

/**
 * Keep saved workflows portable while binding application-owned helpers to the
 * installed bundle. Apply this same transform before preflight and execution so
 * the authority preview describes the exact process that will run.
 */
export function bindRuntimeHelpers(
  workflow: WorkflowDefinition,
  resourcesDirectory: string,
): WorkflowDefinition {
  const replacements = new Map([
    [
      BUNDLED_MCP_PROXY,
      join(resourcesDirectory, 'helpers/mcp-policy-proxy/src/cli.js'),
    ],
    [
      BUNDLED_IMAGE_REPORT,
      join(
        resourcesDirectory,
        'helpers/markdown-context-runner/src/image-report-cli.js',
      ),
    ],
  ]);
  return {
    ...workflow,
    blocks: workflow.blocks.map((savedBlock) => {
      const issue = getComputerUseBlockMetadataIssue(workflow, savedBlock.id);
      if (issue !== undefined) throw new Error(issue.message);
      const presentation = getComputerUseBlockPresentation(
        workflow,
        savedBlock.id,
      );
      if (presentation === undefined) return savedBlock;
      if (presentation.config.id !== savedBlock.id)
        throw new Error(
          'Computer Use presentation ID must match its block ID.',
        );
      // Editor metadata is the specialized contract. Recompile at the authority
      // boundary so a stale saved invocation cannot contradict the displayed task.
      const block = compileComputerUseBlock(presentation.config);
      return {
        ...block,
        invocation: {
          ...block.invocation,
          arguments: block.invocation.arguments.map(
            (argument): ProcessArgument => {
              if (argument.type !== 'literal') return argument;
              const direct = replacements.get(argument.value);
              if (direct !== undefined) return { ...argument, value: direct };
              // The MCP proxy path is embedded in a JSON argument array. Parse
              // that array rather than substituting inside arbitrary prompts.
              const prefix = `mcp_servers.${presentation.config.mcpServer}.args=`;
              if (!argument.value.startsWith(prefix)) return argument;
              const values: unknown = JSON.parse(
                argument.value.slice(prefix.length),
              );
              if (
                !Array.isArray(values) ||
                !values.every((value) => typeof value === 'string')
              )
                throw new Error(
                  'Computer Use MCP arguments must be a string array.',
                );
              return {
                ...argument,
                value:
                  prefix +
                  JSON.stringify(
                    values.map(
                      (value: string) => replacements.get(value) ?? value,
                    ),
                  ),
              };
            },
          ),
        },
      };
    }),
  };
}
