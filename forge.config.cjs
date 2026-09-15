module.exports = {
  packagerConfig: {
    name: 'Guitar Markdown Studio',
    executableName: 'guitar-markdown-studio',
    appBundleId: 'com.exostic.guitarmarkdownstudio',
    appCategoryType: 'public.app-category.music',
    // macOS asks the user before the tuner can use the microphone.
    extendInfo: { NSMicrophoneUsageDescription: "L'accordeur écoute votre guitare pour vous aider à l'accorder." },
    asar: true,
    ignore: [
      /^\/\.git($|\/)/,
      /^\/out($|\/)/,
      /^\/examples($|\/)/,
      /^\/packages\/exporter-pdf($|\/)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'guitar_markdown_studio',
        setupExe: 'Guitar-Markdown-Studio-Setup.exe',
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
};
