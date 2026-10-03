/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.vorkflo.desktop',
  productName: 'Vorkflo',
  artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  asar: true,
  forceCodeSigning: false,
  extraResources: [
    {
      from: 'resources/helpers',
      to: 'helpers',
      filter: ['**/*.js', '**/package.json'],
    },
  ],
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'out/**/*',
    'package.json',
    '!node_modules/@vorkflo/*/src{,/**/*}',
    '!node_modules/@vorkflo/*/test{,/**/*}',
    '!node_modules/@vorkflo/*/dist/test{,/**/*}',
    '!node_modules/@vorkflo/**/*.map',
    '!node_modules/@vorkflo/*/tsconfig.json',
    '!node_modules/@types{,/**/*}',
    '!node_modules/**/*.map',
    '!out/**/*.map',
  ],
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
    minimumSystemVersion: '12.0',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    target: ['dmg', 'zip'],
  },
  dmg: {
    title: '${productName} ${version}',
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' },
    ],
  },
};
