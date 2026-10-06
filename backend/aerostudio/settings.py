"""Runtime configuration (environment variables prefixed AEROSTUDIO_, or backend/.env)."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AEROSTUDIO_", env_file=BACKEND_DIR / ".env", extra="ignore")

    # --- surrogate (separate repo, pinned by commit) ---
    surrogate_repo: Path = BACKEND_DIR.parents[1] / "AirfRANS Latest" / "AirfransProject_migration"
    surrogate_commit: str = "d8d3d6db00fc9fac83d4d1f7fc647ba6c9cdd032"
    # "strict": refuse to start on a different commit or a dirty tree; "warn": log only
    surrogate_pin_mode: str = "strict"
    # Checkpoints: one path = single model, several = deep ensemble (comma-separated)
    checkpoints: str = ""
    device: str = "cpu"
    torch_threads: int = 0  # 0 = torch default

    # --- data ---
    base_mesh_dir: Path = BACKEND_DIR / "data" / "base_meshes"
    runs_dir: Path = BACKEND_DIR / "runs"

    # --- caches & jobs ---
    mesh_cache_size: int = 16  # morphed meshes (one per shape; AoA/speed reuse them)
    result_cache_size: int = 64  # predictions kept for /results/{id}/field
    max_concurrent_jobs: int = 1
    shape_rounding: int = 3  # decimals of NACA params used as the mesh-cache key

    # --- API ---
    cors_origins: str = "http://localhost:3000,http://localhost:3100"

    @property
    def checkpoint_paths(self) -> list[Path]:
        return [Path(p.strip()) for p in self.checkpoints.split(",") if p.strip()]


settings = Settings()
