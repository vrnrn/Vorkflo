import {
  createExecutionPlan,
  parseWorkflowDefinition,
  validateWorkflow,
} from '@vorkflo/engine';
import { describe, expect, it } from 'vitest';
import {
  autoArrangeWorkflow,
  reconcileProcessNodes,
} from '../src/renderer/src/workflow';
import {
  createV02RepresentativeDag,
  v02RepresentativeDagShape,
} from './fixtures/v0-2-representative-dag';

const coreTransformIterations = 200;
const reconciliationIterations = 1_000;
const coreTransformBudgetMs = 2_000;
const reconciliationBudgetMs = 2_000;

describe('v0.2 representative DAG performance acceptance', () => {
  it('locks the representative portable topology and execution layers', () => {
    const fixture = createV02RepresentativeDag();
    const parsed = parseWorkflowDefinition(
      JSON.parse(JSON.stringify(fixture)) as unknown,
    );

    expect(parsed.blocks).toHaveLength(v02RepresentativeDagShape.blockCount);
    expect(parsed.connections).toHaveLength(
      v02RepresentativeDagShape.connectionCount,
    );
    expect(validateWorkflow(parsed)).toEqual({ valid: true, issues: [] });
    expect(
      createExecutionPlan(parsed).layers.map((layer) => layer.length),
    ).toEqual(v02RepresentativeDagShape.layerSizes);
  });

  it('validates, plans, and explicitly arranges 200 fixture copies in under two seconds', () => {
    const fixture = createV02RepresentativeDag();

    // Warm up module and JIT paths before taking the acceptance measurement.
    validateWorkflow(fixture);
    createExecutionPlan(fixture);
    autoArrangeWorkflow(fixture);

    const startedAt = performance.now();
    for (let index = 0; index < coreTransformIterations; index += 1) {
      expect(validateWorkflow(fixture).valid).toBe(true);
      expect(createExecutionPlan(fixture).layers).toHaveLength(
        v02RepresentativeDagShape.layerSizes.length,
      );
      expect(
        Object.keys(autoArrangeWorkflow(fixture).layout?.blockPositions ?? {}),
      ).toHaveLength(v02RepresentativeDagShape.blockCount);
    }
    const durationMs = performance.now() - startedAt;

    expect(durationMs).toBeLessThan(coreTransformBudgetMs);
  });

  it('reconciles one thousand sustained graph updates without losing node identity', () => {
    const fixture = createV02RepresentativeDag();
    let nodes = reconcileProcessNodes(fixture, [], () => 'idle');
    const expectedIds = fixture.blocks.map((block) => block.id);

    const startedAt = performance.now();
    for (let index = 0; index < reconciliationIterations; index += 1) {
      nodes = reconcileProcessNodes(fixture, nodes, (blockId) =>
        blockId === expectedIds[index % expectedIds.length]
          ? 'running'
          : 'idle',
      );
    }
    const durationMs = performance.now() - startedAt;

    expect(nodes.map((node) => node.id)).toEqual(expectedIds);
    expect(new Set(nodes.map((node) => node.id))).toHaveLength(
      v02RepresentativeDagShape.blockCount,
    );
    expect(durationMs).toBeLessThan(reconciliationBudgetMs);
  });
});
