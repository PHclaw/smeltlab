'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Check, Copy, Key, Loader2, Plus, Trash2, Webhook,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import AppShell from '@/components/agent/AppShell';

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

const INPUT =
  'h-8 w-full rounded-lg border border-gray-200 px-2.5 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none';
const PRIMARY_BTN =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-40';

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);
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
    if (!confirm('确定删除这个 API Key？正在使用它的集成会立即失效。')) return;
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

  const copySecret = (secret: string, id: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(id);
    setTimeout(() => setCopiedSecret(null), 2000);
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={18} className="animate-spin text-gray-300" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-6">
        <header className="mb-6">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-gray-900">设置</h1>
          <p className="mt-1 text-[12.5px] text-gray-400">API Key 与 Webhook，用于把清洗能力接入你自己的系统</p>
        </header>

        <div className="space-y-4">
          {/* API Keys */}
          <section className="rounded-xl border border-gray-100 p-4">
            <div className="mb-1 flex items-center gap-1.5">
              <Key size={14} className="text-gray-400" />
              <h2 className="text-[13px] font-medium text-gray-900">API Keys</h2>
            </div>
            <p className="mb-3 text-[12px] leading-5 text-gray-400">
              在请求头里带上{' '}
              <code className="rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[11.5px] text-gray-600">
                Authorization: Bearer dc_...
              </code>{' '}
              即可调用接口。
            </p>

            {newKey && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-amber-800">
                  <AlertTriangle size={13} />
                  这是唯一一次展示，请立即保存
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-[12px] text-gray-700">
                    {newKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(newKey)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-amber-200 bg-white text-amber-700 transition hover:bg-amber-100"
                    title="复制"
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}

            <div className="mb-3 flex items-center gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="给这个 Key 起个名字（可选）"
                className={INPUT}
              />
              <button onClick={handleCreateKey} className={PRIMARY_BTN}>
                <Plus size={13} />
                创建
              </button>
            </div>

            {keys.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-gray-300">还没有 API Key</p>
            ) : (
              <div className="space-y-1.5">
                {keys.map((k) => (
                  <div
                    key={k.id}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 transition hover:border-gray-200"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-gray-900">{k.name}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        创建于 {new Date(k.created_at).toLocaleDateString()} · 使用 {k.usage_count} 次
                        {k.last_used && ` · 最近 ${new Date(k.last_used).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(k.id)}
                      className="shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Webhooks */}
          <section className="rounded-xl border border-gray-100 p-4">
            <div className="mb-1 flex items-center gap-1.5">
              <Webhook size={14} className="text-gray-400" />
              <h2 className="text-[13px] font-medium text-gray-900">Webhooks</h2>
            </div>
            <p className="mb-3 text-[12px] leading-5 text-gray-400">
              清洗任务完成时通知你的服务，请求体使用 HMAC-SHA256 签名。
            </p>

            <div className="mb-2 flex items-center gap-2">
              <input
                type="url"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className={INPUT}
              />
              <button onClick={handleCreateWebhook} disabled={!newWebhookUrl.trim()} className={PRIMARY_BTN}>
                注册
              </button>
            </div>

            <div className="mb-3">
              <input
                type="text"
                value={newWebhookEvents}
                onChange={(e) => setNewWebhookEvents(e.target.value)}
                placeholder="订阅事件，用逗号分隔"
                className={INPUT}
              />
              <p className="mt-1 text-[11px] text-gray-400">
                可用：clean.completed、recipe.applied、dataset.uploaded
              </p>
            </div>

            {webhooks.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-gray-300">还没有 Webhook</p>
            ) : (
              <div className="space-y-1.5">
                {webhooks.map((w) => (
                  <div
                    key={w.id}
                    className="group flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 transition hover:border-gray-200"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-gray-900">{w.url}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10.5px] ${
                            w.active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {w.active ? '启用' : '停用'}
                        </span>
                        {w.events.map((e) => (
                          <span key={e} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10.5px] text-gray-500">
                            {e}
                          </span>
                        ))}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[10.5px] text-gray-400">
                          {w.secret}
                        </code>
                        <button
                          onClick={() => copySecret(w.secret, w.id)}
                          className="shrink-0 rounded p-1 text-gray-300 transition hover:bg-gray-100 hover:text-gray-600"
                          title="复制签名密钥"
                        >
                          {copiedSecret === w.id ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteWebhook(w.id)}
                      className="shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 调用示例 */}
          <section className="rounded-xl border border-gray-100 p-4">
            <h2 className="mb-2.5 text-[13px] font-medium text-gray-900">调用示例</h2>
            <div className="overflow-x-auto rounded-lg bg-gray-900 px-3.5 py-3 font-mono text-[11.5px] leading-6 text-gray-300">
              <p className="text-gray-500"># 上传并清洗数据</p>
              <p><span className="text-emerald-400">curl</span> -X POST {API_BASE}/datasets/upload \</p>
              <p>  -H <span className="text-amber-400">&quot;Authorization: Bearer dc_your_key&quot;</span> \</p>
              <p>  -F <span className="text-amber-400">&quot;file=@data.csv&quot;</span></p>
              <p className="mt-2 text-gray-500"># 应用配方</p>
              <p><span className="text-emerald-400">curl</span> -X POST {API_BASE}/recipes/RECIPE_ID/apply/DATASET_ID \</p>
              <p>  -H <span className="text-amber-400">&quot;Authorization: Bearer dc_your_key&quot;</span></p>
              <p className="mt-2 text-gray-500"># 导出结果</p>
              <p><span className="text-emerald-400">curl</span> {API_BASE}/datasets/DATASET_ID/export?format=csv \</p>
              <p>  -H <span className="text-amber-400">&quot;Authorization: Bearer dc_your_key&quot;</span> -o cleaned.csv</p>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
