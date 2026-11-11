from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator


class Settings(BaseSettings):
    ENVIRONMENT: str = "demo"
    LOCAL_DEMO_ACCESS: bool = True
    SIMULATION_LABEL: str = "SIMULATED SERVICE - NOT CONNECTED TO LIVE SYSTEMS"
    APP_PORT: int = 8000
    WEB_PORT: int = 3000

    SECRET_KEY: str = "rebound_demo_super_secret_jwt_key_please_change_in_production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "AdminPassword2026!"
    OPERATOR_USERNAME: str = "operator"
    OPERATOR_PASSWORD: str = "OperatorPassword2026!"

    DATABASE_URL: str = "sqlite+aiosqlite:///./rebound.db"

    RUNNER_CONTROL_URL: str = "http://localhost:5005"
    RUNNER_DEMO_SERVICE_URL: str = "http://localhost:5006"
    RUNNER_AUTH_TOKEN: str = "rebound_runner_internal_token_secure_2026"

    HEALTH_CHECK_INTERVAL_SECONDS: float = 5.0
    HEALTH_CHECK_TIMEOUT_SECONDS: float = 2.0
    HEALTH_LATENCY_LIMIT_MS: float = 500.0
    CONSECUTIVE_FAILURES_TO_OPEN: int = 3
    CONSECUTIVE_SUCCESSES_TO_RESOLVE: int = 2
    AUTO_RECOVERY_COOLDOWN_SECONDS: int = 60
    MAX_AUTO_RECOVERY_ATTEMPTS: int = 1

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_ENTERPRISE_ENABLED: bool = False
    GEMINI_ENTERPRISE_WORKFLOW_ENDPOINT: str = ""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @model_validator(mode="after")
    def require_non_demo_secrets(self):
        if self.ENVIRONMENT != "demo":
            for field in (
                "SECRET_KEY",
                "RUNNER_AUTH_TOKEN",
                "ADMIN_PASSWORD",
                "OPERATOR_PASSWORD",
            ):
                value = getattr(self, field)
                minimum = 32 if field in ("SECRET_KEY", "RUNNER_AUTH_TOKEN") else 12
                if (
                    value == type(self).model_fields[field].default
                    or len(value) < minimum
                ):
                    raise ValueError(
                        f"Set a unique {field} before using a non-demo environment."
                    )
        return self


settings = Settings()
