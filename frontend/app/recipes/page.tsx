'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Calendar, Filter, Globe, Lock, Play, RotateCcw, Search,
  Share2, Shield, Sparkles, Tag, Trash2, Type, XCircle,
} from 'lucide-react';
import {
  getRecipes, deleteRecipe, shareRecipe, unshareRecipe,
  searchCommunityRecipes,
  type Recipe,
} from '@/lib/api';
import AppShell from '@/components/agent/AppShell';
import { newConversationId, titleFrom, upsertConversation } from '@/lib/agent';
import { useAuth } from '@/lib/auth';

const OP_ICONS: Record<string, typeof Shield> = {
  dedup: RotateCcw, pii_mask: Shield, date_standardize: Calendar,
  outlier: Filter, missing: XCircle, text_clean: Type,
  llm_validate: BookOpen, label_normalize: Tag, sample: Filter,
  agent_instruction: Sparkles, agent_step: Tag,
};

const OP_LABELS: Record<string, string> = {
  agent_instruction: '对话指令',
  agent_step: '执行步骤',
};

type Tab = 'mine' | 'community';

export default function RecipesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('mine');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [communityRecipes, setCommunityRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTag, setSearchTag] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (tab === 'mine') {
      if (!user) {
        setRecipes([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      getRecipes()
        .then(setRecipes)
        .catch(() => setError('加载配方失败'))
        .finally(() => setLoading(false));
    } else {
      setLoading(true);
      searchCommunityRecipes(searchQuery, searchTag)
        .then(setCommunityRecipes)
        .catch(() => setError('加载社区配方失败'))
        .finally(() => setLoading(false));
    }
  }, [tab, searchQuery, searchTag, user, authLoading]);

  /** 用配方里的指令开一段新对话 */
  const handleUseRecipe = (recipe: Recipe) => {
    const instruction =
      recipe.steps.find((s) => s.operation === 'agent_instruction')?.config?.instruction ||
      recipe.steps.map((s) => s.description).filter(Boolean).join('\n') ||
      recipe.name;

    const id = newConversationId();
    const now = Date.now();
    upsertConversation({
      id,
      title: titleFrom(recipe.name),
      createdAt: now,
      updatedAt: now,
      messages: [{ id: `${now}`, role: 'user', content: instruction, createdAt: now }],
    });
    router.push(`/chat/${id}?autostart=1`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这个配方？')) return;
    try {
      await deleteRecipe(id);
      setRecipes((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError('删除失败');
    }
  };

  const handleToggleShare = async (recipe: Recipe) => {
    try {
      if (recipe.is_public) {
        await unshareRecipe(recipe.id);
        setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, is_public: false } : r)));
      } else {
        await shareRecipe(recipe.id);
        setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, is_public: true } : r)));
      }
    } catch {
      setError('操作失败');
    }
  };

  const allTags = Array.from(new Set(recipes.flatMap((r) => r.tags)));

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-6">
        {/* 标题 */}
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-gray-900">灵感库</h1>
            <p className="mt-1 text-[12.5px] text-gray-400">保存清洗流程，随时复用或分享给他人</p>
          </div>
          <Link
            href="/"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700"
          >
            <Play size={13} />
            开始清洗
          </Link>
        </header>

        {/* 分段 + 搜索 */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="inline-flex shrink-0 rounded-lg bg-gray-100 p-0.5">
            <button
              onClick={() => setTab('mine')}
              className={`h-7 rounded-[7px] px-3 text-[12.5px] transition ${
                tab === 'mine' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              我的配方 {recipes.length}
            </button>
            <button
              onClick={() => setTab('community')}
              className={`h-7 rounded-[7px] px-3 text-[12.5px] transition ${
                tab === 'community' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              社区
            </button>
          </div>

          {tab === 'community' && (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-[240px]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索社区配方…"
                  className="h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2.5 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                />
              </div>
              {allTags.length > 0 && (
                <select
                  value={searchTag}
                  onChange={(e) => setSearchTag(e.target.value)}
                  className="h-8 shrink-0 rounded-lg border border-gray-200 bg-white px-2 text-[12.5px] text-gray-600 focus:border-gray-400 focus:outline-none"
                >
                  <option value="">全部标签</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600">{error}</p>
        )}

        {loading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[118px] animate-pulse rounded-xl border border-gray-100 bg-gray-50/60" />
            ))}
          </div>
        )}

        {/* 我的配方 - 未登录 */}
        {tab === 'mine' && !loading && !user && (
          <div className="rounded-xl border border-dashed border-gray-200 px-6 py-16 text-center">
            <BookOpen size={20} className="mx-auto text-gray-300" />
            <p className="mt-3 text-[13px] text-gray-600">登录后查看你的配方</p>
            <p className="mt-1 text-[12px] text-gray-400">每段清洗流程都可以存下来，下次一键复用</p>
            <Link
              href="/login"
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700"
            >
              去登录
            </Link>
          </div>
        )}

        {/* 我的配方 - 空态 */}
        {tab === 'mine' && !loading && user && recipes.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 px-6 py-16 text-center">
            <BookOpen size={20} className="mx-auto text-gray-300" />
            <p className="mt-3 text-[13px] text-gray-600">还没有保存的配方</p>
            <p className="mt-1 text-[12px] text-gray-400">在一次清洗完成后，就可以把流程保存成配方</p>
            <Link
              href="/"
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700"
            >
              开始清洗
            </Link>
          </div>
        )}

        {tab === 'mine' && !loading && recipes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onUse={handleUseRecipe}
                onDelete={handleDelete}
                onToggleShare={handleToggleShare}
              />
            ))}
          </div>
        )}

        {/* 社区 - 空态 */}
        {tab === 'community' && !loading && communityRecipes.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 px-6 py-16 text-center">
            <Globe size={20} className="mx-auto text-gray-300" />
            <p className="mt-3 text-[13px] text-gray-600">
              {searchQuery ? '没有匹配的配方' : '社区里还没有公开配方'}
            </p>
            <p className="mt-1 text-[12px] text-gray-400">公开你的配方，帮助更多人少走弯路</p>
          </div>
        )}

        {tab === 'community' && !loading && communityRecipes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {communityRecipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} isCommunity onUse={handleUseRecipe} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RecipeCard({
  recipe,
  onUse,
  onDelete,
  onToggleShare,
  isCommunity = false,
}: {
  recipe: Recipe;
  onUse?: (recipe: Recipe) => void;
  onDelete?: (id: string) => void;
  onToggleShare?: (recipe: Recipe) => void;
  isCommunity?: boolean;
}) {
  return (
    <div className="group rounded-xl border border-gray-100 bg-white p-4 transition hover:border-gray-200">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-[13px] font-medium text-gray-900">{recipe.name}</h3>
            {recipe.is_public ? (
              <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-emerald-600">
                <Globe size={10} /> 公开
              </span>
            ) : (
              !isCommunity && (
                <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-gray-400">
                  <Lock size={10} /> 私有
                </span>
              )
            )}
          </div>
          {recipe.description && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-gray-400">{recipe.description}</p>
          )}
        </div>
        {!isCommunity && onDelete && (
          <button
            onClick={() => onDelete(recipe.id)}
            className="shrink-0 rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
            title="删除配方"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {recipe.steps.map((step, i) => {
          const Icon = OP_ICONS[step.operation] || Tag;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-500"
            >
              <Icon size={11} className="text-gray-400" />
              {OP_LABELS[step.operation] || step.operation}
            </span>
          );
        })}
      </div>

      {recipe.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {recipe.tags.map((tag) => (
            <span key={tag} className="text-[11px] text-gray-400">#{tag}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-gray-50 pt-2 text-[11px] text-gray-400">
        <div className="flex min-w-0 items-center gap-2">
          {onUse && (
            <button
              onClick={() => onUse(recipe)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-gray-700"
            >
              <Play size={10} />
              使用
            </button>
          )}
          <span className="truncate">{recipe.steps.length} 步 · 使用 {recipe.usage_count} 次</span>
        </div>
        {!isCommunity && onToggleShare && (
          <button
            onClick={() => onToggleShare(recipe)}
            className={`inline-flex items-center gap-1 transition ${
              recipe.is_public ? 'text-emerald-600 hover:text-emerald-700' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <Share2 size={11} />
            {recipe.is_public ? '取消公开' : '公开'}
          </button>
        )}
        {isCommunity && recipe.author && <span>by {recipe.author}</span>}
      </div>
    </div>
  );
}
