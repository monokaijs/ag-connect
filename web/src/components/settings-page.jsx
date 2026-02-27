import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Loader2, Eye, EyeOff, Upload } from 'lucide-react';
import { API_BASE } from '../config';

export default function SettingsPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings/ssh-keys`);
      const data = await res.json();
      setKeys(data);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const addKey = async () => {
    if (!name.trim() || !privateKey.trim()) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/settings/ssh-keys`, {
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
      await fetch(`${API_BASE}/api/settings/ssh-keys/${id}`, { method: 'DELETE' });
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

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full p-6">
        <h1 className="text-lg font-semibold text-white mb-1">Settings</h1>
        <p className="text-xs text-zinc-500 mb-6">Manage your AG Connect configuration</p>

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
