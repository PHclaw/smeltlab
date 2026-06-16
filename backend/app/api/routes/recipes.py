"""Recipe endpoints — CRUD and apply recipes to datasets."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.routes.datasets import _dataframes
from app.schemas.api import (
    ChangeRecordSchema,
    CleanResultResponse,
    CleanStepSchema,
    CreateRecipeRequest,
    RecipeResponse,
    RecipeStepSchema,
)
from app.services.recipe import (
    create_recipe,
    delete_recipe,
    get_recipe,
    list_recipes,
    apply_recipe,
)

router = APIRouter()


@router.get("", response_model=list[RecipeResponse])
async def get_recipes():
    """List all saved recipes."""
    recipes = list_recipes()
    return [
        RecipeResponse(
            id=r.id,
            name=r.name,
            description=r.description,
            steps=[
                RecipeStepSchema(
                    step_id=s.step_id,
                    operation=s.operation,
                    description=s.description,
                    config=s.config,
                )
                for s in r.steps
            ],
            tags=r.tags,
            usage_count=r.usage_count,
            created_at=r.created_at,
        )
        for r in recipes
    ]


@router.post("", response_model=RecipeResponse)
async def create_new_recipe(request: CreateRecipeRequest):
    """Create a new recipe from a set of cleaning steps."""
    if not request.steps:
        raise HTTPException(400, "Recipe must have at least one step")

    recipe = create_recipe(
        name=request.name,
        steps=[s.model_dump() for s in request.steps],
        description=request.description,
        tags=request.tags,
    )

    return RecipeResponse(
        id=recipe.id,
        name=recipe.name,
        description=recipe.description,
        steps=[
            RecipeStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
            )
            for s in recipe.steps
        ],
        tags=recipe.tags,
        usage_count=recipe.usage_count,
        created_at=recipe.created_at,
    )


@router.get("/{recipe_id}", response_model=RecipeResponse)
async def get_recipe_detail(recipe_id: str):
    """Get a recipe by ID."""
    recipe = get_recipe(recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")

    return RecipeResponse(
        id=recipe.id,
        name=recipe.name,
        description=recipe.description,
        steps=[
            RecipeStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
            )
            for s in recipe.steps
        ],
        tags=recipe.tags,
        usage_count=recipe.usage_count,
        created_at=recipe.created_at,
    )


@router.delete("/{recipe_id}")
async def remove_recipe(recipe_id: str):
    """Delete a recipe."""
    if not delete_recipe(recipe_id):
        raise HTTPException(404, "Recipe not found")
    return {"status": "deleted"}


@router.post("/{recipe_id}/apply/{dataset_id}", response_model=CleanResultResponse)
async def apply_recipe_to_dataset(recipe_id: str, dataset_id: str):
    """Apply a recipe to a dataset."""
    if dataset_id not in _dataframes:
        raise HTTPException(404, "Dataset not found")

    recipe = get_recipe(recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")

    df = _dataframes[dataset_id]

    try:
        result = await apply_recipe(recipe_id, df)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Recipe application failed: {e}")

    # Store cleaned DataFrame
    job_id = f"recipe_{recipe_id}_{dataset_id}"
    _dataframes[f"{dataset_id}_recipe_{recipe_id}"] = result.df_clean

    return CleanResultResponse(
        job_id=job_id,
        status="completed",
        reasoning=result.plan.reasoning,
        rows_before=result.rows_before,
        rows_after=result.rows_after,
        total_changes=result.total_changes,
        execution_time_ms=result.execution_time_ms,
        steps=[
            CleanStepSchema(
                step_id=s.step_id,
                operation=s.operation,
                description=s.description,
                config=s.config,
                rows_affected=s.rows_affected,
                status=s.status,
                error=s.error,
            )
            for s in result.plan.steps
        ],
        changes=[
            ChangeRecordSchema(
                row_index=c.row_index,
                column=c.column,
                before=c.before,
                after=c.after,
                operation=c.operation,
                step_id=c.step_id,
            )
            for c in result.changes[:500]
        ],
    )
