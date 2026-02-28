import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

const GITHUB_REPO = 'monokaijs/ag-connect';

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdate() {
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    await CapacitorUpdater.notifyAppReady();

    const current = await CapacitorUpdater.current();
    const currentVersion = current?.bundle?.version || __APP_VERSION__;

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return;
    const release = await res.json();

    const latestVersion = release.tag_name.replace(/^v/, '');
    if (compareVersions(latestVersion, currentVersion) <= 0) return;

    const asset = release.assets?.find(a => a.name === 'dist.zip');
    if (!asset) return;

    const bundle = await CapacitorUpdater.download({
      version: latestVersion,
      url: asset.browser_download_url,
    });

    await CapacitorUpdater.set(bundle);
  } catch { }
}

export async function initCapacitor() {
  if (!isNative) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#09090b' });
  } catch { }

  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    Keyboard.setScroll({ isDisabled: true });
  } catch { }

  checkForUpdate();
}
