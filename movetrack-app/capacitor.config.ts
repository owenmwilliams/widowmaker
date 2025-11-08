import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zazendwell.app',
  appName: 'takestock',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
