"""
Recipe Service — Save and reuse cleaning workflows.

A Recipe is a saved sequence of cleaning steps that can be applied
to new datasets for consistent, repeatable data cleaning.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

import polars as pl

from app.core import store
from app.services.cleaner import (
    CleanPlan,
    CleanResult,
    CleanStep,
    execute_clean_plan,
)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class RecipeStep:
    """A single step in a recipe."""
    step_id: str
    operation: str
    description: str
    config: dict[str, Any] = field(default_factory=dict)


@dataclass
class Recipe:
    """A reusable cleaning recipe."""
    id: str
    name: str
    description: str = ""
    steps: list[RecipeStep] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    usage_count: int = 0
    created_at: str = ""
    is_public: bool = False
    author: str = ""  # user_id or "system"

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()


# In-memory store（写操作同步落盘）
_recipes: dict[str, Recipe] = {}


def _persist() -> None:
    store.save("recipes", [asdict(r) for r in _recipes.values()])


def _restore() -> None:
    for item in store.load("recipes", []):
        steps = []
        for raw in item.get("steps", []) or []:
            try:
                steps.append(RecipeStep(**raw))
            except TypeError:
                continue
        item = {**item, "steps": steps}
        try:
            recipe = Recipe(**item)
        except TypeError:
            continue
        _recipes[recipe.id] = recipe


_restore()


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def create_recipe(
    name: str,
    steps: list[dict[str, Any]],
    description: str = "",
    tags: list[str] | None = None,
    is_public: bool = False,
    author: str = "",
) -> Recipe:
    """Create a new recipe."""
    recipe_id = str(uuid.uuid4())

    recipe_steps = []
    for s in steps:
        recipe_steps.append(RecipeStep(
            step_id=s.get("step_id", f"step_{len(recipe_steps)}"),
            operation=s["operation"],
            description=s.get("description", ""),
            config=s.get("config", {}),
        ))

    recipe = Recipe(
        id=recipe_id,
        name=name,
        description=description,
        steps=recipe_steps,
        tags=tags or [],
        is_public=is_public,
        author=author,
    )
    _recipes[recipe_id] = recipe
    _persist()
    return recipe


def get_recipe(recipe_id: str) -> Recipe | None:
    """Get a recipe by ID."""
    return _recipes.get(recipe_id)


def list_recipes(author: str | None = None) -> list[Recipe]:
    """List recipes, sorted by creation date (newest first).

    传入 ``author`` 时只返回该用户的配方。
    """
    items = [
        r for r in _recipes.values() if author is None or r.author == author
    ]
    return sorted(items, key=lambda r: r.created_at, reverse=True)


def list_community_recipes(query: str = "", tag: str = "") -> list[Recipe]:
    """List public community recipes, optionally filtered."""
    results = [r for r in _recipes.values() if r.is_public]

    if query:
        q = query.lower()
        results = [r for r in results if q in r.name.lower() or q in r.description.lower()]

    if tag:
        results = [r for r in results if tag in r.tags]

    # Sort by usage_count (most popular first), then by date
    return sorted(results, key=lambda r: (-r.usage_count, r.created_at))


def _owned(recipe_id: str, user_id: str | None) -> Recipe | None:
    recipe = _recipes.get(recipe_id)
    if not recipe:
        return None
    if user_id is not None and recipe.author != user_id:
        return None
    return recipe


def share_recipe(recipe_id: str, user_id: str | None = None) -> Recipe | None:
    """Make a recipe public."""
    recipe = _owned(recipe_id, user_id)
    if recipe:
        recipe.is_public = True
        _persist()
    return recipe


def unshare_recipe(recipe_id: str, user_id: str | None = None) -> Recipe | None:
    """Make a recipe private."""
    recipe = _owned(recipe_id, user_id)
    if recipe:
        recipe.is_public = False
        _persist()
    return recipe


def delete_recipe(recipe_id: str, user_id: str | None = None) -> bool:
    """Delete a recipe. Returns True if found and deleted."""
    recipe = _owned(recipe_id, user_id)
    if not recipe:
        return False
    del _recipes[recipe_id]
    _persist()
    return True


def increment_usage(recipe_id: str) -> None:
    """Increment the usage count of a recipe."""
    recipe = _recipes.get(recipe_id)
    if recipe:
        recipe.usage_count += 1
        _persist()


# ---------------------------------------------------------------------------
# Apply recipe to dataset
# ---------------------------------------------------------------------------

async def apply_recipe(
    recipe_id: str,
    df: pl.DataFrame,
) -> CleanResult:
    """Apply a recipe to a DataFrame."""
    recipe = _recipes.get(recipe_id)
    if not recipe:
        raise ValueError(f"Recipe not found: {recipe_id}")

    if not recipe.steps:
        raise ValueError("Recipe has no steps")

    # Convert recipe steps to CleanPlan
    plan = CleanPlan(
        steps=[
            CleanStep(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
            )
            for s in recipe.steps
        ],
        reasoning=f"Applied recipe: {recipe.name}",
    )

    # Execute
    result = await execute_clean_plan(df, plan)

    # Increment usage
    increment_usage(recipe_id)

    return result
