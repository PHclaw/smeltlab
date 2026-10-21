'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, FolderOpen, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import AppShell from '@/components/agent/AppShell';
import { PROJECTS_CHANGED } from '@/components/agent/Sidebar';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { getProjectDatasets, uploadFile, type ProjectDataset } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

interface Project {
  id: string;
  name: string;
  description: string;
  dataset_count: number;
  created_at: string;
  updated_at: string;
}

const PRIMARY_BTN =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-40';
const SECONDARY_BTN =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-600 transition hover:border-gray-300 hover:bg-gray-50';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectDatasets, setProjectDatasets] = useState<ProjectDataset[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);
  const datasetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // 侧边栏「新建项目」/「项目条目」带着查询参数跳过来
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') {
      setShowNewDialog(true);
      window.history.replaceState(null, '', '/dashboard');
    }
    const projectId = params.get('project');
    if (projectId) {
      setHighlightId(projectId);
      window.history.replaceState(null, '', '/dashboard');
    }
  }, []);

  useEffect(() => {
    if (showNewDialog) {
      const timer = setTimeout(() => newInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [showNewDialog]);

  const loadProjects = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setProjects(await res.json());
    } catch {
      /* 忽略网络错误 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadProjectDatasets = async (projectId: string) => {
    setDatasetLoading(true);
    try {
      setProjectDatasets(await getProjectDatasets(projectId));
    } catch {
      setProjectDatasets([]);
    } finally {
      setDatasetLoading(false);
    }
  };

  const openProject = (project: Project) => {
    setActiveProject(project);
    setProjectDatasets([]);
    loadProjectDatasets(project.id);
  };

  const handleUploadDataset = async (files: FileList | null) => {
    if (!files?.length || !activeProject) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(file, activeProject.id);
      }
      await loadProjectDatasets(activeProject.id);
      await loadProjects();
      window.dispatchEvent(new Event(PROJECTS_CHANGED));
      toast({ title: '数据集已上传', variant: 'success' });
    } catch (err) {
      toast({ title: '上传失败', description: err instanceof Error ? err.message : '', variant: 'error' });
    } finally {
      setUploading(false);
      if (datasetInputRef.current) datasetInputRef.current.value = '';
    }
  };

  const handleCreateProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects((prev) => [project, ...prev]);
        setShowNewDialog(false);
        setNewName('');
        setNewDesc('');
        toast({ title: `项目「${project.name}」已创建`, variant: 'success' });
        window.dispatchEvent(new Event(PROJECTS_CHANGED));
      } else {
        toast({ title: '创建项目失败', variant: 'error' });
      }
    } catch {
      toast({ title: '创建项目失败，请检查网络', variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  // 从侧边栏带着 project=xxx 过来时，直接打开该项目
  useEffect(() => {
    if (!highlightId || !projects.length) return;
    const target = projects.find((p) => p.id === highlightId);
    if (target) openProject(target);
    setHighlightId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, highlightId]);

  const handleDeleteProject = async (id: string) => {
    if (!confirm('确定删除这个项目？')) return;
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast({ title: '项目已删除' });
      window.dispatchEvent(new Event(PROJECTS_CHANGED));
    } else {
      toast({ title: '删除失败', variant: 'error' });
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={18} className="animate-spin text-gray-300" />
      </div>
    );
  }

  if (!user) return null;

  const datasetTotal = projects.reduce((sum, p) => sum + p.dataset_count, 0);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-6">
        {/* 标题 */}
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-gray-900">数据集</h1>
            <p className="mt-1 text-[12.5px] text-gray-400">
              {user.name}，在这里管理项目与数据集
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/" className={SECONDARY_BTN}>
              <Sparkles size={13} />
              开始清洗
            </Link>
            <button onClick={() => setShowNewDialog(true)} className={PRIMARY_BTN}>
              <Plus size={13} />
              新建项目
            </button>
          </div>
        </header>

        {/* 概览 */}
        <div className="mb-6 flex items-center gap-6 rounded-xl border border-gray-100 px-4 py-3">
          <div>
            <div className="text-[18px] font-semibold leading-6 text-gray-900">{projects.length}</div>
            <div className="text-[11px] text-gray-400">项目</div>
          </div>
          <div className="h-7 w-px bg-gray-100" />
          <div>
            <div className="text-[18px] font-semibold leading-6 text-gray-900">{datasetTotal}</div>
            <div className="text-[11px] text-gray-400">数据集</div>
          </div>
          <div className="h-7 w-px bg-gray-100" />
          <div>
            <div className="text-[18px] font-semibold capitalize leading-6 text-gray-900">{user.plan}</div>
            <div className="text-[11px] text-gray-400">当前套餐</div>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-gray-700">我的项目</h2>
          {projects.length > 0 && <span className="text-[11.5px] text-gray-400">{projects.length} 个</span>}
        </div>

        {loading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[96px] animate-pulse rounded-xl border border-gray-100 bg-gray-50/60" />
            ))}
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 px-6 py-16 text-center">
            <FolderOpen size={20} className="mx-auto text-gray-300" />
            <p className="mt-3 text-[13px] text-gray-600">还没有项目</p>
            <p className="mt-1 text-[12px] text-gray-400">创建项目，把相关的数据集和会话归类到一起</p>
            <button onClick={() => setShowNewDialog(true)} className={`mt-4 inline-flex ${PRIMARY_BTN}`}>
              <Plus size={13} />
              创建第一个项目
            </button>
          </div>
        )}

        {!loading && projects.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => (
              <div
                key={project.id}
                id={`project-${project.id}`}
                onClick={() => openProject(project)}
                className={`group cursor-pointer rounded-xl border bg-white p-4 transition ${
                  highlightId === project.id
                    ? 'border-gray-900'
                    : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gray-50 text-gray-400">
                      <FolderOpen size={14} />
                    </span>
                    <span className="truncate text-[13px] font-medium text-gray-900">{project.name}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id);
                    }}
                    className="shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    title="删除项目"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {project.description && (
                  <p className="mb-2 line-clamp-2 text-[12px] leading-5 text-gray-400">{project.description}</p>
                )}

                <div className="flex items-center justify-between border-t border-gray-50 pt-2 text-[11px] text-gray-400">
                  <span>{project.dataset_count} 个数据集</span>
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        title="新建项目"
        description="项目用来归类同一批数据与清洗记录"
        footer={
          <>
            <button
              onClick={() => setShowNewDialog(false)}
              className="h-8 rounded-lg px-3 text-[12.5px] text-gray-600 transition hover:bg-gray-100"
            >
              取消
            </button>
            <button
              onClick={handleCreateProject}
              disabled={!newName.trim() || creating}
              className="h-8 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
            >
              {creating ? '创建中…' : '创建项目'}
            </button>
          </>
        }
      >
        <div className="space-y-2.5">
          <input
            ref={newInputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            placeholder="项目名称"
            className="h-9 w-full rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            autoFocus
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            placeholder="描述（可选）"
            className="h-9 w-full rounded-lg border border-gray-200 px-3 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
          />
        </div>
      </Modal>

      {/* 项目详情：数据集管理 */}
      <Modal
        open={Boolean(activeProject)}
        onClose={() => setActiveProject(null)}
        title={activeProject?.name || '项目'}
        description="项目下的数据集，可直接上传与导出"
        widthClass="max-w-lg"
        footer={
          <button
            onClick={() => setActiveProject(null)}
            className="h-8 rounded-lg px-3 text-[12.5px] text-gray-600 transition hover:bg-gray-100"
          >
            关闭
          </button>
        }
      >
        <div className="space-y-3">
          <button
            onClick={() => datasetInputRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 py-3 text-[12.5px] text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? '上传中…' : '上传数据集（CSV / Excel / JSON）'}
          </button>
          <input
            ref={datasetInputRef}
            type="file"
            multiple
            accept=".csv,.json,.jsonl,.xlsx,.xls,.parquet,.txt,.md"
            className="hidden"
            onChange={(e) => handleUploadDataset(e.target.files)}
          />

          {datasetLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 size={15} className="animate-spin text-gray-300" />
            </div>
          ) : projectDatasets.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-gray-300">还没有数据集</p>
          ) : (
            <div className="space-y-1.5">
              {projectDatasets.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-3 py-2"
                >
                  <FileText size={13} className="shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-gray-900">{d.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {d.row_count} 行 · {d.col_count} 列 ·{' '}
                      {d.file_size_bytes > 1024 * 1024
                        ? `${(d.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                        : `${Math.max(1, Math.round(d.file_size_bytes / 1024))} KB`}
                    </p>
                  </div>
                  <a
                    href={`${API_BASE}/datasets/${d.id}/export`}
                    className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
                  >
                    导出
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}
