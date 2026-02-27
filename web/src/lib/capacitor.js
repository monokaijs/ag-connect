import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

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
}
