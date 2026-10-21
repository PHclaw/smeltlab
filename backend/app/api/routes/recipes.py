"""Recipe endpoints — CRUD and apply recipes to datasets."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.api.routes.datasets import _dataframes
from app.middleware.auth import User, get_current_user, get_optional_user
from app.services.apikeys import fire_webhooks
from app.schemas.api import (
    BatchApplyRecipeRequest,
    BatchApplyRecipeResponse,
    BatchApplyResultSchema,
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
    list_community_recipes,
    share_recipe,
    unshare_recipe,
    apply_recipe,
)

router = APIRouter()


@router.get("", response_model=list[RecipeResponse])
async def get_recipes(user: User = Depends(get_current_user)):
    """List the current user's saved recipes."""
    recipes = list_recipes(author=user.id)
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
            is_public=r.is_public,
            author=r.author,
        )
        for r in recipes
    ]


@router.post("", response_model=RecipeResponse)
async def create_new_recipe(request: CreateRecipeRequest, user: User = Depends(get_current_user)):
    """Create a new recipe from a set of cleaning steps."""
    if not request.steps:
        raise HTTPException(400, "Recipe must have at least one step")

    recipe = create_recipe(
        name=request.name,
        steps=[s.model_dump() for s in request.steps],
        description=request.description,
        tags=request.tags,
        is_public=request.is_public,
        author=user.id,
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
        is_public=recipe.is_public,
        author=recipe.author,
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
async def remove_recipe(recipe_id: str, user: User = Depends(get_current_user)):
    """Delete a recipe."""
    if not delete_recipe(recipe_id, user_id=user.id):
        raise HTTPException(404, "Recipe not found")
    return {"status": "deleted"}


@router.post("/{recipe_id}/apply/{dataset_id}", response_model=CleanResultResponse)
async def apply_recipe_to_dataset(
    recipe_id: str,
    dataset_id: str,
    user: User | None = Depends(get_optional_user),
):
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

    if user:
        asyncio.create_task(
            fire_webhooks(
                user.id,
                "recipe.applied",
                {
                    "recipe_id": recipe_id,
                    "dataset_id": dataset_id,
                    "rows_before": result.rows_before,
                    "rows_after": result.rows_after,
                },
            )
        )

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


@router.post("/batch-apply", response_model=BatchApplyRecipeResponse)
async def batch_apply_recipe(request: BatchApplyRecipeRequest):
    """Apply a recipe to multiple datasets at once."""
    recipe = get_recipe(request.recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")

    if not request.dataset_ids:
        raise HTTPException(400, "No dataset IDs provided")

    batch_id = f"batch_{request.recipe_id}"
    results = []

    for dataset_id in request.dataset_ids:
        df = _dataframes.get(dataset_id)
        if df is None:
            results.append(BatchApplyResultSchema(
                dataset_id=dataset_id,
                dataset_name="unknown",
                status="failed",
                error="Dataset not found",
            ))
            continue

        dataset_info = _dataframes.get(dataset_id)
        # Get dataset name from the datasets store
        from app.api.routes.datasets import _datasets as ds_store
        ds_name = ds_store.get(dataset_id, {}).get("name", dataset_id[:8])

        try:
            result = await apply_recipe(request.recipe_id, df)
            # Store cleaned DataFrame
            clean_key = f"{dataset_id}_recipe_{request.recipe_id}"
            _dataframes[clean_key] = result.df_clean

            results.append(BatchApplyResultSchema(
                dataset_id=dataset_id,
                dataset_name=ds_name,
                status="done",
                rows_before=result.rows_before,
                rows_after=result.rows_after,
                total_changes=result.total_changes,
            ))
        except Exception as e:
            results.append(BatchApplyResultSchema(
                dataset_id=dataset_id,
                dataset_name=ds_name,
                status="failed",
                error=str(e),
            ))

    return BatchApplyRecipeResponse(
        batch_id=batch_id,
        recipe_id=request.recipe_id,
        results=results,
    )


# ---------------------------------------------------------------------------
# Community marketplace
# ---------------------------------------------------------------------------

@router.get("/community/search", response_model=list[RecipeResponse])
async def search_community(query: str = "", tag: str = ""):
    """Search public community recipes."""
    recipes = list_community_recipes(query=query, tag=tag)
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
            is_public=r.is_public,
            author=r.author,
        )
        for r in recipes
    ]


@router.post("/{recipe_id}/share")
async def share(recipe_id: str, user: User = Depends(get_current_user)):
    """Make a recipe public."""
    r = share_recipe(recipe_id, user_id=user.id)
    if not r:
        raise HTTPException(404, "Recipe not found")
    return {"status": "shared", "recipe_id": recipe_id}


@router.post("/{recipe_id}/unshare")
async def unshare(recipe_id: str, user: User = Depends(get_current_user)):
    """Make a recipe private."""
    r = unshare_recipe(recipe_id, user_id=user.id)
    if not r:
        raise HTTPException(404, "Recipe not found")
    return {"status": "unshared", "recipe_id": recipe_id}
