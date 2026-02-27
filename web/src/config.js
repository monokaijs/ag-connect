import { isNative } from '@/lib/capacitor';

const protocol = window.location.protocol;
export const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
export const hostname = window.location.hostname;
export const isDev = window.location.port === '3000';

function getStoredEndpoint() {
  const raw = localStorage.getItem('ag_server_endpoint') || '';
  return raw.replace(/\/+$/, '');
}

export function setServerEndpoint(url) {
  localStorage.setItem('ag_server_endpoint', url.replace(/\/+$/, ''));
}

export function getServerEndpoint() {
  return getStoredEndpoint();
}

export function hasServerEndpoint() {
  return !!getStoredEndpoint();
}

const config = {
  get API_BASE() {
    if (isNative) return getStoredEndpoint();
    if (isDev) return `${protocol}//${hostname}:8787`;
    return '';
  },
  get WS_BASE() {
    if (isNative) {
      const ep = getStoredEndpoint();
      if (!ep) return '';
      const wsP = ep.startsWith('https') ? 'wss:' : 'ws:';
      const host = ep.replace(/^https?:\/\//, '');
      return `${wsP}//${host}`;
    }
    if (isDev) return `${wsProtocol}//${hostname}:8787`;
    return `${wsProtocol}//${window.location.host}`;
  },
};

export const API_BASE = !isNative ? (isDev ? `${protocol}//${hostname}:8787` : '') : '';
export const WS_BASE = !isNative ? (isDev ? `${wsProtocol}//${hostname}:8787` : `${wsProtocol}//${window.location.host}`) : '';

export function getApiBase() {
  return config.API_BASE;
}

export function getWsBase() {
  return config.WS_BASE;
}
