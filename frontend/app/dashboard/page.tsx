'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles, Loader2, Plus, FolderOpen, Trash2, BookOpen,
  LogOut, Upload, Settings, BarChart3,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

interface Project {
  id: string;
  name: string;
  description: string;
  dataset_count: number;
  created_at: string;
  updated_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('auth_token');
      if (token) {
        fetch(`${API_BASE}/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => res.json())
          .then(setProjects)
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    }
  }, [user]);

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
      }
    } catch {
      // Error handling
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    const token = localStorage.getItem('auth_token');
    await fetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <Link href="/" className="text-lg font-bold text-gray-900">DataCleanr</Link>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/upload" className="text-sm text-gray-500 hover:text-gray-900">Upload</Link>
            <Link href="/recipes" className="text-sm text-gray-500 hover:text-gray-900">Recipes</Link>
            <span className="text-sm text-primary-600 font-medium">Dashboard</span>
            <div className="flex items-center gap-2 ml-4 border-l border-gray-200 pl-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                {user.name[0]?.toUpperCase() || 'U'}
              </div>
              <span className="text-sm text-gray-700">{user.name}</span>
              <button onClick={logout} className="ml-1 text-gray-400 hover:text-red-500" title="Logout">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Welcome */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back, {user.name}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage your data cleaning projects
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/upload" className="btn-secondary text-sm">
              <Upload className="mr-2 h-4 w-4" />
              Upload Data
            </Link>
            <button onClick={() => setShowNewDialog(true)} className="btn-primary text-sm">
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="card py-4">
            <div className="text-2xl font-bold text-gray-900">{projects.length}</div>
            <div className="text-xs text-gray-500 mt-1">Projects</div>
          </div>
          <div className="card py-4">
            <div className="text-2xl font-bold text-gray-900">
              {projects.reduce((sum, p) => sum + p.dataset_count, 0)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Datasets</div>
          </div>
          <div className="card py-4">
            <div className="text-2xl font-bold text-primary-600 capitalize">{user.plan}</div>
            <div className="text-xs text-gray-500 mt-1">Plan</div>
          </div>
        </div>

        {/* Projects */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Projects</h2>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="text-center py-16 card">
            <FolderOpen className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-lg font-medium text-gray-500">No projects yet</p>
            <p className="mt-1 text-sm text-gray-400">
              Create a project to organize your data cleaning workflows.
            </p>
            <button
              onClick={() => setShowNewDialog(true)}
              className="btn-primary mt-6 inline-flex"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create First Project
            </button>
          </div>
        )}

        {projects.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div key={project.id} className="card hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100">
                    <FolderOpen className="h-5 w-5 text-primary-600" />
                  </div>
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <h3 className="text-sm font-semibold text-gray-900 truncate">{project.name}</h3>
                {project.description && (
                  <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{project.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-2">
                  <span>{project.dataset_count} datasets</span>
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md card mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New Project</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                className="input"
                autoFocus
              />
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="input"
              />
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowNewDialog(false)} className="btn-ghost text-sm">Cancel</button>
              <button
                onClick={handleCreateProject}
                disabled={!newName.trim() || creating}
                className="btn-primary text-sm"
              >
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
