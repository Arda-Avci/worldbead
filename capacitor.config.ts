import type { CapacitorConfig } from '@capacitor/cli';

// NOTE: appId becomes the permanent store bundle id after the first upload. Change it before then if needed.
const config: CapacitorConfig = {
  appId: 'com.ardaavci.worldbead',
  appName: 'WorldBead',
  webDir: 'dist',
  backgroundColor: '#0b1a3a',
};

export default config;
