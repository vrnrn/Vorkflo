import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  UserModelCatalog,
  UserModelCatalogResult,
} from '../shared/contracts.js';

const maximumCatalogBytes = 256 * 1024;

export const EMPTY_USER_MODEL_CATALOG: UserModelCatalog = {
  schemaVersion: 1,
  codex: { models: [] },
  cline: { models: [] },
  agy: { models: [] },
};

export async function loadUserModelCatalog(
  homeDirectory: string,
): Promise<UserModelCatalogResult> {
  const settingsDirectory = join(homeDirectory, '.vorkflo');
  const filePath = join(settingsDirectory, 'models.json');
  await mkdir(settingsDirectory, { recursive: true });
  try {
    await writeFile(
      filePath,
      `${JSON.stringify(EMPTY_USER_MODEL_CATALOG, undefined, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  try {
    const serialized = await readFile(filePath, 'utf8');
    if (Buffer.byteLength(serialized, 'utf8') > maximumCatalogBytes) {
      throw new Error('models.json exceeds the 256 KiB settings limit.');
    }
    return { filePath, catalog: parseUserModelCatalog(serialized) };
  } catch (error) {
    return {
      filePath,
      catalog: EMPTY_USER_MODEL_CATALOG,
      issue: `Could not load ${filePath}: ${errorMessage(error)} No configured models will be offered until the file is corrected.`,
    };
  }
}

export function parseUserModelCatalog(serialized: string): UserModelCatalog {
  const input: unknown = JSON.parse(serialized);
  if (!isRecord(input) || input.schemaVersion !== 1) {
    throw new Error('models.json must be an object with schemaVersion 1.');
  }
  const allowedKeys = new Set(['schemaVersion', 'codex', 'cline', 'agy']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new Error('models.json contains an unsupported field.');
  }
  return {
    schemaVersion: 1,
    codex: parseToolCatalog(input.codex, 'codex'),
    cline: parseToolCatalog(input.cline, 'cline'),
    agy: parseToolCatalog(input.agy, 'agy'),
  };
}

function parseToolCatalog(
  input: unknown,
  tool: string,
): UserModelCatalog['codex'] {
  if (!isRecord(input)) {
    throw new Error(`${tool} must contain a models array.`);
  }
  const allowedFields =
    tool === 'codex'
      ? ['default', 'models', 'intelligenceProfiles']
      : ['default', 'models'];
  if (Object.keys(input).some((key) => !allowedFields.includes(key))) {
    throw new Error(`${tool} contains an unsupported field.`);
  }
  if (!Array.isArray(input.models)) {
    throw new Error(`${tool}.models must be an array of model strings.`);
  }
  const models = input.models.map((model) => {
    if (typeof model !== 'string' || model.trim() === '') {
      throw new Error(`${tool}.models contains an empty or non-string model.`);
    }
    return model;
  });
  if (new Set(models).size !== models.length) {
    throw new Error(`${tool}.models contains duplicate models.`);
  }
  if (
    input.default !== undefined &&
    (typeof input.default !== 'string' || !models.includes(input.default))
  ) {
    throw new Error(`${tool}.default must name a model in ${tool}.models.`);
  }
  const intelligenceProfiles =
    tool === 'codex'
      ? parseIntelligenceProfiles(input.intelligenceProfiles, models)
      : undefined;
  return {
    models,
    ...(input.default === undefined ? {} : { default: input.default }),
    ...(intelligenceProfiles === undefined ? {} : { intelligenceProfiles }),
  };
}

function parseIntelligenceProfiles(
  input: unknown,
  models: readonly string[],
):
  | readonly {
      readonly name: string;
      readonly model: string;
      readonly reasoningEffort: string;
    }[]
  | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    throw new Error('codex.intelligenceProfiles must be an array.');
  }
  const profiles = input.map((profile) => {
    if (
      !isRecord(profile) ||
      Object.keys(profile).some(
        (key) => !['name', 'model', 'reasoningEffort'].includes(key),
      ) ||
      typeof profile.name !== 'string' ||
      profile.name.trim() === '' ||
      typeof profile.model !== 'string' ||
      !models.includes(profile.model) ||
      typeof profile.reasoningEffort !== 'string' ||
      profile.reasoningEffort.trim() === ''
    ) {
      throw new Error(
        'Each codex intelligence profile requires a unique non-empty name, a model from codex.models, and an exact non-empty reasoningEffort.',
      );
    }
    return {
      name: profile.name,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
    };
  });
  if (
    new Set(profiles.map((profile) => profile.name)).size !== profiles.length
  ) {
    throw new Error('codex.intelligenceProfiles contains duplicate names.');
  }
  return profiles;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && error.code === 'EEXIST';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
