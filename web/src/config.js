const protocol = window.location.protocol;
export const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
export const hostname = window.location.hostname;

export const isDev = window.location.port === '3000';
export const API_BASE = isDev ? `${protocol}//${hostname}:8787` : '';
export const WS_BASE = isDev ? `${wsProtocol}//${hostname}:8787` : `${wsProtocol}//${window.location.host}`;
