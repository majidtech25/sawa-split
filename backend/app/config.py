from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    database_url: str
    cash_confirm_window_minutes: int = 10

    @field_validator("supabase_url")
    @classmethod
    def _strip_path(cls, v: str) -> str:
        # .env may hold a REST endpoint URL (…/rest/v1/); Auth/Storage live at the
        # bare project root, and httpx's base_url path-joining appends rather than
        # replaces, so any leftover path here silently breaks every request.
        parts = urlsplit(v)
        return f"{parts.scheme}://{parts.netloc}"


settings = Settings()
