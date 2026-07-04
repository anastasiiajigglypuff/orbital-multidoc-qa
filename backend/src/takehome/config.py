from __future__ import annotations

import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://orbital:orbital@db:5432/orbital_takehome"
    anthropic_api_key: str = ""
    upload_dir: str = "uploads"
    max_upload_size: int = 25 * 1024 * 1024  # 25MB per file
    # Multi-file upload guardrails (resource exhaustion): cap the number of files and
    # the total bytes accepted in a single upload request.
    max_files_per_upload: int = 20
    max_total_upload_size: int = 100 * 1024 * 1024  # 100MB per request
    # Full-context stuffing budget: total extracted characters concatenated into a
    # single prompt. ~4 chars/token, so ~600k chars ≈ 150k tokens, comfortably under
    # Claude's window while leaving room for the system prompt and history.
    max_context_chars: int = 600_000

    model_config = {"env_file": ".env"}


settings = Settings()

# Ensure the Anthropic API key is available as an environment variable
# so that pydantic-ai's Anthropic integration can pick it up.
if settings.anthropic_api_key:
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
