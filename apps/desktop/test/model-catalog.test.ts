import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_USER_MODEL_CATALOG,
  loadUserModelCatalog,
  parseUserModelCatalog,
} from '../src/main/model-catalog';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('user model catalog', () => {
  it('creates an empty user-owned file without embedding model identifiers', async () => {
    const home = await temporaryHome();
    const result = await loadUserModelCatalog(home);

    expect(result).toEqual({
      filePath: join(home, '.vorkflo', 'models.json'),
      catalog: EMPTY_USER_MODEL_CATALOG,
    });
    expect(JSON.parse(await readFile(result.filePath, 'utf8'))).toEqual(
      EMPTY_USER_MODEL_CATALOG,
    );
  });

  it('accepts per-tool defaults only when they name configured models', () => {
    expect(
      parseUserModelCatalog(
        JSON.stringify({
          schemaVersion: 1,
          codex: { default: 'test/primary', models: ['test/primary'] },
          cline: { models: ['test/reviewer'] },
          agy: { models: ['Test Model (High)'] },
        }),
      ),
    ).toMatchObject({
      codex: { default: 'test/primary', models: ['test/primary'] },
    });

    expect(() =>
      parseUserModelCatalog(
        JSON.stringify({
          schemaVersion: 1,
          codex: { default: 'test/missing', models: ['test/primary'] },
          cline: { models: [] },
          agy: { models: [] },
        }),
      ),
    ).toThrow('codex.default must name a model in codex.models');
  });

  it('preserves an invalid file and returns an actionable empty catalog', async () => {
    const home = await temporaryHome();
    const settings = join(home, '.vorkflo');
    await mkdir(settings, { recursive: true });
    const filePath = join(settings, 'models.json');
    await writeFile(filePath, '{ invalid json', 'utf8');

    const result = await loadUserModelCatalog(home);
    expect(result.catalog).toEqual(EMPTY_USER_MODEL_CATALOG);
    expect(result.issue).toContain('No configured models will be offered');
    expect(await readFile(filePath, 'utf8')).toBe('{ invalid json');
  });

  it('accepts user-owned Codex intelligence profiles only with exact visible settings', () => {
    const catalog = parseUserModelCatalog(
      JSON.stringify({
        schemaVersion: 1,
        codex: {
          models: ['local/chief', 'local/fast'],
          intelligenceProfiles: [
            {
              name: 'highest intelligence',
              model: 'local/chief',
              reasoningEffort: 'xhigh',
            },
          ],
        },
        cline: { models: [] },
        agy: { models: [] },
      }),
    );
    expect(catalog.codex.intelligenceProfiles).toEqual([
      {
        name: 'highest intelligence',
        model: 'local/chief',
        reasoningEffort: 'xhigh',
      },
    ]);

    expect(() =>
      parseUserModelCatalog(
        JSON.stringify({
          schemaVersion: 1,
          codex: {
            models: ['local/chief'],
            intelligenceProfiles: [
              {
                name: 'highest intelligence',
                model: 'hidden/provider-model',
                reasoningEffort: 'xhigh',
              },
            ],
          },
          cline: { models: [] },
          agy: { models: [] },
        }),
      ),
    ).toThrow('requires a unique non-empty name');
  });
});

async function temporaryHome(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'vorkflo-models-'));
  temporaryRoots.push(path);
  return path;
}
