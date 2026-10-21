'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BookOpen,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Gift,
  Layers,
  Lightbulb,
  Loader2,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  type Conversation,
  deleteConversation,
  listConversations,
  onConversationsChange,
  restoreConversation,
} from '@/lib/agent';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const COLLAPSE_KEY = 'smeltlab_sidebar_collapsed';
export const PROJECTS_CHANGED = 'smeltlab:projects-changed';

interface Project {
  id: string;
  name: string;
  dataset_count: number;
}

const NAV_ITEMS = [
  { href: '/', label: '数据清洗', icon: Wand2, match: ['/', '/chat'], hint: '在对话里描述清洗需求，直接开始' },
  { href: '/recipes', label: '灵感库', icon: Lightbulb, match: ['/recipes'], hint: '保存与复用清洗配方' },
  { href: '/dashboard', label: '数据集', icon: Layers, match: ['/dashboard'], hint: '管理项目与数据集' },
  { href: '/settings', label: '设置', icon: Settings, match: ['/settings'], hint: 'API Key 与 Webhook' },
];

interface SidebarProps {
  activeConversationId?: string;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ activeConversationId, onCollapsedChange }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const moreRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const lastDeleted = useRef<Conversation | null>(null);

  // ---------------------------------------------------------------- 折叠状态
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  };

  // ---------------------------------------------------------------- 对话列表
  useEffect(() => {
    const sync = () => setConversations(listConversations());
    sync();
    return onConversationsChange(sync);
  }, []);

  // ---------------------------------------------------------------- 项目列表
  const loadProjects = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setProjects([]);
      return;
    }
    setProjectsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('加载项目失败');
      setProjects(await res.json());
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects, user, pathname]);

  useEffect(() => {
    const handler = () => loadProjects();
    window.addEventListener(PROJECTS_CHANGED, handler);
    return () => window.removeEventListener(PROJECTS_CHANGED, handler);
  }, [loadProjects]);

  // ---------------------------------------------------------------- 快捷键 / 点击外部
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startNewSession();
      }
      if (e.key === 'Escape') {
        setMoreOpen(false);
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ---------------------------------------------------------------- 行为
  const startNewSession = () => {
    if (pathname === '/') {
      window.dispatchEvent(new Event('smeltlab:new-session'));
      toast({ title: '已开启新会话' });
    } else {
      router.push('/');
    }
    setMoreOpen(false);
  };

  const handleDeleteConversation = (e: React.MouseEvent, conv: Conversation) => {
    e.preventDefault();
    e.stopPropagation();
    lastDeleted.current = conv;
    deleteConversation(conv.id);

    toast({
      title: `已删除「${conv.title}」`,
      action: {
        label: '撤销',
        onClick: () => {
          if (lastDeleted.current) restoreConversation(lastDeleted.current);
        },
      },
    });

    if (conv.id === activeConversationId || pathname === `/chat/${conv.id}`) router.push('/');
  };

  const handleCopyInvite = async () => {
    const link = `${window.location.origin}/?ref=invite`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast({ title: '邀请链接已复制', description: link, variant: 'success' });
    } catch {
      toast({ title: '复制失败', description: '请手动复制：' + link, variant: 'error' });
    }
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    setProjects([]);
    toast({ title: '已退出登录' });
    router.push('/');
  };

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));

  const currentConvId = activeConversationId || (pathname.startsWith('/chat/') ? pathname.split('/')[2] : undefined);

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-gray-100 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-[64px]' : 'w-[248px]'
      }`}
    >
      {/* 顶部：logo + 折叠 */}
      <div className={`flex h-14 items-center px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        <Link
          href="/"
          title="SmeltLab 首页"
          className="grid h-8 w-8 place-items-center rounded-[10px] bg-gray-900 text-[13px] font-black text-white transition hover:bg-gray-700"
        >
          C
        </Link>
        <button
          onClick={toggleCollapsed}
          className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeft size={16} />}
        </button>
      </div>

      {/* 新建会话 */}
      <div className={collapsed ? 'px-2' : 'px-3'}>
        <button
          onClick={startNewSession}
          title="新建会话（Ctrl K）"
          className={`flex h-10 w-full items-center rounded-xl border border-gray-200 bg-white text-[13px] text-gray-700 transition hover:bg-gray-50 active:scale-[0.99] ${
            collapsed ? 'justify-center' : 'justify-between gap-2 px-3'
          }`}
        >
          <span className="flex items-center gap-2">
            <Plus size={16} className="text-gray-500" />
            {!collapsed && '新建会话'}
          </span>
          {!collapsed && (
            <span className="rounded border border-gray-200 px-1 py-px text-[10px] text-gray-400">Ctrl K</span>
          )}
        </button>
      </div>

      {/* 主导航 */}
      <nav className="mt-2 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? `${item.label} · ${item.hint}` : item.hint}
              aria-current={active ? 'page' : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-lg text-[13px] transition ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${active ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              <item.icon
                size={16}
                strokeWidth={1.7}
                className={`shrink-0 ${active ? 'text-gray-900' : 'text-gray-500'}`}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}

        {/* 更多 */}
        <div ref={moreRef} className="relative">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            title="更多"
            aria-expanded={moreOpen}
            className={`flex h-9 w-full items-center gap-2.5 rounded-lg text-[13px] transition ${
              collapsed ? 'justify-center px-0' : 'px-2.5'
            } ${moreOpen ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <MoreHorizontal size={16} strokeWidth={1.7} className="shrink-0 text-gray-500" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">更多</span>
                <ChevronRight size={13} className={`text-gray-400 transition ${moreOpen ? 'rotate-90' : ''}`} />
              </>
            )}
          </button>

          {moreOpen && (
            <div className="absolute left-0 top-10 z-30 w-52 rounded-xl border border-gray-100 bg-white p-1 shadow-xl">
              <p className="px-2.5 py-1 text-[11px] text-gray-400">资源</p>
              <button
                onClick={() => {
                  window.open(`${API_BASE.replace(/\/api\/?$/, '')}/docs`, '_blank', 'noopener');
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-gray-700 transition hover:bg-gray-50"
              >
                <BookOpen size={13} className="text-gray-400" />
                API 文档
                <ExternalLink size={10} className="ml-auto text-gray-300" />
              </button>
              <Link
                href="/landing"
                onClick={() => setMoreOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-gray-700 transition hover:bg-gray-50"
              >
                <Sparkles size={13} className="text-gray-400" />
                产品介绍
              </Link>

              <div className="my-1 h-px bg-gray-100" />

              <p className="px-2.5 py-1 text-[11px] text-gray-400">账户</p>
              <Link
                href="/settings"
                onClick={() => setMoreOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-gray-700 transition hover:bg-gray-50"
              >
                <Settings size={13} className="text-gray-400" />
                API Key 与 Webhook
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* 项目 / 对话 */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* 项目 */}
        {!collapsed && (
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] text-gray-400">项目</span>
            <button
              onClick={() => router.push('/dashboard?new=1')}
              title="新建项目"
              className="grid h-5 w-5 place-items-center rounded text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <Plus size={13} />
            </button>
          </div>
        )}

        {collapsed ? (
          <button
            onClick={() => router.push('/dashboard?new=1')}
            title="新建项目"
            className="flex h-9 w-full items-center justify-center rounded-lg text-gray-700 transition hover:bg-gray-100"
          >
            <FolderPlus size={16} strokeWidth={1.7} className="text-gray-500" />
          </button>
        ) : (
          <>
            <button
              onClick={() => router.push('/dashboard?new=1')}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-gray-700 transition hover:bg-gray-100"
            >
              <FolderPlus size={16} strokeWidth={1.7} className="shrink-0 text-gray-500" />
              新建项目
            </button>

            {!user && (
              <p className="px-2.5 py-1 text-[11.5px] text-gray-400">
                <Link href="/login" className="text-indigo-600 hover:underline">
                  登录
                </Link>{' '}
                后可管理项目
              </p>
            )}

            {user && projectsLoading && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                加载中…
              </div>
            )}

            {user && !projectsLoading && projects.length === 0 && (
              <p className="px-2.5 py-1 text-[11.5px] text-gray-300">暂无项目</p>
            )}

            {user &&
              !projectsLoading &&
              projects.slice(0, 4).map((project) => (
                <Link
                  key={project.id}
                  href={`/dashboard?project=${project.id}`}
                  title={project.name}
                  className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                >
                  <FolderOpen size={13} className="shrink-0 text-gray-400" />
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto shrink-0 text-[10.5px] text-gray-300">{project.dataset_count}</span>
                </Link>
              ))}

            {user && projects.length > 4 && (
              <Link
                href="/dashboard"
                className="flex h-8 items-center rounded-lg px-2.5 text-[11.5px] text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                查看全部 {projects.length} 个项目
              </Link>
            )}
          </>
        )}

        {/* 对话 */}
        {!collapsed && (
          <>
            <p className="mt-3 px-2 py-1.5 text-[11px] text-gray-400">对话</p>
            {conversations.length === 0 ? (
              <button
                onClick={startNewSession}
                className="w-full rounded-lg px-2.5 py-1 text-left text-[12px] text-gray-300 transition hover:text-gray-500"
              >
                暂无对话，点击开始
              </button>
            ) : (
              <div className="space-y-0.5">
                {conversations.map((conv) => {
                  const active = conv.id === currentConvId;
                  return (
                    <Link
                      key={conv.id}
                      href={`/chat/${conv.id}`}
                      title={conv.title}
                      aria-current={active ? 'page' : undefined}
                      className={`group flex h-8 items-center justify-between rounded-lg px-2.5 text-[13px] transition ${
                        active ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="truncate">{conv.title}</span>
                      <button
                        onClick={(e) => handleDeleteConversation(e, conv)}
                        className="hidden shrink-0 rounded p-0.5 text-gray-400 transition hover:text-red-500 group-hover:block"
                        title="删除对话"
                        aria-label={`删除对话 ${conv.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部 */}
      <div className="border-t border-gray-50 p-2">
        {!collapsed ? (
          <button
            onClick={() => setInviteOpen(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-left transition hover:bg-gray-100"
          >
            <Gift size={16} className="shrink-0 text-gray-500" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium text-gray-800">邀请有奖</span>
              <span className="block truncate text-[11px] text-gray-400">获 1 年会员权益</span>
            </span>
            <ChevronRight size={14} className="shrink-0 text-gray-400" />
          </button>
        ) : (
          <button
            onClick={() => setInviteOpen(true)}
            title="邀请有奖"
            className="mb-2 flex h-9 w-full items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100"
          >
            <Gift size={16} />
          </button>
        )}

        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-expanded={userMenuOpen}
            className={`flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-gray-50 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 text-[11px] font-semibold text-white">
              {(user?.name || 'G').slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-gray-800">
                    {user?.name || '游客'}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-gray-400">
                    <Sparkles size={10} />
                    {user ? (user.plan === 'free' ? '免费版' : user.plan) : '未登录'}
                  </span>
                </span>
                <ChevronsUpDown size={13} className="shrink-0 text-gray-400" />
              </>
            )}
          </button>

          {userMenuOpen && (
            <div
              className={`absolute bottom-12 z-30 w-52 rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl ${
                collapsed ? 'left-12' : 'left-0'
              }`}
            >
              <div className="px-2.5 py-1.5">
                <p className="truncate text-[12.5px] font-medium text-gray-800">{user?.name || '游客'}</p>
                <p className="truncate text-[11px] text-gray-400">{user?.email || '未登录，部分功能不可用'}</p>
              </div>
              <div className="my-1 h-px bg-gray-100" />
              {user ? (
                <>
                  <Link
                    href="/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 transition hover:bg-gray-50"
                  >
                    <Settings size={14} className="text-gray-400" />
                    账户设置
                  </Link>
                  <Link
                    href="/landing#pricing"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-700 transition hover:bg-gray-50"
                  >
                    <Sparkles size={14} className="text-gray-400" />
                    升级套餐
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut size={14} />
                    退出登录
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-indigo-600 transition hover:bg-indigo-50"
                >
                  <LogOut size={14} />
                  登录 / 注册
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 邀请弹窗 */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="邀请有奖"
        description="把链接分享给同事，双方各得 1 个月 Pro 权益（MVP 阶段仅做展示）。"
        footer={
          <>
            <button onClick={() => setInviteOpen(false)} className="rounded-lg px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-100">
              关闭
            </button>
            <button
              onClick={handleCopyInvite}
              className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-700"
            >
              <Copy size={13} />
              {copied ? '已复制' : '复制邀请链接'}
            </button>
          </>
        }
      >
        <div className="rounded-xl bg-gray-50 px-3 py-2.5 font-mono text-[12px] text-gray-600">
          {typeof window !== 'undefined' ? `${window.location.origin}/?ref=invite` : '/?ref=invite'}
        </div>
      </Modal>
    </aside>
  );
}

export default Sidebar;
