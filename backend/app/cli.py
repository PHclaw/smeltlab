"""SmeltLab 命令行 —— 供 agent（pi）在工作区里调用的数据体检 / 清洗入口。

Agent 通过 bash 工具调用本模块，拿到结构化结果后再用人话汇报给用户：

    python -m app.cli profile --file data.csv
    python -m app.cli clean --file data.csv --ops dedup,missing --out cleaned.csv
    python -m app.cli ops

输出 = 中文摘要（给模型读）+ 末尾 ```json 代码块（给模型解析关键数字）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from app.services.cleaner import PRESET_OPERATIONS, execute_preset_operations
from app.services.profiler import profile_data, read_file
from app.services.trainer import train_model
from app.services.trainer_codegen import dataset_schema

#: 问题严重度排序
_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}

#: 操作码 -> 默认说明，用于没有显式描述时的展示
OP_LABELS = {
    "dedup": "删除重复行",
    "missing": "缺失值处理",
    "outlier": "异常值处理",
    "text_clean": "文本清洗",
    "date_standardize": "日期标准化",
    "pii_mask": "敏感信息脱敏",
    "label_normalize": "标签归一",
    "sample": "智能采样",
    "llm_validate": "LLM 数据格式校验",
}

SEVERITY_LABELS = {"critical": "严重", "warning": "警告", "info": "提示"}


def _fmt_int(value: Any) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value)


def _emit(payload: dict[str, Any], text: str) -> None:
    """先打印可读摘要，再打印机器可读 JSON。"""
    print(text.strip())
    print("\n```json")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print("```")


def cmd_ops(_args: argparse.Namespace) -> int:
    lines = ["可用清洗操作："]
    for code, label in OP_LABELS.items():
        supported = "✓" if code in PRESET_OPERATIONS else "—"
        lines.append(f"- {code:<18} {label} {supported}")
    _emit({"operations": [{"code": c, "label": l, "available": c in PRESET_OPERATIONS} for c, l in OP_LABELS.items()]}, "\n".join(lines))
    return 0


def cmd_profile(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        print(f"文件不存在：{path}", file=sys.stderr)
        return 2

    df = read_file(path)
    profile = profile_data(df, path.stat().st_size)

    score = profile.health_score
    level = "优秀" if score >= 80 else "一般" if score >= 60 else "较差" if score >= 40 else "严重"

    lines = [
        "数据体检报告",
        f"文件：{path.name} · {_fmt_int(profile.total_rows)} 行 × {profile.total_columns} 列 · "
        f"健康分 {score}/100（{level}）",
        f"重复行：{_fmt_int(profile.duplicate_rows)}（{profile.duplicate_pct}%）",
    ]

    high_null_cols = [c for c in profile.columns if c.null_pct >= 5]
    if high_null_cols:
        detail = "、".join(f"{c.name} {c.null_pct}%" for c in high_null_cols[:6])
        lines.append(f"缺失较多的列：{detail}")

    if profile.issues:
        lines.append("")
        lines.append(f"发现 {len(profile.issues)} 个问题：")
        for idx, issue in enumerate(profile.issues[:12], start=1):
            label = SEVERITY_LABELS.get(issue.severity, issue.severity)
            lines.append(f"{idx}. [{label}] {issue.message}")
            if issue.suggestion:
                lines.append(f"   → {issue.suggestion}")

    lines.append("")
    lines.append("列概况：")
    for col in profile.columns:
        lines.append(
            f"- {col.name} ({col.inferred_type}) · {_fmt_int(col.unique_count)} 个取值 · "
            f"{col.null_pct}% 缺失"
        )

    payload = {
        "file": str(path),
        "rows": profile.total_rows,
        "columns": profile.total_columns,
        "health_score": score,
        "health_level": level,
        "duplicate_rows": profile.duplicate_rows,
        "duplicate_pct": profile.duplicate_pct,
        "issues": [
            {
                "severity": issue.severity,
                "category": issue.category,
                "message": issue.message,
                "column": issue.affected_column,
                "suggestion": issue.suggestion,
            }
            for issue in sorted(profile.issues, key=lambda i: _SEVERITY_ORDER.get(i.severity, 3))
        ],
        "column_stats": [
            {
                "name": col.name,
                "type": col.inferred_type,
                "null_pct": col.null_pct,
                "unique": col.unique_count,
            }
            for col in profile.columns
        ],
    }
    _emit(payload, "\n".join(lines))
    return 0


def parse_operations(raw: str, configs: dict[str, Any]) -> list[dict[str, Any]]:
    """把 `dedup,missing,outlier` 解析成引擎需要的操作列表。"""
    operations: list[dict[str, Any]] = []
    for index, code in enumerate([c.strip() for c in raw.split(",") if c.strip()]):
        operations.append(
            {
                "type": code,
                "step_id": f"step_{index}",
                "description": OP_LABELS.get(code, code),
                "config": configs.get(code, {}),
            }
        )
    return operations


def cmd_clean(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        print(f"文件不存在：{path}", file=sys.stderr)
        return 2

    configs: dict[str, Any] = {}
    if args.config:
        try:
            configs = json.loads(args.config)
        except json.JSONDecodeError as exc:
            print(f"--config 不是合法 JSON：{exc}", file=sys.stderr)
            return 2

    operations = parse_operations(args.ops, configs)
    unknown = [op["type"] for op in operations if op["type"] not in PRESET_OPERATIONS]
    if unknown:
        print(f"不支持的操作：{', '.join(unknown)}；可用：{', '.join(PRESET_OPERATIONS)}", file=sys.stderr)
        return 2

    df = read_file(path)
    result = execute_preset_operations(df, operations)

    out_path = Path(args.out) if args.out else path.with_name(f"cleaned_{path.stem}.csv")
    if out_path.suffix.lower() == ".csv":
        result.df_clean.write_csv(out_path)
    elif out_path.suffix.lower() in (".parquet", ".pq"):
        result.df_clean.write_parquet(out_path)
    else:
        print(f"输出格式不支持：{out_path.suffix}，请用 .csv 或 .parquet", file=sys.stderr)
        return 2

    lines = [
        "清洗完成",
        f"文件：{path.name} → {out_path.name}",
        f"行数：{_fmt_int(result.rows_before)} → {_fmt_int(result.rows_after)}"
        f"（删除 {_fmt_int(result.rows_before - result.rows_after)} 行）",
        f"变更：{_fmt_int(result.total_changes)} 处 · 耗时 {result.execution_time_ms}ms",
        "",
        "执行明细：",
    ]
    for step in result.plan.steps:
        status = {"done": "完成", "failed": "失败", "skipped": "跳过"}.get(step.status, step.status)
        line = f"- {OP_LABELS.get(step.operation, step.operation)}：{status}"
        if step.rows_affected:
            line += f"，影响 {_fmt_int(step.rows_affected)} 行"
        if step.error:
            line += f"（{step.error}）"
        lines.append(line)

    payload = {
        "input": str(path),
        "output": str(out_path),
        "rows_before": result.rows_before,
        "rows_after": result.rows_after,
        "total_changes": result.total_changes,
        "execution_time_ms": result.execution_time_ms,
        "steps": [
            {
                "operation": s.operation,
                "status": s.status,
                "rows_affected": s.rows_affected,
                "error": s.error,
            }
            for s in result.plan.steps
        ],
    }
    _emit(payload, "\n".join(lines))
    return 0


def cmd_schema(args: argparse.Namespace) -> int:
    """轻量查看数据结构，给出目标列候选与推荐的训练配置。"""
    path = Path(args.file)
    if not path.is_file():
        print(f"文件不存在：{path}", file=sys.stderr)
        return 2

    schema = dataset_schema(path)
    rec = schema["recommendation"]
    candidates = schema["target_candidates"]

    payload = {
        "file": schema["file"],
        "rows": schema["rows"],
        "columns": schema["cols"],
        "column_names": [c["name"] for c in schema["columns"]][:60],
        "dtypes": {c["name"]: c["dtype"] for c in schema["columns"][:60]},
        "target_candidates": candidates,
        "recommendation": rec,
    }

    lines = [
        "数据结构概览",
        f"文件：{schema['file']} · {schema['rows']} 行 × {schema['cols']} 列",
        "可能的目标列（低基数）：",
    ]
    for item in candidates[:8]:
        lines.append(
            f"- {item['name']}：{item['unique']} 个取值（{'/'.join(item['top'][:4])}）· 缺失 {item['null_pct']}%"
        )

    task_label = {"classification": "分类", "regression": "回归"}.get(rec["task"], "待定")
    lines.append("")
    lines.append("推荐训练配置（可直接写进 train-config 卡）：")
    lines.append(f"- 目标列：{rec['target'] or '未识别，需要向用户确认'}")
    if rec.get("group"):
        lines.append(f"- 分组列：{rec['group']}")
    if rec.get("drop"):
        lines.append("- 建议剔除：" + "、".join(rec["drop"]))
    lines.append(
        f"- 任务：{task_label} · 模型：{rec['model']} · 测试集：{rec['test_size']:.0%}"
    )
    if rec.get("class_counts"):
        dist = " ".join(f"{k}×{v}" for k, v in list(rec["class_counts"].items())[:6])
        lines.append(f"- 类别分布：{dist}")
    lines.append("")
    lines.append("列名（前 60 个）：" + "、".join(c["name"] for c in schema["columns"][:60]))

    _emit(payload, "\n".join(lines))
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        print(f"文件不存在：{path}", file=sys.stderr)
        return 2

    drop = [c.strip() for c in (args.drop or "").split(",") if c.strip()]
    task = None if args.task == "auto" else args.task

    def emit_progress(pct: int, stage: str) -> None:
        """把训练进度打到 stdout，供界面/日志实时展示。"""
        print(
            "@@PROGRESS " + json.dumps({"pct": pct, "stage": stage}, ensure_ascii=False),
            flush=True,
        )

    try:
        report = train_model(
            path,
            args.target,
            task=task,
            group=args.group or None,
            drop=drop,
            positive=args.positive or None,
            time_budget=args.time_budget,
            out_dir=args.out_dir or None,
            progress=emit_progress,
        )
    except ValueError as exc:
        print(f"训练失败：{exc}", file=sys.stderr)
        return 2

    task_label = "二分类" if report["task"] == "classification" else "回归"
    lines = [
        "模型训练完成",
        f"任务：{task_label} · 目标列：{report['target']}"
        + (f"（正例：{report['positive_label']}）" if report.get("positive_label") else ""),
        f"样本：{_fmt_int(report['rows_total'])} 行 · 训练 {_fmt_int(report['train_rows'])} / "
        f"测试 {_fmt_int(report['test_rows'])} · 特征 {report['feature_count']} 个",
        f"切分方式：{report['split']} · 耗时 {report['elapsed_seconds']}s",
        "",
        "模型结果：",
    ]

    if report["task"] == "classification":
        for m in report["models"]:
            if m.get("status") != "done":
                lines.append(f"- {m['name']}：{m.get('status')}（{m.get('error', '')}）")
                continue
            lines.append(
                f"- {m['name']}：PR-AUC {m.get('pr_auc')}, ROC-AUC {m.get('roc_auc')}, "
                f"F1 {m['f1']}, 召回 {m['recall']}, 精确 {m['precision']}, 阈值 {m['threshold']}"
            )
    else:
        for m in report["models"]:
            if m.get("status") != "done":
                lines.append(f"- {m['name']}：{m.get('status')}（{m.get('error', '')}）")
                continue
            lines.append(f"- {m['name']}：MAE {m['mae']}, RMSE {m['rmse']}, R² {m['r2']}")

    lines.append("")
    lines.append(f"最佳模型：{report['best_model']}")
    if report["dropped_columns"]:
        names = "、".join(c["name"] for c in report["dropped_columns"][:8])
        lines.append(f"剔除列：{names}（原因见 JSON）")
    if report["warnings"]:
        lines.append("注意：")
        for w in report["warnings"]:
            lines.append(f"- {w}")
    lines.append("")
    lines.append(f"模型文件：{report['artifacts']['model']} · 预测：{report['artifacts']['predictions']}")
    lines.append("图表数据已放在 JSON 的 charts 字段，可直接渲染")

    _emit(report, "\n".join(lines))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="app.cli", description="SmeltLab 数据体检与清洗命令行")
    sub = parser.add_subparsers(dest="command", required=True)

    p_profile = sub.add_parser("profile", help="体检数据集并输出问题清单")
    p_profile.add_argument("--file", required=True, help="数据文件路径")
    p_profile.set_defaults(func=cmd_profile)

    p_clean = sub.add_parser("clean", help="按操作列表清洗并写出新文件")
    p_clean.add_argument("--file", required=True, help="数据文件路径")
    p_clean.add_argument("--ops", required=True, help="逗号分隔的操作码，例如 dedup,missing")
    p_clean.add_argument("--out", help="输出文件路径，默认 cleaned_<原文件名>")
    p_clean.add_argument("--config", help="操作参数 JSON，例如 '{\"missing\":{\"strategy\":\"drop\"}}'")
    p_clean.set_defaults(func=cmd_clean)

    p_schema = sub.add_parser("schema", help="查看数据结构与候选目标列")
    p_schema.add_argument("--file", required=True, help="数据文件路径")
    p_schema.set_defaults(func=cmd_schema)

    p_train = sub.add_parser("train", help="自动训练模型并输出评估结果与图表数据")
    p_train.add_argument("--file", required=True, help="数据文件路径")
    p_train.add_argument("--target", required=True, help="目标列名")
    p_train.add_argument(
        "--task",
        choices=["auto", "classification", "regression"],
        default="auto",
        help="任务类型，默认自动判断",
    )
    p_train.add_argument("--group", help="分组列（如患者 ID），用于避免同一实体跨训练/测试集")
    p_train.add_argument("--drop", help="逗号分隔的剔除列，例如 住院费用,出院情况")
    p_train.add_argument("--positive", help="正例取值，默认取少数类")
    p_train.add_argument("--time-budget", type=int, default=300, dest="time_budget", help="训练时间预算（秒）")
    p_train.add_argument("--out-dir", dest="out_dir", help="模型与预测输出目录，默认与数据文件同目录")
    p_train.set_defaults(func=cmd_train)

    p_ops = sub.add_parser("ops", help="列出可用操作")
    p_ops.set_defaults(func=cmd_ops)

    return parser


def main(argv: list[str] | None = None) -> int:
    # Windows 下管道默认用 GBK，强制 UTF-8 避免 agent 读到乱码
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # pragma: no cover - 非标准流
            pass

    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
