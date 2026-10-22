from typing import Literal
from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    database_url: str
    cash_confirm_window_minutes: int = 10

    daraja_base_url: str = "https://sandbox.safaricom.co.ke"
    daraja_consumer_key: str
    daraja_consumer_secret: str
    daraja_shortcode: str
    daraja_passkey: str
    daraja_b2c_shortcode: str
    daraja_initiator_name: str
    daraja_security_credential: str
    daraja_callback_base_url: str

    # HMAC key for price-card links (app/links.py). Changing it invalidates every
    # printed card, so the same value must be set wherever the API runs.
    checkout_link_secret: str

    # STK Push Query check on every successful STK callback (app/verification.py):
    #   flag    - credit at once, query Safaricom in the background, flag mismatches to
    #             the coordinator. For sandbox and the demo.
    #   enforce - credit only after Safaricom confirms; until then the sale is
    #             "Payment being verified" and nobody is credited. PRODUCTION MUST USE THIS.
    stk_query_mode: Literal["flag", "enforce"] = "flag"

    # How an open sale's product price splits (CLAUDE.md rule 4, migration 0020):
    #   legacy - the coordinator-set % per creator (default; the behaviour before 0020)
    #   fixed  - 80% creator, 15% site intermediary, 5% Conservation fund
    # Stored on each transaction when it's created, so changing this never re-splits a
    # sale already made. v1 signed price cards always use legacy.
    split_model: Literal["legacy", "fixed"] = "legacy"

    # Unlocks GET /health's full timings (send it as the X-Health-Timing-Key header).
    # Empty disables them; the public /health stays a cheap database check.
    health_timing_key: str = ""

    # Comma-separated browser origins allowed to call the API (the frontend's URL).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @field_validator("supabase_url")
    @classmethod
    def _strip_path(cls, v: str) -> str:
        # .env may hold a REST endpoint URL (…/rest/v1/); Auth/Storage live at the
        # bare project root, and httpx's base_url path-joining appends rather than
        # replaces, so any leftover path here silently breaks every request.
        parts = urlsplit(v)
        return f"{parts.scheme}://{parts.netloc}"


settings = Settings()
