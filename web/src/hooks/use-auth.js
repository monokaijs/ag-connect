import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../config';

const TOKEN_KEY = 'ag-connect-token';

function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken() {
  return getStoredToken();
}

export function getAuthHeaders() {
  const token = getStoredToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  const checkStatus = useCallback(async () => {
    try {
      const headers = {};
      const token = getStoredToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${getApiBase()}/api/auth/status`, { headers });
      const data = await res.json();

      setInitialized(data.initialized);
      setAuthenticated(!!data.authenticated);
      setUser(data.user || null);
    } catch {
      setInitialized(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const setup = useCallback(async (username, password) => {
    const res = await fetch(`${getApiBase()}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Setup failed');
    setStoredToken(data.token);
    setInitialized(true);
    setAuthenticated(true);
    setUser(data.user);
    return data;
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${getApiBase()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setStoredToken(data.token);
    setAuthenticated(true);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setAuthenticated(false);
    setUser(null);
  }, []);

  return {
    loading,
    initialized,
    authenticated,
    user,
    setup,
    login,
    logout,
    checkStatus,
  };
}
