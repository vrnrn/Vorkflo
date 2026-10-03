import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';
import {
  applyApplicationIdentity,
  DESKTOP_APPLICATION_NAME,
} from '../src/main/application-identity';

interface MacBuildConfiguration {
  readonly appId?: string;
  readonly productName?: string;
  readonly artifactName?: string;
  readonly asar?: boolean;
  readonly forceCodeSigning?: boolean;
  readonly files?: readonly string[];
  readonly mac?: {
    readonly icon?: string;
    readonly minimumSystemVersion?: string;
    readonly hardenedRuntime?: boolean;
    readonly notarize?: boolean;
    readonly target?: readonly string[];
  };
}

const require = createRequire(import.meta.url);

describe('macOS release policy', () => {
  it('locks the versioned unsigned packaging surface', () => {
    const configuration =
      require('../electron-builder.config.cjs') as MacBuildConfiguration;

    expect(configuration).toMatchObject({
      appId: 'app.vorkflo.desktop',
      productName: DESKTOP_APPLICATION_NAME,
      artifactName: '${productName}-${version}-mac-${arch}.${ext}',
      asar: true,
      forceCodeSigning: false,
      mac: {
        icon: 'build/icon.icns',
        minimumSystemVersion: '12.0',
        hardenedRuntime: false,
        notarize: false,
        target: ['dmg', 'zip'],
      },
    });
    expect(configuration.files).toContain('!node_modules/@types{,/**/*}');
    expect(configuration.files).toContain('!node_modules/**/*.map');
  });

  it('uses the public product name for the runtime application menu', () => {
    const application = { setName: vi.fn() };

    applyApplicationIdentity(application);

    expect(application.setName).toHaveBeenCalledWith('Vorkflo');
  });

  it('keeps the official release command credential-free and checksum-producing', () => {
    const packageFile = require('../package.json') as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    expect(packageFile.scripts['release:mac:build']).toContain(
      'npm run release:mac:clean',
    );
    expect(packageFile.scripts['release:mac:build']).toContain('--arm64');
    expect(packageFile.scripts['release:mac:build']).not.toContain('--x64');
    expect(packageFile.scripts['verify:mac:release']).toContain(
      '--unsigned --architectures=arm64 --write-manifest',
    );
  });
});
