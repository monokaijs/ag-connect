import { useState, useEffect, useCallback } from 'react';
import { isNative } from '@/lib/capacitor';
import { getApiBase } from '../config';
import { getAuthHeaders } from './use-auth';

function authFetch(url, opts = {}) {
  const headers = { ...getAuthHeaders(), ...(opts.headers || {}) };
  return fetch(url, { ...opts, headers });
}

export function usePushNotifications() {
  const [permissionStatus, setPermissionStatus] = useState('unknown');
  const [fcmToken, setFcmToken] = useState(null);

  const requestPermission = useCallback(async () => {
    if (!isNative) return;
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const result = await PushNotifications.requestPermissions();
      setPermissionStatus(result.receive);
      if (result.receive === 'granted') {
        await PushNotifications.register();
      }
    } catch { }
  }, []);

  const registerToken = useCallback(async (token) => {
    try {
      await authFetch(`${getApiBase()}/api/settings/push-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch { }
  }, []);

  useEffect(() => {
    if (!isNative) return;

    let cleanup = () => { };

    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.checkPermissions();
        setPermissionStatus(perm.receive);

        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
          const result = await PushNotifications.requestPermissions();
          setPermissionStatus(result.receive);
          if (result.receive === 'granted') {
            await PushNotifications.register();
          }
        } else if (perm.receive === 'granted') {
          await PushNotifications.register();
        }

        const regListener = await PushNotifications.addListener('registration', (token) => {
          setFcmToken(token.value);
          registerToken(token.value);
        });

        const errorListener = await PushNotifications.addListener('registrationError', () => { });

        const receivedListener = await PushNotifications.addListener(
          'pushNotificationReceived',
          () => { }
        );

        const actionListener = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          () => { }
        );

        cleanup = () => {
          regListener.remove();
          errorListener.remove();
          receivedListener.remove();
          actionListener.remove();
        };
      } catch { }
    })();

    return () => cleanup();
  }, [registerToken]);

  return { permissionStatus, fcmToken, requestPermission, isNative };
}
