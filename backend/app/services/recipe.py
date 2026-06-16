"""
Recipe Service — Save and reuse cleaning workflows.

A Recipe is a saved sequence of cleaning steps that can be applied
to new datasets for consistent, repeatable data cleaning.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import polars as pl

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

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()


# In-memory store
_recipes: dict[str, Recipe] = {}


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def create_recipe(
    name: str,
    steps: list[dict[str, Any]],
    description: str = "",
    tags: list[str] | None = None,
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
    )
    _recipes[recipe_id] = recipe
    return recipe


def get_recipe(recipe_id: str) -> Recipe | None:
    """Get a recipe by ID."""
    return _recipes.get(recipe_id)


def list_recipes() -> list[Recipe]:
    """List all recipes, sorted by creation date (newest first)."""
    return sorted(_recipes.values(), key=lambda r: r.created_at, reverse=True)


def delete_recipe(recipe_id: str) -> bool:
    """Delete a recipe. Returns True if found and deleted."""
    if recipe_id in _recipes:
        del _recipes[recipe_id]
        return True
    return False


def increment_usage(recipe_id: str) -> None:
    """Increment the usage count of a recipe."""
    if recipe_id in _recipes:
        _recipes[recipe_id].usage_count += 1


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
