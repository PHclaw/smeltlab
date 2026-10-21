from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_env: str = "development"
    app_secret_key: str = "change-me-to-a-random-string"
    app_cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Database
    database_url: str = "sqlite+aiosqlite:///./smeltlab.db"

    # AI
    ai_provider: str = "glm"  # glm | anthropic
    anthropic_api_key: str = ""
    glm_api_key: str = ""
    glm_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    glm_model: str = "glm-4.5-air"

    # Storage
    storage_backend: str = "local"  # local | s3 | r2
    local_storage_path: str = "./uploads"

    # PiAgent (本地 agent 引擎，走 pi CLI 子进程)
    piagent_enabled: bool = True
    piagent_exe: str = "pi"
    piagent_timeout: int = 600  # 单轮执行的绝对上限（秒）
    piagent_idle_timeout: int = 240  # 连续多久没有输出就判定卡死（秒）
    piagent_provider: str = ""  # 留空则用 pi 自身配置
    piagent_model: str = ""
    piagent_workspace_root: str = ""  # 留空则用 uploads/pi_workspace
    piagent_skills_root: str = ""  # 留空则不支持技能

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
