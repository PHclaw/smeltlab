'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles, Loader2, Key, Trash2, Plus, Webhook, Copy, CheckCircle2,
  AlertTriangle, Globe,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

interface APIKeyInfo {
  id: string;
  name: string;
  created_at: string;
  last_used: string | null;
  usage_count: number;
}

interface WebhookInfo {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  secret: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState('clean.completed');

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_BASE}/settings/keys`, { headers }).then((r) => r.json()),
      fetch(`${API_BASE}/settings/webhooks`, { headers }).then((r) => r.json()),
    ])
      .then(([k, w]) => { setKeys(k); setWebhooks(w); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const getToken = () => localStorage.getItem('auth_token') || '';

  const handleCreateKey = async () => {
    const res = await fetch(`${API_BASE}/settings/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ name: newKeyName || undefined }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewKey(data.key);
      setKeys((prev) => [...prev, { id: data.id, name: data.name, created_at: data.created_at, last_used: null, usage_count: 0 }]);
      setNewKeyName('');
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('Delete this API key? Any integrations using it will stop working.')) return;
    await fetch(`${API_BASE}/settings/keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleCreateWebhook = async () => {
    if (!newWebhookUrl.trim()) return;
    const events = newWebhookEvents.split(',').map((e) => e.trim()).filter(Boolean);
    const res = await fetch(`${API_BASE}/settings/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ url: newWebhookUrl, events }),
    });
    if (res.ok) {
      const wh = await res.json();
      setWebhooks((prev) => [...prev, wh]);
      setNewWebhookUrl('');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    await fetch(`${API_BASE}/settings/webhooks/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <Link href="/" className="text-lg font-bold text-gray-900">DataCleanr</Link>
          </div>
          <nav className="flex items-center gap-4 text-sm text-gray-500">
            <Link href="/dashboard" className="hover:text-gray-900">Dashboard</Link>
            <Link href="/recipes" className="hover:text-gray-900">Recipes</Link>
            <span className="text-primary-600 font-medium">Settings</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">API keys and webhook configuration</p>
        </div>

        {/* API Keys */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Key className="h-5 w-5 text-primary-500" />
              API Keys
            </h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Use API keys to access DataCleanr programmatically. Include the key in the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">Authorization: Bearer dc_...</code> header.
          </p>

          {/* New key display */}
          {newKey && (
            <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">Save this key — it won&apos;t be shown again!</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono break-all">{newKey}</code>
                <button onClick={() => copyToClipboard(newKey)} className="btn-secondary text-xs flex-shrink-0">
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Create key form */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (optional)"
              className="input flex-1 text-sm"
            />
            <button onClick={handleCreateKey} className="btn-primary text-sm">
              <Plus className="mr-1 h-4 w-4" />
              Create Key
            </button>
          </div>

          {/* Keys list */}
          {keys.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No API keys yet</p>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{k.name}</span>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Created {new Date(k.created_at).toLocaleDateString()} · Used {k.usage_count}x
                      {k.last_used && ` · Last used ${new Date(k.last_used).toLocaleDateString()}`}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteKey(k.id)} className="text-gray-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Webhooks */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Webhook className="h-5 w-5 text-primary-500" />
              Webhooks
            </h2>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Get notified when cleaning jobs complete. Payloads are signed with HMAC-SHA256 using your webhook secret.
          </p>

          <div className="flex gap-2 mb-4">
            <input
              type="url"
              value={newWebhookUrl}
              onChange={(e) => setNewWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="input flex-1 text-sm"
            />
            <button onClick={handleCreateWebhook} disabled={!newWebhookUrl.trim()} className="btn-primary text-sm">
              <Globe className="mr-1 h-4 w-4" />
              Register
            </button>
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium text-gray-500">Events (comma-separated)</label>
            <input
              type="text"
              value={newWebhookEvents}
              onChange={(e) => setNewWebhookEvents(e.target.value)}
              className="input text-sm mt-1"
            />
            <p className="text-[10px] text-gray-400 mt-1">Available: clean.completed, recipe.applied, dataset.uploaded</p>
          </div>

          {webhooks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No webhooks configured</p>
          ) : (
            <div className="space-y-2">
              {webhooks.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900 truncate block">{w.url}</span>
                    <div className="flex gap-1 mt-1">
                      {w.events.map((e) => (
                        <span key={e} className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary-600">{e}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteWebhook(w.id)} className="text-gray-400 hover:text-red-500 ml-2">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* API Usage Example */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">API Usage</h2>
          <div className="rounded-lg bg-gray-900 p-4 text-sm font-mono text-gray-300 overflow-x-auto">
            <p className="text-gray-500"># Upload and clean data via API</p>
            <p><span className="text-emerald-400">curl</span> -X POST https://api.datacleanr.com/api/datasets/upload \</p>
            <p>  -H <span className="text-amber-400">&quot;Authorization: Bearer dc_your_key&quot;</span> \</p>
            <p>  -F <span className="text-amber-400">&quot;file=@data.csv&quot;</span></p>
            <p className="mt-2 text-gray-500"># Apply a recipe</p>
            <p><span className="text-emerald-400">curl</span> -X POST https://api.datacleanr.com/api/recipes/RECIPE_ID/apply/DATASET_ID \</p>
            <p>  -H <span className="text-amber-400">&quot;Authorization: Bearer dc_your_key&quot;</span></p>
            <p className="mt-2 text-gray-500"># Export cleaned data</p>
            <p><span className="text-emerald-400">curl</span> https://api.datacleanr.com/api/datasets/DATASET_ID/export?format=csv \</p>
            <p>  -H <span className="text-amber-400">&quot;Authorization: Bearer dc_your_key&quot;</span> -o cleaned.csv</p>
          </div>
        </div>
      </div>
    </div>
  );
}
