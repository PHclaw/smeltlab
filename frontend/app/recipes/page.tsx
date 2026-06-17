'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles, Loader2, Trash2, Play, Tag, ArrowRight,
  BookOpen, RotateCcw, Shield, Calendar, Filter, Type, XCircle,
  Globe, Lock, Share2, Search, Users,
} from 'lucide-react';
import {
  getRecipes, deleteRecipe, shareRecipe, unshareRecipe,
  searchCommunityRecipes, applyRecipeToDataset,
  type Recipe,
} from '@/lib/api';

const OP_ICONS: Record<string, typeof Shield> = {
  dedup: RotateCcw, pii_mask: Shield, date_standardize: Calendar,
  outlier: Filter, missing: XCircle, text_clean: Type,
  llm_validate: BookOpen, label_normalize: Tag, sample: Filter,
};

type Tab = 'mine' | 'community';

export default function RecipesPage() {
  const [tab, setTab] = useState<Tab>('mine');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [communityRecipes, setCommunityRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTag, setSearchTag] = useState('');

  useEffect(() => {
    if (tab === 'mine') {
      setLoading(true);
      getRecipes()
        .then(setRecipes)
        .catch(() => setError('Failed to load recipes'))
        .finally(() => setLoading(false));
    } else {
      setLoading(true);
      searchCommunityRecipes(searchQuery, searchTag)
        .then(setCommunityRecipes)
        .catch(() => setError('Failed to load community recipes'))
        .finally(() => setLoading(false));
    }
  }, [tab, searchQuery, searchTag]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recipe?')) return;
    try {
      await deleteRecipe(id);
      setRecipes((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError('Failed to delete recipe');
    }
  };

  const handleToggleShare = async (recipe: Recipe) => {
    try {
      if (recipe.is_public) {
        await unshareRecipe(recipe.id);
        setRecipes((prev) => prev.map((r) => r.id === recipe.id ? { ...r, is_public: false } : r));
      } else {
        await shareRecipe(recipe.id);
        setRecipes((prev) => prev.map((r) => r.id === recipe.id ? { ...r, is_public: true } : r));
      }
    } catch {
      setError('Failed to toggle share');
    }
  };

  const allTags = Array.from(new Set(recipes.flatMap((r) => r.tags)));

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
          <nav className="flex items-center gap-4 text-sm text-gray-500">
            <Link href="/upload" className="hover:text-gray-900">Upload</Link>
            <span className="text-primary-600 font-medium">Recipes</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recipes</h1>
            <p className="mt-1 text-sm text-gray-500">
              Saved cleaning workflows — use them or share with the community
            </p>
          </div>
          <Link href="/upload" className="btn-primary text-sm">
            <Play className="mr-2 h-4 w-4" />
            New Session
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setTab('mine')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'mine' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            My Recipes ({recipes.length})
          </button>
          <button
            onClick={() => setTab('community')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === 'community' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="h-4 w-4" />
            Community
          </button>
        </div>

        {/* Community search */}
        {tab === 'community' && (
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search community recipes..."
                className="input pl-10"
              />
            </div>
            {allTags.length > 0 && (
              <select
                value={searchTag}
                onChange={(e) => setSearchTag(e.target.value)}
                className="input w-auto"
              >
                <option value="">All tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 mb-4">{error}</div>
        )}

        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        )}

        {/* My Recipes */}
        {tab === 'mine' && !loading && recipes.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-lg font-medium text-gray-500">No recipes yet</p>
            <p className="mt-1 text-sm text-gray-400">
              Run a cleaning session and save the result as a recipe.
            </p>
            <Link href="/upload" className="btn-primary mt-6 inline-flex">
              Upload Data <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        )}

        {tab === 'mine' && recipes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onDelete={handleDelete}
                onToggleShare={handleToggleShare}
              />
            ))}
          </div>
        )}

        {/* Community Recipes */}
        {tab === 'community' && !loading && communityRecipes.length === 0 && (
          <div className="text-center py-20">
            <Globe className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-lg font-medium text-gray-500">
              {searchQuery ? 'No recipes match your search' : 'No community recipes yet'}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Share your recipes to build the community!
            </p>
          </div>
        )}

        {tab === 'community' && communityRecipes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {communityRecipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} isCommunity />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecipeCard({
  recipe,
  onDelete,
  onToggleShare,
  isCommunity = false,
}: {
  recipe: Recipe;
  onDelete?: (id: string) => void;
  onToggleShare?: (recipe: Recipe) => void;
  isCommunity?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{recipe.name}</h3>
            {recipe.is_public && (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
                <Globe className="h-3 w-3" /> Public
              </span>
            )}
            {!recipe.is_public && !isCommunity && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                <Lock className="h-3 w-3" /> Private
              </span>
            )}
          </div>
          {recipe.description && (
            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{recipe.description}</p>
          )}
        </div>
        {!isCommunity && onDelete && (
          <button
            onClick={() => onDelete(recipe.id)}
            className="ml-2 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {recipe.steps.map((step, i) => {
          const Icon = OP_ICONS[step.operation] || Tag;
          return (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
              <Icon className="h-3 w-3" />
              {step.operation}
            </span>
          );
        })}
      </div>

      {/* Tags */}
      {recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {recipe.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] text-primary-600">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-2">
        <span>{recipe.steps.length} steps · Used {recipe.usage_count}x</span>
        {!isCommunity && onToggleShare && (
          <button
            onClick={() => onToggleShare(recipe)}
            className={`inline-flex items-center gap-1 font-medium transition-colors ${
              recipe.is_public ? 'text-emerald-600 hover:text-emerald-700' : 'text-gray-400 hover:text-primary-600'
            }`}
          >
            <Share2 className="h-3 w-3" />
            {recipe.is_public ? 'Unshare' : 'Share'}
          </button>
        )}
        {isCommunity && recipe.author && (
          <span className="text-gray-400">by {recipe.author}</span>
        )}
      </div>
    </div>
  );
}
