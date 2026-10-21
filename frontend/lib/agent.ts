/**
 * Agent 对话客户端 —— 对接本地 piagent 引擎的 SSE 接口，以及会话的本地存储。
 *
 * 后端没有数据库，对话历史保存在浏览器 localStorage：
 * 一条会话对应一个 session_id，同时也是 pi 的上下文键与工作区目录名。
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AgentArtifact {
  name: string;
  path: string;
  size: number;
  url: string;
}

export type AgentEventType =
  | 'log'
  | 'thinking'
  | 'text'
  | 'tool_call'
  | 'progress'
  | 'done'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  /** progress 事件：0-100 的百分比 */
  pct?: number;
  /** progress 事件：当前阶段描述 */
  stage?: string;
  files?: AgentArtifact[];
  session_id?: string;
}

export interface Attachment {
  name: string;
  size: number;
  path: string;
}

export interface AgentSkill {
  name: string;
  title: string;
  description: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  toolCalls?: string[];
  /** 与 toolCalls 一一对应的开始时间戳，用于展示每步耗时 */
  stepTimes?: number[];
  /** 长任务进度（训练/清洗命令回传的 @@PROGRESS） */
  progress?: { pct: number; stage: string };
  files?: AgentArtifact[];
  attachments?: Attachment[];
  /** 本轮启用的技能名 */
  skill?: string;
  error?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentStatus {
  enabled: boolean;
  available: boolean;
  exe: string | null;
  timeout: number;
  skills: AgentSkill[];
}

// ---------------------------------------------------------------------------
// 运行时状态
// ---------------------------------------------------------------------------

export async function getAgentStatus(): Promise<AgentStatus> {
  const res = await fetch(`${API_BASE}/agent/status`);
  if (!res.ok) throw new Error('Agent 状态查询失败');
  return res.json();
}

/** 可用技能列表 */
export async function getSkills(): Promise<AgentSkill[]> {
  const res = await fetch(`${API_BASE}/agent/skills`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.skills) ? data.skills : [];
}

/** 上传附件到会话工作区，模型可直接用工具读取 */
export async function uploadAttachment(file: File, sessionId: string): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file);
  form.append('session_id', sessionId);

  const res = await fetch(`${API_BASE}/agent/files`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '上传失败' }));
    throw new Error(err.detail || '上传失败');
  }
  const data = await res.json();
  return { name: data.name, size: data.size, path: data.path };
}

// ---------------------------------------------------------------------------
// 流式对话
// ---------------------------------------------------------------------------

/**
 * 发起一次流式对话，逐个事件回调。
 *
 * 后端返回 text/event-stream；这里手工按 `\n\n` 切分事件块，
 * 不依赖 EventSource（它不支持 POST）。
 */
export async function streamAgent(
  params: {
    message: string;
    sessionId: string;
    attachments?: Attachment[];
    skills?: string[];
    signal?: AbortSignal;
  },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const { message, sessionId, attachments, skills, signal } = params;

  const prompt = attachments?.length
    ? `${message}\n\n（工作区中已上传文件：${attachments.map((a) => a.name).join('、')}）`
    : message;

  const res = await fetch(`${API_BASE}/agent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      session_id: sessionId,
      skills: skills?.length ? skills : null,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* 忽略解析失败 */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const line = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;

      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        /* 跳过无法解析的行 */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 会话存储（localStorage）
// ---------------------------------------------------------------------------

const STORE_KEY = 'smeltlab_conversations';
const CHANGE_EVENT = 'smeltlab:conversations-changed';

function readStore(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

function writeStore(list: Conversation[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onConversationsChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function listConversations(): Conversation[] {
  return readStore().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(id: string): Conversation | undefined {
  return readStore().find((c) => c.id === id);
}

export function newConversationId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertConversation(conv: Conversation) {
  const list = readStore();
  const idx = list.findIndex((c) => c.id === conv.id);
  if (idx >= 0) list[idx] = conv;
  else list.push(conv);
  writeStore(list);
}

export function deleteConversation(id: string) {
  writeStore(readStore().filter((c) => c.id !== id));
}

/** 撤销删除：把整条会话写回列表 */
export function restoreConversation(conv: Conversation) {
  upsertConversation(conv);
}

export function titleFrom(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean || '新会话';
}
