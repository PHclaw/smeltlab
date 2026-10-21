"""自动建模服务 —— 在清洗后的数据上跑一遍轻量 AutoML，产出可展示的评估结果。

设计原则：
- 只用 numpy + scikit-learn，不引入 matplotlib：图表交给前端 `chart` 代码块渲染。
- 一切指标必须可复现（固定 random_state），并记录切分方式、剔除字段与告警。
- 支持时间预算：到点就把已完成的模型结果返回，而不是整体失败。
"""

from __future__ import annotations

import time
import warnings
from pathlib import Path
from typing import Any, Callable

import numpy as np
import polars as pl
from joblib import dump
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    precision_recall_curve,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    root_mean_squared_error,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.services.profiler import read_file

# sklearn 在少数类极少的场景会刷一屏告警，这里统一静音（结论已写进 warnings）
warnings.filterwarnings("ignore", message="No positive class found in y_true")
warnings.filterwarnings("ignore", message="Only one class is present in y_true")
warnings.filterwarnings("ignore", message="No positive samples in y_true")
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

SEED = 42

#: 缺失率超过该阈值的列直接剔除
MAX_MISSING_RATIO = 0.9
#: 类别列基数上限，超过就剔除（避免 OneHot 爆炸）
MAX_CARDINALITY = 32
#: 训练集行数上限，超过则抽样（保护内存与耗时）
MAX_TRAIN_ROWS = 50_000


# ---------------------------------------------------------------------------
# 数据准备
# ---------------------------------------------------------------------------


def _is_numeric(dtype: pl.DataType) -> bool:
    try:
        if dtype == pl.Boolean:
            return True
        return dtype.is_numeric()
    except Exception:  # noqa: BLE001 - 不同 polars 版本 API 差异
        return dtype in (pl.Int64, pl.Float64, pl.Int32, pl.Float32)


def _detect_task(target: pl.Series, task: str | None) -> str:
    """auto：低基数的数值列或字符串列按分类处理，其余按回归。"""
    if task in ("classification", "regression"):
        return task

    if not _is_numeric(target.dtype):
        return "classification"

    unique = target.drop_nulls().unique().len()
    return "classification" if unique <= 10 else "regression"


def _select_columns(
    df: pl.DataFrame,
    target: str,
    drop: set[str],
    group: str | None,
) -> tuple[list[str], list[str], list[dict[str, str]]]:
    """拆出数值列 / 类别列，并记录被剔除的列与原因。"""
    numeric: list[str] = []
    categorical: list[str] = []
    dropped: list[dict[str, str]] = []
    rows = max(df.height, 1)

    for col in df.columns:
        if col == target or col == group:
            continue
        if col in drop:
            dropped.append({"name": col, "reason": "用户指定剔除"})
            continue

        series = df[col]
        missing_ratio = series.null_count() / rows
        if missing_ratio > MAX_MISSING_RATIO:
            dropped.append({"name": col, "reason": f"缺失率 {missing_ratio:.0%}"})
            continue

        unique = series.n_unique()
        if unique <= 1:
            dropped.append({"name": col, "reason": "常量列"})
            continue

        if _is_numeric(series.dtype):
            # 近似 ID 的整数列会造成泄漏
            if unique / rows > 0.9 and series.dtype in (pl.Int64, pl.Int32, pl.UInt64, pl.UInt32):
                dropped.append({"name": col, "reason": "疑似 ID（取值近乎唯一）"})
                continue
            numeric.append(col)
        else:
            if unique > MAX_CARDINALITY:
                dropped.append({"name": col, "reason": f"类别过多（{unique} 种取值）"})
                continue
            categorical.append(col)

    return numeric, categorical, dropped


def _encode(
    df: pl.DataFrame,
    numeric: list[str],
    categorical: list[str],
    train_idx: np.ndarray,
) -> tuple[np.ndarray, list[str]]:
    """数值列中位数填充 + 类别列序数编码；填充/编码参数只从训练集学习。"""
    blocks: list[np.ndarray] = []
    names: list[str] = []

    for col in numeric:
        values = df[col].cast(pl.Float64).to_numpy()
        train_values = values[train_idx]
        finite = train_values[np.isfinite(train_values)]
        median = float(np.median(finite)) if finite.size else 0.0
        filled = np.where(np.isfinite(values), values, median)
        blocks.append(filled.astype(np.float64).reshape(-1, 1))
        names.append(col)

    for col in categorical:
        raw = df[col].cast(pl.Utf8).fill_null("缺失").to_numpy()
        train_values = raw[train_idx]
        categories = sorted({str(v) for v in train_values})
        mapping = {value: idx for idx, value in enumerate(categories)}
        encoded = np.array([mapping.get(str(v), -1) for v in raw], dtype=np.float64)
        blocks.append(encoded.reshape(-1, 1))
        names.append(col)

    if not blocks:
        return np.zeros((df.height, 0)), []

    return np.hstack(blocks), names


def _builtin_importance(model: Any, feature_names: list[str]) -> list[dict[str, Any]]:
    """优先用模型自带的重要性，避免置换重要性的额外计算开销。"""
    values = None
    if hasattr(model, "feature_importances_"):
        values = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "coef_"):
        values = np.abs(np.asarray(model.coef_, dtype=float)).ravel()
    elif hasattr(model, "named_steps"):
        last = list(model.named_steps.values())[-1]
        if hasattr(last, "coef_"):
            values = np.abs(np.asarray(last.coef_, dtype=float)).ravel()

    if values is None or len(values) != len(feature_names):
        return []

    order = np.argsort(values)[::-1][:10]
    return [
        {"name": feature_names[int(i)], "value": round(float(values[int(i)]), 4)}
        for i in order
    ]


def _curve_points(xs: np.ndarray, ys: np.ndarray, limit: int = 40) -> list[list[float]]:
    """把曲线降采样到几十个点，避免图表 JSON 过大。"""
    if len(xs) <= limit:
        pairs = zip(xs, ys)
    else:
        step = max(len(xs) // limit, 1)
        pairs = zip(xs[::step], ys[::step])
    return [[round(float(x), 4), round(float(y), 4)] for x, y in pairs]


# ---------------------------------------------------------------------------
# 模型
# ---------------------------------------------------------------------------


def _classification_models(pos_weight_note: list[str]) -> list[tuple[str, Any]]:
    return [
        ("基线（多数类）", DummyClassifier(strategy="prior")),
        (
            "逻辑回归",
            make_pipeline(
                StandardScaler(),
                LogisticRegression(max_iter=2000, class_weight="balanced", random_state=SEED),
            ),
        ),
        (
            "随机森林",
            RandomForestClassifier(
                n_estimators=200,
                min_samples_leaf=2,
                class_weight="balanced_subsample",
                n_jobs=-1,
                random_state=SEED,
            ),
        ),
        (
            "梯度提升",
            HistGradientBoostingClassifier(
                max_iter=200,
                learning_rate=0.08,
                class_weight="balanced",
                random_state=SEED,
            ),
        ),
    ]


def _regression_models() -> list[tuple[str, Any]]:
    return [
        ("基线（中位数）", DummyRegressor(strategy="median")),
        ("岭回归", make_pipeline(StandardScaler(), Ridge(alpha=1.0))),
        (
            "随机森林",
            RandomForestRegressor(
                n_estimators=200,
                min_samples_leaf=2,
                n_jobs=-1,
                random_state=SEED,
            ),
        ),
        (
            "梯度提升",
            HistGradientBoostingRegressor(
                max_iter=200,
                learning_rate=0.08,
                random_state=SEED,
            ),
        ),
    ]


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------


def train_model(
    file_path: str | Path,
    target: str,
    *,
    task: str | None = None,
    group: str | None = None,
    drop: list[str] | None = None,
    positive: str | None = None,
    time_budget: int = 300,
    test_size: float = 0.25,
    out_dir: str | Path | None = None,
    progress: Callable[[int, str], None] | None = None,
) -> dict[str, Any]:
    """训练并评估，返回可直接喂给前端的报告。

    ``progress`` 可选回调，用来把 0-100 的进度与阶段名推给调用方（命令行/界面）。
    """
    started = time.monotonic()
    deadline = started + max(time_budget, 30)
    path = Path(file_path)

    def notify(pct: int, stage: str) -> None:
        """推送进度；回调异常不影响训练本身。"""
        if progress is None:
            return
        try:
            progress(max(0, min(int(pct), 100)), stage)
        except Exception:  # noqa: BLE001 - 展示层问题不阻断训练
            pass

    df = read_file(path)
    notify(5, "读取数据")

    if target not in df.columns:
        raise ValueError(f"目标列不存在：{target}")
    if group and group not in df.columns:
        raise ValueError(f"分组列不存在：{group}")

    warnings: list[str] = []
    drop_set = set(drop or [])
    for col in list(drop_set):
        if col not in df.columns:
            drop_set.discard(col)

    # 丢掉目标缺失的行
    total_rows = df.height
    df = df.filter(pl.col(target).is_not_null())
    if df.height < total_rows:
        warnings.append(f"目标列缺失，剔除了 {total_rows - df.height} 行")

    if df.height < 30:
        raise ValueError("可用样本不足 30 行，无法训练")

    task = _detect_task(df[target], task)
    numeric, categorical, dropped = _select_columns(df, target, drop_set, group)
    if not numeric and not categorical:
        raise ValueError("没有可用特征列，请先用 clean 处理数据或指定 --drop")
    notify(15, "准备特征")

    # 目标变量（切分前准备好，便于分层与正例校验）
    if task == "classification":
        values = df[target].cast(pl.Utf8).to_numpy()
        unique_values = sorted({str(v) for v in values})
        if len(unique_values) != 2:
            raise ValueError(
                f"目标列有 {len(unique_values)} 个类别，目前只支持二分类；多分类请先合并标签"
            )

        counts = {label: int(np.sum(values == label)) for label in unique_values}
        if positive is not None and str(positive) in counts:
            positive_label = str(positive)
        else:
            positive_label = min(counts, key=counts.get)
        negative_label = next(label for label in unique_values if label != positive_label)
        y_all = (values == positive_label).astype(np.int64)
    else:
        y_all = df[target].cast(pl.Float64).to_numpy()
        y_all = np.nan_to_num(y_all, nan=float(np.nanmedian(y_all)))

    # 训练/测试切分
    indices = np.arange(df.height)
    if group:
        groups = df[group].cast(pl.Utf8).to_numpy()
        for attempt in range(30):
            splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=SEED + attempt)
            train_idx, test_idx = next(splitter.split(indices, groups=groups))
            if task != "classification":
                break
            # 尽量让两侧都有正例，否则指标完全不可算
            if y_all[test_idx].sum() >= 2 and y_all[train_idx].sum() >= 5:
                break
        split_kind = f"按「{group}」分组切分，避免同一实体跨集"
    else:
        stratify = None
        if task == "classification":
            class_counts = np.bincount(y_all, minlength=2)
            if class_counts.min() >= 2:
                stratify = y_all
            else:
                warnings.append("某一类别样本过少，未能分层抽样")
        train_idx, test_idx = train_test_split(
            indices, test_size=test_size, random_state=SEED, stratify=stratify
        )
        split_kind = "随机分层切分" if stratify is not None else "随机切分"

    if task == "classification":
        test_pos = int(y_all[test_idx].sum())
        train_pos = int(y_all[train_idx].sum())
        if test_pos == 0:
            raise ValueError(
                "测试集里没有正例，无法计算 AUC / F1。"
                "建议：增加正例样本、去掉 --group 限制、或换一个更常见的目标列。"
            )
        if test_pos < 3:
            warnings.append(f"测试集只有 {test_pos} 个正例，指标波动很大，仅作探索性参考")
        if train_pos < 30:
            warnings.append(f"训练集正例仅 {train_pos} 个，模型结果不稳定，只能作为探索性参考")

    if len(train_idx) > MAX_TRAIN_ROWS:
        rng = np.random.default_rng(SEED)
        train_idx = rng.choice(train_idx, MAX_TRAIN_ROWS, replace=False)
        warnings.append(f"训练集超过 {MAX_TRAIN_ROWS} 行，已抽样以保证速度")

    X, feature_names = _encode(df, numeric, categorical, train_idx)
    X_train, X_test = X[train_idx], X[test_idx]

    artifacts: dict[str, str] = {}
    best: dict[str, Any] | None = None
    charts: dict[str, Any] = {}
    importance: list[dict[str, Any]] = []

    if task == "classification":
        y_train, y_test = y_all[train_idx], y_all[test_idx]

        rows: list[dict[str, Any]] = []
        models = _classification_models(warnings)

        for model_idx, (name, model) in enumerate(models):
            if time.monotonic() > deadline:
                warnings.append("达到时间预算，后续模型已跳过")
                break
            notify(20 + int(60 * model_idx / max(len(models), 1)), f"训练 {name}")
            model_started = time.monotonic()
            try:
                model.fit(X_train, y_train)
                if hasattr(model, "predict_proba"):
                    proba = model.predict_proba(X_test)[:, 1]
                else:  # Dummy 极端情况
                    proba = model.predict(X_test).astype(float)

                precision_curve, recall_curve, thresholds = precision_recall_curve(y_test, proba)
                f1_curve = np.divide(
                    2 * precision_curve * recall_curve,
                    precision_curve + recall_curve,
                    out=np.zeros_like(precision_curve),
                    where=(precision_curve + recall_curve) > 0,
                )
                best_pos = int(np.argmax(f1_curve))
                threshold = float(thresholds[min(best_pos, len(thresholds) - 1)]) if len(thresholds) else 0.5
                pred = (proba >= threshold).astype(np.int64)

                row = {
                    "name": name,
                    "roc_auc": None,
                    "pr_auc": None,
                    "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
                    "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
                    "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
                    "threshold": round(threshold, 3),
                    "seconds": round(time.monotonic() - model_started, 1),
                    "status": "done",
                }
                try:
                    row["roc_auc"] = round(float(roc_auc_score(y_test, proba)), 4)
                    row["pr_auc"] = round(float(average_precision_score(y_test, proba)), 4)
                except ValueError:
                    row["status"] = "skipped"
                    warnings.append(f"{name} 的测试集只有一个类别，AUC 无法计算")
                rows.append(row)

                score = row["pr_auc"] if row["pr_auc"] is not None else -1
                if row["status"] == "done" and (best is None or score > best["score"]):
                    best = {
                        "score": score,
                        "row": row,
                        "model": model,
                        "proba": proba,
                        "pred": pred,
                    }
            except Exception as exc:  # noqa: BLE001 - 单个模型失败不影响整体
                rows.append({"name": name, "status": "failed", "error": str(exc), "seconds": 0})

        if best is None:
            raise ValueError("所有模型都训练失败，请检查特征与目标列")

        cm = confusion_matrix(y_test, best["pred"], labels=[0, 1])
        fpr, tpr, _ = roc_curve(y_test, best["proba"])
        pr_precision, pr_recall, _ = precision_recall_curve(y_test, best["proba"])

        charts["model_compare"] = {
            "type": "bar",
            "title": "模型对比（PR-AUC）",
            "data": [
                {"label": r["name"], "value": r.get("pr_auc") or 0}
                for r in rows
                if r.get("status") == "done"
            ],
        }
        charts["confusion"] = {
            "type": "heatmap",
            "title": f"混淆矩阵 · {best['row']['name']}",
            "labels": [f"实际 {negative_label}", f"实际 {positive_label}"],
            "columns": [f"预测 {negative_label}", f"预测 {positive_label}"],
            "matrix": cm.astype(int).tolist(),
        }
        charts["roc"] = {
            "type": "line",
            "title": "ROC 曲线",
            "series": [
                {"name": best["row"]["name"], "data": _curve_points(fpr, tpr)},
                {"name": "随机基线", "data": [[0, 0], [1, 1]]},
            ],
        }
        charts["pr"] = {
            "type": "line",
            "title": "PR 曲线",
            "series": [
                {"name": best["row"]["name"], "data": _curve_points(pr_recall, pr_precision)},
            ],
        }

        best_metrics = {
            k: best["row"][k]
            for k in ("name", "roc_auc", "pr_auc", "f1", "recall", "precision", "threshold")
        }
        best_metrics["confusion_matrix"] = cm.astype(int).tolist()

        predictions = pl.DataFrame(
            {
                "y_true": y_test,
                "y_pred": best["pred"],
                "probability": np.round(best["proba"], 4),
                "split": ["test"] * len(y_test),
            }
        )
        report_extra = {
            "classes": [negative_label, positive_label],
            "positive_label": positive_label,
            "positive_count": counts[positive_label],
            "negative_count": counts[negative_label],
        }
    else:
        y_train, y_test = y_all[train_idx], y_all[test_idx]

        rows = []
        regression_models = _regression_models()
        for model_idx, (name, model) in enumerate(regression_models):
            if time.monotonic() > deadline:
                warnings.append("达到时间预算，后续模型已跳过")
                break
            notify(20 + int(60 * model_idx / max(len(regression_models), 1)), f"训练 {name}")
            model_started = time.monotonic()
            try:
                model.fit(X_train, y_train)
                pred = model.predict(X_test)
                mae = float(mean_absolute_error(y_test, pred))
                rmse = float(root_mean_squared_error(y_test, pred))
                r2 = float(r2_score(y_test, pred))
                row = {
                    "name": name,
                    "mae": round(mae, 3),
                    "rmse": round(rmse, 3),
                    "r2": round(r2, 4),
                    "seconds": round(time.monotonic() - model_started, 1),
                    "status": "done",
                }
                rows.append(row)
                if best is None or r2 > best["score"]:
                    best = {"score": r2, "row": row, "model": model, "pred": pred}
            except Exception as exc:  # noqa: BLE001
                rows.append({"name": name, "status": "failed", "error": str(exc), "seconds": 0})

        if best is None:
            raise ValueError("所有模型都训练失败，请检查特征与目标列")

        residuals = y_test - best["pred"]
        bins = np.linspace(float(np.min(residuals)), float(np.max(residuals)), 11)
        hist, edges = np.histogram(residuals, bins=bins)

        charts["model_compare"] = {
            "type": "bar",
            "title": "模型对比（R²）",
            "data": [
                {"label": r["name"], "value": max(r.get("r2") or 0, 0)}
                for r in rows
                if r.get("status") == "done"
            ],
        }
        charts["residual"] = {
            "type": "bar",
            "title": "残差分布",
            "data": [
                {"label": f"{edges[i]:.0f}~{edges[i + 1]:.0f}", "value": int(hist[i])}
                for i in range(len(hist))
            ],
        }

        best_metrics = {k: best["row"][k] for k in ("name", "mae", "rmse", "r2")}
        predictions = pl.DataFrame(
            {
                "y_true": np.round(y_test, 4),
                "y_pred": np.round(best["pred"], 4),
                "error": np.round(y_test - best["pred"], 4),
            }
        )
        report_extra = {}

    # 特征重要性：树模型用内置重要性，线性模型用系数绝对值
    importance = _builtin_importance(best["model"], feature_names)
    if importance:
        charts["importance"] = {
            "type": "bar",
            "title": "特征重要性 Top 10",
            "data": importance,
        }

    # 落盘：模型 + 预测
    out_path = Path(out_dir) if out_dir else path.parent
    out_path.mkdir(parents=True, exist_ok=True)
    stem = f"{path.stem}_{target}".replace("/", "_").replace("\\", "_")
    model_path = out_path / f"model_{stem}.joblib"
    pred_path = out_path / f"predictions_{stem}.csv"

    dump(
        {
            "model": best["model"],
            "features": feature_names,
            "task": task,
            "target": target,
            "positive_label": report_extra.get("positive_label"),
            "threshold": best["row"].get("threshold"),
        },
        model_path,
    )
    predictions.write_csv(pred_path)
    artifacts = {"model": model_path.name, "predictions": pred_path.name}

    report = {
        "file": path.name,
        "task": task,
        "target": target,
        "positive_label": report_extra.get("positive_label"),
        "rows_total": df.height,
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "split": split_kind,
        "group_column": group,
        "feature_count": len(feature_names),
        "features": feature_names,
        "dropped_columns": dropped[:20],
        "models": rows,
        "best_model": best["row"]["name"],
        "best_metrics": best_metrics,
        "charts": charts,
        "importance": importance,
        "warnings": warnings,
        "artifacts": artifacts,
        "elapsed_seconds": round(time.monotonic() - started, 1),
    }
    report.update(report_extra)
    notify(100, "训练完成")
    return report
