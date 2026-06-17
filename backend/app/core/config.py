from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_env: str = "development"
    app_secret_key: str = "change-me-to-a-random-string"
    app_cors_origins: str = "http://localhost:3000"

    # Database
    database_url: str = "sqlite+aiosqlite:///./datacleanr.db"

    # AI
    ai_provider: str = "glm"  # glm | anthropic
    anthropic_api_key: str = ""
    glm_api_key: str = ""
    glm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    glm_model: str = "glm-4.5-air"

    # Storage
    storage_backend: str = "local"  # local | s3 | r2
    local_storage_path: str = "./uploads"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # GitHub OAuth
    github_client_id: str = ""
    github_client_secret: str = ""

    # JWT Auth
    jwt_secret_key: str = "change-me-jwt-secret-key-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 168  # 7 days

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Limits
    max_upload_size_mb: int = 100
    max_rows_free: int = 5000
    max_rows_pro: int = 500000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
