import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Loader2, Upload, LogOut, User, Bell, Server, Flame, CheckCircle2, XCircle } from 'lucide-react';
import { getApiBase, getServerEndpoint, setServerEndpoint } from '../config';
import { getAuthHeaders } from '../hooks/use-auth';
import { isNative } from '@/lib/capacitor';

function authFetch(url, opts = {}) {
  const headers = { ...getAuthHeaders(), ...(opts.headers || {}) };
  return fetch(url, { ...opts, headers });
}

export default function SettingsPage({ auth, push }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [saving, setSaving] = useState(false);

  const [firebaseStatus, setFirebaseStatus] = useState(null);
  const [serviceAccount, setServiceAccount] = useState('');
  const [savingFirebase, setSavingFirebase] = useState(false);
  const [firebaseError, setFirebaseError] = useState('');
  const [showFirebaseForm, setShowFirebaseForm] = useState(false);

  const [serverUrl, setServerUrl] = useState(getServerEndpoint() || '');

  const fetchKeys = useCallback(async () => {
    try {
      const res = await authFetch(`${getApiBase()}/api/settings/ssh-keys`);
      const data = await res.json();
      setKeys(data);
    } catch { }
    setLoading(false);
  }, []);

  const fetchFirebaseStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${getApiBase()}/api/settings/firebase`);
      const data = await res.json();
      setFirebaseStatus(data);
    } catch { }
  }, []);

  useEffect(() => { fetchKeys(); fetchFirebaseStatus(); }, [fetchKeys, fetchFirebaseStatus]);

  const addKey = async () => {
    if (!name.trim() || !privateKey.trim()) return;
    setSaving(true);
    try {
      await authFetch(`${getApiBase()}/api/settings/ssh-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), privateKey, publicKey }),
      });
      setName('');
      setPrivateKey('');
      setPublicKey('');
      setShowAdd(false);
      fetchKeys();
    } catch { }
    setSaving(false);
  };

  const deleteKey = async (id) => {
    if (!confirm('Delete this SSH key?')) return;
    try {
      await authFetch(`${getApiBase()}/api/settings/ssh-keys/${id}`, { method: 'DELETE' });
      fetchKeys();
    } catch { }
  };

  const handleFileUpload = (e, setter) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result);
    reader.readAsText(file);
  };

  const saveFirebase = async () => {
    if (!serviceAccount.trim()) return;
    setSavingFirebase(true);
    setFirebaseError('');
    try {
      const res = await authFetch(`${getApiBase()}/api/settings/firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceAccount: serviceAccount.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFirebaseError(data.error || 'Failed to save');
      } else {
        setServiceAccount('');
        setShowFirebaseForm(false);
        fetchFirebaseStatus();
      }
    } catch {
      setFirebaseError('Network error');
    }
    setSavingFirebase(false);
  };

  const removeFirebase = async () => {
    if (!confirm('Remove Firebase configuration? Push notifications will stop working.')) return;
    try {
      await authFetch(`${getApiBase()}/api/settings/firebase`, { method: 'DELETE' });
      fetchFirebaseStatus();
    } catch { }
  };

  const saveServerUrl = () => {
    const cleaned = serverUrl.trim().replace(/\/+$/, '');
    if (cleaned) {
      setServerEndpoint(cleaned);
      window.location.reload();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full p-6">
        <h1 className="text-lg font-semibold text-white mb-1">Settings</h1>
        <p className="text-xs text-zinc-500 mb-6">Manage your AG Connect configuration</p>

        {auth?.user && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-zinc-400" />
              <h2 className="text-sm font-medium text-white">Account</h2>
            </div>
            <div className="flex items-center justify-between bg-zinc-900 border border-white/5 rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
                  {auth.user.username?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{auth.user.username}</div>
                  <div className="text-[10px] text-zinc-500">Administrator</div>
                </div>
              </div>
              <button
                onClick={() => { if (confirm('Sign out of AG Connect?')) auth.logout(); }}
                className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg border border-red-500/20 transition-colors"
              >
                <LogOut className="w-3 h-3" />
                Sign Out
              </button>
            </div>
          </div>
        )}

        {isNative && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Server className="w-4 h-4 text-zinc-400" />
              <h2 className="text-sm font-medium text-white">Server</h2>
            </div>
            <div className="bg-zinc-900 border border-white/5 rounded-lg p-4">
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Server URL</label>
              <div className="flex gap-2">
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://4123.xomnghien.com"
                  className="flex-1 h-8 px-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50"
                />
                <button
                  onClick={saveServerUrl}
                  disabled={!serverUrl.trim()}
                  className="h-8 px-3 text-[11px] font-medium bg-indigo-500 text-white hover:bg-indigo-400 rounded-lg transition-colors disabled:opacity-40"
                >
                  Save
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1.5">Changing this will reload the app.</p>
            </div>
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-zinc-400" />
            <h2 className="text-sm font-medium text-white">Push Notifications</h2>
          </div>
          <p className="text-[11px] text-zinc-500 mb-4">
            Configure Firebase Cloud Messaging to receive push notifications when agent tasks complete.
          </p>

          {firebaseStatus && (
            <div className="flex items-center gap-3 bg-zinc-900 border border-white/5 rounded-lg px-4 py-3 mb-3">
              {firebaseStatus.configured ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white">Firebase configured</div>
                    <div className="text-[10px] text-zinc-500">{firebaseStatus.tokenCount} device(s) registered</div>
                  </div>
                  <button
                    onClick={removeFirebase}
                    className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-zinc-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-400">Firebase not configured</div>
                    <div className="text-[10px] text-zinc-500">Add a service account to enable push notifications</div>
                  </div>
                </>
              )}
            </div>
          )}

          {push?.isNative && (
            <div className="flex items-center gap-3 bg-zinc-900 border border-white/5 rounded-lg px-4 py-3 mb-3">
              <Bell className="w-4 h-4 text-zinc-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-300">Notification Permission</div>
                <div className="text-[10px] text-zinc-500">
                  {push.permissionStatus === 'granted' ? 'Granted' :
                    push.permissionStatus === 'denied' ? 'Denied — enable in device settings' :
                      'Not requested yet'}
                </div>
              </div>
              {push.permissionStatus !== 'granted' && push.permissionStatus !== 'denied' && (
                <button
                  onClick={push.requestPermission}
                  className="h-7 px-3 text-[11px] font-medium bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-lg transition-colors"
                >
                  Request
                </button>
              )}
            </div>
          )}

          {!showFirebaseForm && (!firebaseStatus?.configured) && (
            <button
              onClick={() => setShowFirebaseForm(true)}
              className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-lg transition-colors"
            >
              <Flame className="w-3 h-3" />
              Add Firebase Service Account
            </button>
          )}

          {showFirebaseForm && (
            <div className="bg-zinc-900 border border-white/10 rounded-lg p-4 mt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-medium text-zinc-400">Service Account JSON</label>
                <label className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors">
                  <Upload className="w-3 h-3" />
                  Upload
                  <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, setServiceAccount)} />
                </label>
              </div>
              <textarea
                value={serviceAccount}
                onChange={(e) => setServiceAccount(e.target.value)}
                placeholder='{"type": "service_account", "project_id": "...", ...}'
                rows={6}
                className="w-full px-3 py-2 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 font-mono resize-none mb-3"
              />
              {firebaseError && (
                <p className="text-[11px] text-red-400 mb-3">{firebaseError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowFirebaseForm(false); setServiceAccount(''); setFirebaseError(''); }}
                  className="h-7 px-3 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveFirebase}
                  disabled={!serviceAccount.trim() || savingFirebase}
                  className="h-7 px-3 text-[11px] font-medium bg-indigo-500 text-white hover:bg-indigo-400 rounded-lg transition-colors disabled:opacity-40"
                >
                  {savingFirebase ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-zinc-400" />
              <h2 className="text-sm font-medium text-white">SSH Keys</h2>
              <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">{keys.length}</span>
            </div>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-lg transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add Key
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mb-4">SSH keys are synced to workspace containers on startup for Git authentication.</p>

          {showAdd && (
            <div className="bg-zinc-900 border border-white/10 rounded-lg p-4 mb-4">
              <div className="mb-3">
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Key Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. github, gitlab, id_rsa"
                  className="w-full h-8 px-3 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50"
                />
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-zinc-400">Private Key</label>
                  <label className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors">
                    <Upload className="w-3 h-3" />
                    Upload
                    <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, setPrivateKey)} />
                  </label>
                </div>
                <textarea
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4}
                  className="w-full px-3 py-2 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 font-mono resize-none"
                />
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-zinc-400">Public Key <span className="text-zinc-600">(optional)</span></label>
                  <label className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors">
                    <Upload className="w-3 h-3" />
                    Upload
                    <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, setPublicKey)} />
                  </label>
                </div>
                <textarea
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="ssh-rsa AAAA..."
                  rows={2}
                  className="w-full px-3 py-2 text-xs bg-zinc-800 border border-white/10 rounded-lg text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 font-mono resize-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAdd(false)}
                  className="h-7 px-3 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addKey}
                  disabled={!name.trim() || !privateKey.trim() || saving}
                  className="h-7 px-3 text-[11px] font-medium bg-indigo-500 text-white hover:bg-indigo-400 rounded-lg transition-colors disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save Key'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-zinc-600">
              <Key className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No SSH keys configured</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {keys.map(key => (
                <div key={key._id} className="flex items-center justify-between bg-zinc-900 border border-white/5 rounded-lg px-3 py-2.5 group">
                  <div className="flex items-center gap-3 min-w-0">
                    <Key className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{key.name}</div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {key.publicKey ? key.publicKey.slice(0, 60) + '...' : 'Private key only'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteKey(key._id)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
