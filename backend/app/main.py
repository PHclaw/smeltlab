from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.api.routes import datasets, clean, health, recipes, auth, projects

settings = get_settings()

app = FastAPI(
    title="DataCleanr API",
    description="AI-powered data cleaning pipeline for ML engineers",
    version="0.1.0",
)

# CORS
origins = [o.strip() for o in settings.app_cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(datasets.router, prefix="/api/datasets", tags=["datasets"])
app.include_router(clean.router, prefix="/api/clean", tags=["clean"])
app.include_router(recipes.router, prefix="/api/recipes", tags=["recipes"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])


@app.get("/")
async def root():
    return {
        "name": "DataCleanr API",
        "version": "0.1.0",
        "docs": "/docs",
    }
