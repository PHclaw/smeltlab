'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  BarChart3,
  BookmarkPlus,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react';
import AppShell from '@/components/agent/AppShell';
import Composer from '@/components/agent/Composer';
import Markdown from '@/components/agent/Markdown';
import TrainModal from '@/components/agent/TrainModal';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { createRecipe, type RecipeStep } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type Attachment,
  type ChatMessage,
  type Conversation,
  getConversation,
  streamAgent,
  titleFrom,
  upsertConversation,
} from '@/lib/agent';

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const conversationId = params?.id as string;

  const [conv, setConv] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 保存为配方
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeName, setRecipeName] = useState('');
  const [recipeDesc, setRecipeDesc] = useState('');
  const [recipeTags, setRecipeTags] = useState('');
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [trainOpen, setTrainOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const autostartRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 载入会话
  useEffect(() => {
    if (!conversationId) return;
    const found = getConversation(conversationId);
    if (!found) {
      router.replace('/');
      return;
    }
    setConv(found);
  }, [conversationId, router]);

  // 持久化（防抖，避免逐字写 localStorage）
  useEffect(() => {
    if (!conv) return;
    const timer = setTimeout(() => upsertConversation(conv), 250);
    return () => clearTimeout(timer);
  }, [conv]);

  // 运行计时：让用户知道 Agent 还在干活
  useEffect(() => {
    if (!streaming) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [streaming]);

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' });
  }, [conv?.messages, streaming]);

  const updateMessage = useCallback((messageId: string, patch: (m: ChatMessage) => ChatMessage) => {
    setConv((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        messages: prev.messages.map((m) => (m.id === messageId ? patch(m) : m)),
      };
    });
  }, []);

  /** 跑一轮：把 messages 里最后一条 user 消息发给 agent */
  const runTurn = useCallback(
    async (messages: ChatMessage[], sessionId: string) => {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) return;

      const assistantId = `a_${Date.now()}`;
      setConv((prev) =>
        prev
          ? {
              ...prev,
              updatedAt: Date.now(),
              messages: [
                ...prev.messages,
                { id: assistantId, role: 'assistant', content: '', thinking: '', toolCalls: [], createdAt: Date.now() },
              ],
            }
          : prev,
      );

      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamAgent(
          {
            message: lastUser.content,
            sessionId,
            attachments: lastUser.attachments,
            // 清洗与建模两个技能常驻，由 Agent 根据提问自行选择
            skills: ['data-cleaner', 'auto-trainer'],
            signal: controller.signal,
          },
          (event) => {
            if (event.type === 'text') {
              updateMessage(assistantId, (m) => ({ ...m, content: m.content + (event.content || '') }));
            } else if (event.type === 'thinking') {
              updateMessage(assistantId, (m) => ({ ...m, thinking: (m.thinking || '') + (event.content || '') }));
            } else if (event.type === 'tool_call') {
              updateMessage(assistantId, (m) => {
                const calls = m.toolCalls || [];
                if (calls[calls.length - 1] === event.content) return m;
                return {
                  ...m,
                  toolCalls: [...calls, event.content || ''],
                  stepTimes: [...(m.stepTimes || []), Date.now()],
                };
              });
            } else if (event.type === 'progress') {
              updateMessage(assistantId, (m) => ({
                ...m,
                progress: {
                  pct: Math.max(0, Math.min(100, Number(event.pct) || 0)),
                  stage: event.stage || m.progress?.stage || '',
                },
              }));
            } else if (event.type === 'error') {
              updateMessage(assistantId, (m) => ({ ...m, error: friendlyError(event.content) }));
            } else if (event.type === 'done') {
              updateMessage(assistantId, (m) => ({
                ...m,
                content: event.content || m.content,
                files: event.files || [],
                progress: undefined,
              }));
            }
          },
        );
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        updateMessage(assistantId, (m) => ({
          ...m,
          error: aborted ? undefined : friendlyError(err instanceof Error ? err.message : ''),
          content: m.content || (aborted ? '已停止生成' : m.content),
          progress: undefined,
        }));
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [updateMessage],
  );

  // 从进入页跳转过来时自动开始
  useEffect(() => {
    if (!conv || autostartRef.current) return;
    const autostart = new URLSearchParams(window.location.search).get('autostart') === '1';
    if (!autostart) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'user') return;

    autostartRef.current = true;
    window.history.replaceState(null, '', `/chat/${conv.id}`);
    runTurn(conv.messages, conv.id);
  }, [conv, runTurn]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || streaming || !conv) return;

    const message: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      attachments,
      createdAt: Date.now(),
    };
    const next: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? titleFrom(text) : conv.title,
      updatedAt: Date.now(),
      messages: [...conv.messages, message],
    };

    setConv(next);
    setDraft('');
    setAttachments([]);
    runTurn(next.messages, conv.id);
  };

  // 训练卡等组件可以让 AI 解读结果
  useEffect(() => {
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail?.trim();
      if (!detail || streaming || !conv) return;
      const message: ChatMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: detail,
        createdAt: Date.now(),
      };
      const next: Conversation = {
        ...conv,
        updatedAt: Date.now(),
        messages: [...conv.messages, message],
      };
      setConv(next);
      runTurn(next.messages, conv.id);
    };
    window.addEventListener('smeltlab:ask', onAsk);
    return () => window.removeEventListener('smeltlab:ask', onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, streaming]);

  const handleRegenerate = () => {
    if (!conv || streaming) return;
    const messages = [...conv.messages];
    while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
    if (!messages.length) return;

    const next = { ...conv, messages };
    setConv(next);
    runTurn(messages, conv.id);
  };

  // 重命名会话标题：双击标题进入编辑
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const cancelTitleRef = useRef(false);

  const commitTitle = () => {
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false;
      setEditingTitle(false);
      return;
    }
    const next = titleDraft.trim();
    if (!conv) return;
    setEditingTitle(false);
    if (!next || next === conv.title) return;
    setConv({ ...conv, title: next, updatedAt: Date.now() });
    toast({ title: '标题已更新' });
  };

  const handleCopy = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 1600);
      toast({ title: '已复制到剪贴板', variant: 'success' });
    } catch {
      toast({ title: '复制失败', description: '浏览器未授权剪贴板访问', variant: 'error' });
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    toast({ title: '已停止生成' });
  };

  const openRecipeDialog = () => {
    if (!user) {
      toast({ title: '请先登录', description: '登录后才能把清洗流程保存到灵感库', variant: 'error' });
      return;
    }
    setRecipeName(conv?.title || '');
    setRecipeDesc('');
    setRecipeTags('');
    setRecipeOpen(true);
  };

  const handleSaveRecipe = async () => {
    if (!conv || !recipeName.trim() || savingRecipe) return;
    setSavingRecipe(true);
    try {
      const instruction =
        conv.messages.find((m) => m.role === 'user')?.content || conv.title;
      const toolLabels = Array.from(
        new Set(
          conv.messages
            .flatMap((m) => m.toolCalls || [])
            .map((s) => s.replace(/[\s.．…]+$/g, '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 8);

      const steps: RecipeStep[] = [
        {
          step_id: 'instruction',
          operation: 'agent_instruction',
          description: '对话指令',
          config: { instruction },
        },
        ...toolLabels.map((label, idx) => ({
          step_id: `step_${idx}`,
          operation: 'agent_step',
          description: label,
          config: {},
        })),
      ];

      await createRecipe(
        recipeName.trim(),
        steps,
        recipeDesc.trim(),
        recipeTags.split(',').map((t) => t.trim()).filter(Boolean),
      );
      setRecipeOpen(false);
      toast({ title: '已保存到灵感库', description: '下次可以一键复用这段流程', variant: 'success' });
    } catch (err) {
      toast({ title: '保存失败', description: err instanceof Error ? err.message : '', variant: 'error' });
    } finally {
      setSavingRecipe(false);
    }
  };

  const messages = conv?.messages || [];
  const lastAssistantStreaming =
    streaming && messages.length > 0 && messages[messages.length - 1].role === 'assistant';

  return (
    <AppShell scroll={false} activeConversationId={conversationId}>
      <div className="relative flex h-full flex-col bg-white">
        {/* 顶部 */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-transparent px-6">
          <div className="flex min-w-0 items-center gap-1 text-[14px] text-gray-800">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') {
                    // 标记取消，避免失焦时把半截标题提交上去
                    cancelTitleRef.current = true;
                    setTitleDraft(conv?.title || '');
                    setEditingTitle(false);
                  }
                }}
                className="w-64 rounded-md border border-gray-200 px-2 py-1 text-[13.5px] outline-none focus:border-gray-400"
              />
            ) : (
              <>
                <span
                  className="max-w-[420px] truncate"
                  onDoubleClick={() => {
                    setTitleDraft(conv?.title || '');
                    setEditingTitle(true);
                  }}
                  title="双击可重命名"
                >
                  {conv?.title || '新会话'}
                </span>
                <button
                  onClick={() => {
                    setTitleDraft(conv?.title || '');
                    setEditingTitle(true);
                  }}
                  className="grid h-6 w-6 place-items-center rounded text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  title="重命名会话"
                >
                  <ChevronDown size={14} />
                </button>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {streaming && (
              <span className="flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-[11.5px] tabular-nums text-gray-400">
                <Loader2 size={11} className="animate-spin" />
                运行 {elapsed}s
              </span>
            )}
            <button
              onClick={() => setTrainOpen(true)}
              title="训练模型"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
            >
              <BarChart3 size={14} />
              训练
            </button>
            <button
              onClick={() => router.push('/')}
              title="新建会话"
              className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            >
              <SquarePen size={16} />
            </button>
          </div>
        </header>

        {/* 消息区 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-6 pb-8 pt-4">
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="mb-8 flex justify-end">
                    <div className="max-w-[80%]">
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                          {message.attachments.map((file) => (
                            <span
                              key={file.name}
                              className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[11.5px] text-gray-600"
                            >
                              <FileText size={11} />
                              {file.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap rounded-2xl bg-gray-100 px-4 py-2.5 text-[15px] leading-7 text-gray-900">
                        {message.content}
                      </div>
                    </div>
                  </div>
                );
              }

              const isLast = message.id === messages[messages.length - 1]?.id;
              const isLive = isLast && lastAssistantStreaming;

              return (
                <div key={message.id} className="mb-8 flex gap-3">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-50 text-indigo-500">
                    <Sparkles size={14} />
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* 思考过程 */}
                    <ThinkingBlock text={message.thinking} live={isLive} elapsed={isLive ? elapsed : 0} />

                    {/* 工具调用 */}
                    <ToolSteps calls={message.toolCalls} times={message.stepTimes} live={isLive} />

                    {/* 长任务进度（训练/清洗命令回传） */}
                    {isLive && message.progress && (
                      <div className="mb-2 max-w-md">
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11.5px] text-gray-400">
                          <span className="truncate">{message.progress.stage || '正在处理'}</span>
                          <span className="shrink-0 tabular-nums">{message.progress.pct}%</span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-gray-900 transition-all duration-500"
                            style={{ width: `${message.progress.pct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* 拿不到具体进度时，用不确定进度条表示「还在跑」 */}
                    {isLive && !message.progress && elapsed >= 8 && (message.toolCalls?.length ?? 0) > 0 && (
                      <div className="mb-2 max-w-md">
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11.5px] text-gray-400">
                          <span className="truncate">
                            {(message.toolCalls?.[message.toolCalls.length - 1] || '正在执行').replace(
                              /[\s.．…]+$/g,
                              '',
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums">{formatDuration(elapsed * 1000)}</span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-gray-400" />
                        </div>
                      </div>
                    )}

                    {isLive && elapsed >= 30 && !message.content && (
                      <p className="mb-2 text-[11px] text-gray-300">
                        这一步比较耗时，仍在执行中；不想等可以点右下角停止。
                      </p>
                    )}

                    {/* 回答 */}
                    {message.content ? (
                      <div className="relative">
                        <Markdown text={message.content} />
                        {isLive && (
                          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-gray-800" />
                        )}
                      </div>
                    ) : (
                      isLive && (
                        <div className="flex items-center gap-1.5 py-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-300 [animation-delay:-0.2s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-300 [animation-delay:-0.1s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-300" />
                        </div>
                      )
                    )}

                    {/* 错误提示 */}
                    {message.error && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                        <p className="min-w-0 flex-1 text-[12.5px] leading-5 text-red-600">{message.error}</p>
                        {!isLive && (
                          <button
                            onClick={handleRegenerate}
                            className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-0.5 text-[11.5px] text-red-600 transition hover:bg-red-100"
                          >
                            重试
                          </button>
                        )}
                      </div>
                    )}

                    {/* 产物 */}
                    {message.files && message.files.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.files.map((file) => {
                          const url = `${
                            process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'
                          }/agent/files/${conv?.id || conversationId}/${file.path}`;
                          const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);

                          return isImage ? (
                            <a
                              key={file.path}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="overflow-hidden rounded-lg border border-gray-100 transition hover:border-gray-300"
                              title={file.name}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={file.name} className="max-h-64 w-auto" />
                            </a>
                          ) : (
                            <a
                              key={file.path}
                              href={url}
                              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-600 transition hover:bg-gray-50"
                            >
                              <FileText size={12} className="text-gray-400" />
                              {file.name}
                            </a>
                          );
                        })}
                      </div>
                    )}

                    {/* 操作栏 */}
                    {!isLive && message.content && (
                      <div className="mt-2.5 flex items-center gap-0.5 text-gray-400">
                        <button
                          onClick={() => handleCopy(message)}
                          title="复制"
                          className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-gray-100 hover:text-gray-600"
                        >
                          {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button
                          onClick={handleRegenerate}
                          title="重新生成"
                          className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-gray-100 hover:text-gray-600"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={openRecipeDialog}
                          title="保存为配方"
                          className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-gray-100 hover:text-gray-600"
                        >
                          <BookmarkPlus size={14} />
                        </button>
                        <button className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-gray-100 hover:text-gray-600">
                          <ThumbsUp size={14} />
                        </button>
                        <button className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-gray-100 hover:text-gray-600">
                          <ThumbsDown size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 px-6 pb-3">
          <div className="mx-auto w-full max-w-[760px]">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={handleSend}
              onStop={handleStop}
              streaming={streaming}
              getSessionId={() => conversationId}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              placeholder="继续提问，也可以把文件拖进来"
            />
            <p className="py-2 text-center text-[11px] text-gray-400">内容由 AI 生成，请仔细甄别</p>
          </div>
        </div>
      </div>

      <TrainModal open={trainOpen} onClose={() => setTrainOpen(false)} />

      <Modal
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        title="保存为配方"
        description="把这段清洗指令存进灵感库，下次可以一键复用"
        footer={
          <>
            <button
              onClick={() => setRecipeOpen(false)}
              className="h-8 rounded-lg px-3 text-[12.5px] text-gray-600 transition hover:bg-gray-100"
            >
              取消
            </button>
            <button
              onClick={handleSaveRecipe}
              disabled={!recipeName.trim() || savingRecipe}
              className="h-8 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
            >
              {savingRecipe ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="space-y-2.5">
          <input
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            placeholder="配方名称"
            className="h-9 w-full rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            autoFocus
          />
          <input
            value={recipeDesc}
            onChange={(e) => setRecipeDesc(e.target.value)}
            placeholder="一句话描述（可选）"
            className="h-9 w-full rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          />
          <input
            value={recipeTags}
            onChange={(e) => setRecipeTags(e.target.value)}
            placeholder="标签，用逗号分隔（可选）"
            className="h-9 w-full rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          />
        </div>
      </Modal>
    </AppShell>
  );
}

/** 思考内容字数摘要 */
function formatChars(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k 字` : `${n} 字`;
}

/** 思考过程：流式时展开，结束后自动收起为一行摘要 */
function ThinkingBlock({ text, live, elapsed = 0 }: { text?: string; live: boolean; elapsed?: number }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const wasLive = useRef(false);

  useEffect(() => {
    if (live) setOpen(true);
    else if (wasLive.current) setOpen(false);
    wasLive.current = live;
  }, [live]);

  // 流式输出时让思考框跟着滚动到底
  useEffect(() => {
    if (!live || !open || !boxRef.current) return;
    boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text, live, open]);

  if (!text && !live) return null;

  const chars = text?.length ?? 0;

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-[12.5px] text-gray-400 transition hover:text-gray-600"
      >
        {live ? (
          <Loader2 size={12} className="shrink-0 animate-spin" />
        ) : (
          <Sparkles size={12} className="shrink-0 text-gray-300" />
        )}
        <span className="shrink-0">
          {live
            ? elapsed > 0
              ? `思考中 · ${formatDuration(elapsed * 1000)}`
              : '思考中'
            : chars
              ? `已思考 · ${formatChars(chars)}`
              : '已思考'}
        </span>
        {!open && chars > 0 && !live && <span className="truncate text-gray-300">点击查看过程</span>}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>

      {open && text && (
        <div
          ref={boxRef}
          className="mt-1.5 max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-50 px-3.5 py-2.5 text-[12.5px] leading-6 text-gray-500"
        >
          {text}
        </div>
      )}
    </div>
  );
}

/** 毫秒 → 人类可读耗时 */
function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** 底层错误文案翻译成用户能理解、能行动的提示 */
function friendlyError(raw?: string) {
  const text = (raw || '').trim();
  if (!text) return '这一步没有完成，可以直接重试。';
  if (/network\s*error|failed to fetch|fetch failed|ECONN|socket hang up|连接被重置/i.test(text)) {
    return '与模型服务的连接中断，这一步没有完成。可以直接重试；如果反复中断，把任务拆小一点再试。';
  }
  if (/rate limit|429|too many requests/i.test(text)) {
    return '模型服务当前限流，等几秒后重试。';
  }
  if (/超时|timeout/i.test(text)) {
    return `${text}（可以重试，或把任务拆成更小的一步）`;
  }
  return text;
}

/** 执行步骤：进行中逐条显示（含耗时），结束后折叠成一行汇总 */
function ToolSteps({
  calls,
  times,
  live,
}: {
  calls?: string[];
  times?: number[];
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = calls || [];
  if (list.length === 0) return null;

  const label = (raw: string) => (raw || '').replace(/[\s.．…]+$/g, '').trim() || '执行步骤';
  const stamps = list.map((_, idx) => times?.[idx] ?? 0);
  const first = stamps.find((value) => value > 0) ?? 0;
  const now = Date.now();
  const last = [...stamps].reverse().find((value) => value > 0) ?? 0;
  const total = first ? Math.max(0, (live ? now : last) - first) : 0;

  const stepCost = (idx: number) => {
    const start = stamps[idx];
    if (!start) return 0;
    const end = idx < list.length - 1 ? stamps[idx + 1] : live ? now : 0;
    return end > start ? end - start : 0;
  };

  if (!live) {
    return (
      <div className="mb-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-[12.5px] text-gray-400 transition hover:text-gray-600"
        >
          <Check size={12} className="shrink-0 text-emerald-500" />
          <span className="truncate">
            完成 {list.length} 步{total > 0 ? ` · 用时 ${formatDuration(total)}` : ''}
          </span>
          <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>

        {open && (
          <div className="mt-1.5 max-h-[220px] overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/70 py-1">
            {list.map((raw, idx) => (
              <div
                key={`${idx}-${raw}`}
                className="flex items-center gap-2 px-3 py-1 text-[12px] text-gray-500"
              >
                <Wrench size={11} className="shrink-0 text-gray-400" />
                <span className="truncate">{label(raw)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 进行中：只显示最近 3 步，避免长任务把消息撑满
  const startIdx = Math.max(0, list.length - 3);
  const visible = list.slice(startIdx).map((raw, i) => ({ raw, idx: startIdx + i }));

  return (
    <div className="mb-2 space-y-0.5">
      {startIdx > 0 && (
        <p className="pl-[18px] text-[11px] text-gray-300">…前面 {startIdx} 步已完成</p>
      )}
      {visible.map(({ raw, idx }) => {
        const current = idx === list.length - 1;
        const cost = stepCost(idx);
        return (
          <div key={`${idx}-${raw}`} className="flex items-center gap-1.5 text-[12px]">
            {current ? (
              <Loader2 size={11} className="shrink-0 animate-spin text-gray-400" />
            ) : (
              <Check size={11} className="shrink-0 text-emerald-500" />
            )}
            <span className={`truncate ${current ? 'text-gray-600' : 'text-gray-400'}`}>
              {label(raw)}
            </span>
            {cost > 0 && (
              <span className="ml-auto shrink-0 tabular-nums text-[10.5px] text-gray-300">
                {formatDuration(cost)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
