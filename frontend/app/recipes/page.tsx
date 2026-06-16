'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles, Loader2, Trash2, Play, Tag, ArrowRight,
  BookOpen, RotateCcw, Shield, Calendar, Filter, Type, XCircle,
} from 'lucide-react';
import { getRecipes, deleteRecipe, type Recipe } from '@/lib/api';

const OP_ICONS: Record<string, typeof Shield> = {
  dedup: RotateCcw, pii_mask: Shield, date_standardize: Calendar,
  outlier: Filter, missing: XCircle, text_clean: Type,
};

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRecipes()
      .then(setRecipes)
      .catch(() => setError('Failed to load recipes'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recipe?')) return;
    try {
      await deleteRecipe(id);
      setRecipes((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError('Failed to delete recipe');
    }
  };

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
            <h1 className="text-2xl font-bold text-gray-900">My Recipes</h1>
            <p className="mt-1 text-sm text-gray-500">
              Saved cleaning workflows you can reuse on new datasets
            </p>
          </div>
          <Link href="/upload" className="btn-primary text-sm">
            <Play className="mr-2 h-4 w-4" />
            New Cleaning Session
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {!loading && recipes.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-lg font-medium text-gray-500">No recipes yet</p>
            <p className="mt-1 text-sm text-gray-400">
              Run a cleaning session and save the result as a recipe to get started.
            </p>
            <Link href="/upload" className="btn-primary mt-6 inline-flex">
              Upload Data <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        )}

        {recipes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecipeCard({ recipe, onDelete }: { recipe: Recipe; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{recipe.name}</h3>
          {recipe.description && (
            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{recipe.description}</p>
          )}
        </div>
        <button
          onClick={() => onDelete(recipe.id)}
          className="ml-2 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          title="Delete recipe"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Steps preview */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {recipe.steps.map((step, i) => {
          const Icon = OP_ICONS[step.operation] || Tag;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
            >
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
        <span>{recipe.steps.length} step{recipe.steps.length !== 1 ? 's' : ''}</span>
        <span>Used {recipe.usage_count} time{recipe.usage_count !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
