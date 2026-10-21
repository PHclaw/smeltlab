"""轻量 JSON 持久化。

服务层目前用内存字典保存用户 / 项目 / 配方 / API Key / Webhook，
这里提供一层极简落盘，让这些数据在后端重启后还能恢复。

数据目录默认 ``./data``，可用环境变量 ``SMELTLAB_DATA_DIR`` 覆盖。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def data_dir() -> Path:
    raw = os.environ.get("SMELTLAB_DATA_DIR", "").strip()
    path = Path(raw) if raw else Path("data")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(name: str) -> Path:
    return data_dir() / f"{name}.json"


def load(name: str, default: Any) -> Any:
    """读取一个 JSON 文件，失败时返回默认值。"""
    path = _path(name)
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - 损坏的存档不应该阻塞启动
        return default


def save(name: str, data: Any) -> None:
    """原子写入 JSON 文件，失败静默（MVP 不因落盘失败影响请求）。"""
    path = _path(name)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
        tmp.replace(path)
    except Exception:  # noqa: BLE001
        pass
