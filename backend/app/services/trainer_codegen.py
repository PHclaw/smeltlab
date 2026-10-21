"""根据工作空间里的真实数据集，生成可直接执行的训练脚本。

生成结果是一份**独立可读、可运行**的 Python 文件：
数据加载 → 预处理 → 切分 → 模型定义 → 训练循环（带进度）→ 评估 → 产物落盘。

脚本与前端约定两个标记行：
    @@PROGRESS {"pct": 42, "stage": "...", "metrics": {...}}
    @@RESULT   {...完整结果...}
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from app.services.trainer import (
    MAX_CARDINALITY,
    MAX_MISSING_RATIO,
    _is_numeric,
    read_file,
)

_TEMPLATE = r'''"""__HEADER__"""

from __future__ import annotations

import json
import sys
import time
import warnings

import numpy as np
import polars as pl
from joblib import dump
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import SGDClassifier, SGDRegressor
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
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

CONFIG = __CONFIG__


def emit(pct: float, stage: str, **extra) -> None:
    payload = {"pct": int(pct), "stage": stage}
    payload.update(extra)
    print("@@PROGRESS " + json.dumps(payload, ensure_ascii=False), flush=True)


def finish(payload: dict) -> None:
    print("@@RESULT " + json.dumps(payload, ensure_ascii=False), flush=True)


def read_table(path: str) -> pl.DataFrame:
    suffix = path.rsplit(".", 1)[-1].lower()
    if suffix == "csv":
        return pl.read_csv(path, infer_schema_length=10000, ignore_errors=True)
    if suffix in ("parquet", "pq"):
        return pl.read_parquet(path)
    if suffix in ("xlsx", "xls"):
        return pl.read_excel(path)
    if suffix == "json":
        return pl.read_json(path)
    if suffix in ("jsonl", "ndjson"):
        return pl.read_ndjson(path)
    raise SystemExit("unsupported format: " + suffix)


def build_xy(df: pl.DataFrame) -> tuple[np.ndarray, list[str]]:
    """按生成的 schema 构建特征矩阵（数值中位数填充，类别序数编码）。"""
    blocks, names = [], []
    for col in CONFIG["numeric"]:
        values = df[col].cast(pl.Float64).to_numpy()
        fill = CONFIG["fill"].get(col)
        fill = 0.0 if fill is None else float(fill)
        blocks.append(np.where(np.isfinite(values), values, fill))
        names.append(col)
    for col in CONFIG["categorical"]:
        raw = df[col].cast(pl.Utf8).fill_null("缺失").to_numpy()
        mapping = {value: idx for idx, value in enumerate(CONFIG["categories"].get(col, []))}
        blocks.append(np.array([mapping.get(str(v), -1) for v in raw], dtype=float))
        names.append(col)
    if not blocks:
        raise SystemExit("no usable features")
    return np.column_stack(blocks).astype(float), names


def eval_metric(model, X, y, task: str) -> float:
    try:
        if task == "classification":
            if hasattr(model, "predict_proba"):
                proba = model.predict_proba(X)[:, 1]
            else:
                proba = model.predict(X).astype(float)
            if len(np.unique(y)) < 2:
                return float("nan")
            return float(average_precision_score(y, proba))
        return float(r2_score(y, model.predict(X)))
    except Exception:
        return float("nan")


def make_model(name: str, params: dict, task: str, classes=None):
    seed = CONFIG["seed"]
    common = dict(random_state=seed)
    if task == "classification":
        if name == "rf":
            return RandomForestClassifier(
                n_estimators=int(params.get("n_estimators", 300)),
                max_depth=params.get("max_depth"),
                min_samples_leaf=int(params.get("min_samples_leaf", 2)),
                class_weight="balanced_subsample",
                n_jobs=-1,
                **common,
            )
        if name == "gb":
            return GradientBoostingClassifier(
                n_estimators=int(params.get("n_estimators", 200)),
                learning_rate=float(params.get("learning_rate", 0.08)),
                max_depth=int(params.get("max_depth", 3)),
                **common,
            )
        if name == "lr":
            return SGDClassifier(
                loss="log_loss",
                learning_rate="adaptive",
                eta0=0.01,
                alpha=float(params.get("alpha", 0.0001)),
                max_iter=1,
                tol=None,
                **common,
            )
        return MLPClassifier(
            hidden_layer_sizes=(int(params.get("hidden", 32)),),
            learning_rate_init=float(params.get("lr", 0.01)),
            max_iter=1,
            **common,
        )
    if name == "rf":
        return RandomForestRegressor(
            n_estimators=int(params.get("n_estimators", 300)),
            max_depth=params.get("max_depth"),
            min_samples_leaf=int(params.get("min_samples_leaf", 2)),
            n_jobs=-1,
            **common,
        )
    if name == "gb":
        return GradientBoostingRegressor(
            n_estimators=int(params.get("n_estimators", 200)),
            learning_rate=float(params.get("learning_rate", 0.08)),
            max_depth=int(params.get("max_depth", 3)),
            **common,
        )
    if name == "lr":
        return SGDRegressor(
            loss="squared_error",
            learning_rate="adaptive",
            eta0=0.01,
            alpha=float(params.get("alpha", 0.0001)),
            max_iter=1,
            tol=None,
            **common,
        )
    return MLPRegressor(
        hidden_layer_sizes=(int(params.get("hidden", 32)),),
        learning_rate_init=float(params.get("lr", 0.01)),
        max_iter=1,
        **common,
    )


def main() -> None:
    started = time.time()
    task = CONFIG["task"]
    model_name = CONFIG["model"]
    params = CONFIG.get("params") or {}
    seed = CONFIG["seed"]

    emit(3, "读取数据集")
    df = read_table(CONFIG["file"])
    df = df.filter(pl.col(CONFIG["target"]).is_not_null())
    if df.height < 30:
        raise SystemExit("样本不足 30 行")

    emit(8, "构建特征矩阵")
    X, feature_names = build_xy(df)

    if task == "classification":
        raw_target = df[CONFIG["target"]].cast(pl.Utf8).to_numpy()
        positive = CONFIG["positive"]
        y = (raw_target == positive).astype(np.int64)
        negative = CONFIG.get("negative")
    else:
        y = df[CONFIG["target"]].cast(pl.Float64).to_numpy()
        y = np.nan_to_num(y, nan=float(np.nanmedian(y)))

    emit(14, "划分训练集与测试集")
    indices = np.arange(df.height)
    if CONFIG.get("group"):
        groups = df[CONFIG["group"]].cast(pl.Utf8).to_numpy()
        train_idx = test_idx = None
        for attempt in range(30):
            splitter = GroupShuffleSplit(
                n_splits=1, test_size=CONFIG["test_size"], random_state=seed + attempt
            )
            train_idx, test_idx = next(splitter.split(indices, groups=groups))
            if task != "classification":
                break
            if y[test_idx].sum() >= 2 and y[train_idx].sum() >= 5:
                break
        split_label = "按「%s」分组切分" % CONFIG["group"]
    else:
        stratify = y if task == "classification" and np.bincount(y).min() >= 2 else None
        train_idx, test_idx = train_test_split(
            indices, test_size=CONFIG["test_size"], random_state=seed, stratify=stratify
        )
        split_label = "随机分层切分" if stratify is not None else "随机切分"

    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]

    # 训练集内部再切一份验证集，用于训练过程中的曲线
    X_fit, X_val, y_fit, y_val = train_test_split(
        X_train, y_train, test_size=0.2, random_state=seed,
        stratify=y_train if task == "classification" and np.bincount(y_train).min() >= 2 else None,
    )

    emit(20, "准备模型：" + CONFIG["model_label"])

    scaler = None
    needs_scaling = model_name in ("lr", "mlp")
    if needs_scaling:
        scaler = StandardScaler().fit(X_fit)
        X_fit_s, X_val_s = scaler.transform(X_fit), scaler.transform(X_val)
    else:
        X_fit_s, X_val_s = X_fit, X_val

    curve: list[list[float]] = []
    step = 0
    total_steps = 1

    if model_name in ("rf", "gb"):
        target_total = int(params.get("n_estimators", 300 if model_name == "rf" else 200))
        chunk = max(target_total // 6, 1)
        total_steps = (target_total + chunk - 1) // chunk
        model = make_model(model_name, {**params, "n_estimators": chunk}, task)
        grown = 0
        while grown < target_total:
            grown = min(grown + chunk, target_total)
            model.set_params(n_estimators=grown)
            model.fit(X_fit_s, y_fit)
            step += 1
            metric = eval_metric(model, X_val_s, y_val, task)
            curve.append([step, round(metric, 4) if np.isfinite(metric) else 0])
            label = "随机森林" if model_name == "rf" else "梯度提升"
            emit(20 + 62 * step / total_steps, "%s %d/%d" % (label, grown, target_total),
                 metrics={CONFIG["metric_key"]: curve[-1][1]}, step=step, total=total_steps)
    else:
        total_steps = int(params.get("epochs", 30))
        model = make_model(model_name, params, task)
        classes = np.unique(y_fit) if task == "classification" else None
        for epoch in range(1, total_steps + 1):
            model.partial_fit(X_fit_s, y_fit, classes=classes) if task == "classification" \
                else model.partial_fit(X_fit_s, y_fit)
            step = epoch
            metric = eval_metric(model, X_val_s, y_val, task)
            curve.append([epoch, round(metric, 4) if np.isfinite(metric) else 0])
            emit(20 + 62 * epoch / total_steps, "第 %d/%d 轮" % (epoch, total_steps),
                 metrics={CONFIG["metric_key"]: curve[-1][1]}, step=epoch, total=total_steps)

    emit(86, "在测试集上评估")
    if scaler is not None:
        X_test_s = scaler.transform(X_test)
    else:
        X_test_s = X_test

    result = {
        "task": task,
        "target": CONFIG["target"],
        "model": CONFIG["model_label"],
        "params": params,
        "rows": {"train": int(len(train_idx)), "test": int(len(test_idx)), "total": int(df.height)},
        "split": split_label,
        "features": len(feature_names),
        "classes": [negative, positive] if task == "classification" else None,
        "metric_key": CONFIG["metric_key"],
        "curve": curve,
        "warnings": [],
        "charts": {},
    }

    if task == "classification":
        proba = model.predict_proba(X_test_s)[:, 1] if hasattr(model, "predict_proba") else model.predict(X_test_s).astype(float)
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
        try:
            roc = float(roc_auc_score(y_test, proba))
            pr = float(average_precision_score(y_test, proba))
        except ValueError:
            roc = pr = float("nan")

        result["metrics"] = {
            "pr_auc": round(pr, 4),
            "roc_auc": round(roc, 4),
            "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
            "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
            "threshold": round(threshold, 3),
        }
        cm = confusion_matrix(y_test, pred, labels=[0, 1])
        fpr, tpr, _ = roc_curve(y_test, proba)
        result["charts"]["confusion"] = {
            "type": "heatmap",
            "title": "混淆矩阵 · " + CONFIG["model_label"],
            "labels": ["实际 " + str(negative), "实际 " + str(positive)],
            "columns": ["预测 " + str(negative), "预测 " + str(positive)],
            "matrix": cm.astype(int).tolist(),
        }

        def sample(xs, ys, limit=40):
            step_size = max(len(xs) // limit, 1)
            return [[round(float(a), 4), round(float(b), 4)] for a, b in zip(xs[::step_size], ys[::step_size])]

        result["charts"]["roc"] = {
            "type": "line",
            "title": "ROC 曲线",
            "series": [
                {"name": CONFIG["model_label"], "data": sample(fpr, tpr)},
                {"name": "随机基线", "data": [[0, 0], [1, 1]]},
            ],
        }
        result["charts"]["pr"] = {
            "type": "line",
            "title": "PR 曲线",
            "series": [{"name": CONFIG["model_label"], "data": sample(recall_curve, precision_curve)}],
        }
        predictions = pl.DataFrame(
            {"y_true": y_test, "y_pred": pred, "probability": np.round(proba, 4)}
        )

        positives = int(y_test.sum())
        if positives < 5:
            result["warnings"].append("测试集只有 %d 个正例，指标波动很大，仅作探索性参考" % positives)
    else:
        pred = model.predict(X_test_s)
        result["metrics"] = {
            "mae": round(float(mean_absolute_error(y_test, pred)), 3),
            "rmse": round(float(np.sqrt(np.mean((y_test - pred) ** 2))), 3),
            "r2": round(float(r2_score(y_test, pred)), 4),
        }
        residuals = y_test - pred
        hist, edges = np.histogram(residuals, bins=10)
        result["charts"]["residual"] = {
            "type": "bar",
            "title": "残差分布",
            "data": [
                {"label": "%.0f~%.0f" % (edges[i], edges[i + 1]), "value": int(hist[i])}
                for i in range(len(hist))
            ],
        }
        predictions = pl.DataFrame(
            {"y_true": np.round(y_test, 4), "y_pred": np.round(pred, 4), "error": np.round(residuals, 4)}
        )

    emit(92, "计算特征重要性")
    importances = None
    if hasattr(model, "feature_importances_"):
        importances = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "coef_"):
        importances = np.abs(np.asarray(model.coef_, dtype=float)).ravel()
    if importances is not None and len(importances) == len(feature_names):
        order = np.argsort(importances)[::-1][:10]
        importance = [
            {"name": feature_names[int(i)], "value": round(float(importances[int(i)]), 4)}
            for i in order
        ]
        result["charts"]["importance"] = {
            "type": "bar",
            "title": "特征重要性 Top 10",
            "data": importance,
        }
        result["importance"] = importance

    emit(96, "保存模型与预测结果")
    model_path = CONFIG["out_dir"] + "/model_" + CONFIG["slug"] + ".joblib"
    pred_path = CONFIG["out_dir"] + "/predictions_" + CONFIG["slug"] + ".csv"
    dump(
        {
            "model": model,
            "scaler": scaler,
            "features": feature_names,
            "feature_order": CONFIG["numeric"] + CONFIG["categorical"],
            "task": task,
            "target": CONFIG["target"],
            "positive": CONFIG.get("positive"),
            "threshold": result["metrics"].get("threshold"),
            "config": CONFIG,
        },
        model_path,
    )
    predictions.write_csv(pred_path)

    result["artifacts"] = {
        "model": model_path.split("/")[-1],
        "predictions": pred_path.split("/")[-1],
    }
    result["elapsed_seconds"] = round(time.time() - started, 1)
    emit(100, "训练完成", metrics=result["metrics"])
    finish(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("@@ERROR " + json.dumps({"message": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
'''


TARGET_HINTS = ("死亡", "结局", "转归", "预后", "诊断", "分级", "标签", "label", "target", "是否")
ID_HINTS = ("编号", "患者", "病人", "住院号", "用户", "设备", "id", "ID", "Id")
LEAK_HINTS = ("费用", "出院", "入院时间", "出院时间", "icu", "ICU", "住院日", "住院天", "科室", "姓名", "地址", "电话", "呼吸机")


def _recommend(
    df: pl.DataFrame,
    columns: list[dict[str, Any]],
    rows: int,
) -> dict[str, Any]:
    """根据列名与基数给出默认训练配置。"""
    pool = [c for c in columns if c["unique"] >= 2 and c["null_pct"] <= 60]
    hinted = [c for c in pool if any(h in c["name"] for h in TARGET_HINTS)]
    low_card = [c for c in pool if c["unique"] <= 12]
    # 有语义提示的列优先（回归目标往往基数很高），否则只在低基数列里挑
    candidates = hinted + [c for c in low_card if c not in hinted]

    def score_target(item: dict[str, Any]) -> int:
        name = item["name"]
        score = 0
        if any(h in name for h in TARGET_HINTS):
            score += 10
        if any(h in name for h in ID_HINTS):
            score -= 20
        if item["unique"] == 2:
            score += 4
        if item["null_pct"] > 20:
            score -= 2
        return score

    target_item = max(candidates, key=score_target) if candidates else None
    target = target_item["name"] if target_item else None

    group = None
    for col in df.columns:
        if target and col == target:
            continue
        name = col
        if any(h in name for h in ID_HINTS):
            unique = df[col].n_unique()
            if 2 < unique <= rows:
                group = col
                break

    drop = []
    for col in df.columns:
        if col in (target, group):
            continue
        if any(h in col for h in LEAK_HINTS):
            drop.append(col)
    drop = drop[:12]

    classes: list[str] = []
    if target is None:
        task = "auto"
    elif target_item["unique"] <= 12:
        classes = [str(v) for v in df[target].drop_nulls().unique().head(12).to_list()]
        task = "classification"
    else:
        task = "regression"

    # 回归用随机森林更稳；分类在小样本上用可解释的逻辑回归
    if task == "regression":
        model = "rf"
    else:
        model = "lr" if rows < 300 else "rf"

    return {
        "target": target,
        "group": group,
        "drop": drop,
        "task": task,
        "classes": classes,
        "model": model,
        "params": {"n_estimators": 300} if model == "rf" else {"epochs": 30},
        "test_size": 0.25,
    }


def dataset_schema(path: Path) -> dict[str, Any]:
    """给训练对话框用的列信息（目标列候选 + 推荐配置）。"""
    df = read_file(path)
    rows = max(df.height, 1)
    columns: list[dict[str, Any]] = []

    for col in df.columns:
        series = df[col]
        columns.append(
            {
                "name": col,
                "dtype": str(series.dtype),
                "unique": int(series.n_unique()),
                "null_pct": round(series.null_count() / rows * 100, 1),
            }
        )

    candidates: list[dict[str, Any]] = []
    for item in columns:
        if 2 <= item["unique"] <= 10:
            series = df[item["name"]]
            candidates.append(
                {
                    **item,
                    "top": [str(v) for v in series.drop_nulls().unique().head(6).to_list()],
                }
            )

    recommendation = _recommend(df, columns, df.height)
    if recommendation.get("target"):
        series = df[recommendation["target"]].drop_nulls()
        if recommendation.get("task") == "classification":
            recommendation["classes"] = [
                str(v) for v in series.unique().head(12).to_list()
            ]
            counts = series.cast(pl.Utf8).value_counts()
            recommendation["class_counts"] = {
                str(row[0]): int(row[1]) for row in counts.iter_rows()
            }
        else:
            recommendation["classes"] = []
            numeric = series.cast(pl.Float64, strict=False).drop_nulls()
            if numeric.len():
                recommendation["target_stats"] = {
                    "min": round(float(numeric.min()), 3),
                    "max": round(float(numeric.max()), 3),
                    "mean": round(float(numeric.mean()), 3),
                }

    return {
        "file": path.name,
        "rows": df.height,
        "cols": len(df.columns),
        "columns": columns,
        "target_candidates": candidates[:12],
        "recommendation": recommendation,
    }


def _slugify(text: str) -> str:
    cleaned = "".join(ch for ch in text if ch.isalnum() or ch in ("_", "-", "一", "\u4e00"))
    cleaned = cleaned.strip("_-")[:40]
    return cleaned or "model"


def inspect_dataset(path: Path, target: str, group: str | None, drop: list[str]) -> dict[str, Any]:
    """读取真实数据，提炼脚本需要的所有 schema 信息。"""
    df = read_file(path)
    if target not in df.columns:
        raise ValueError(f"目标列不存在：{target}")

    df = df.filter(pl.col(target).is_not_null())
    rows = max(df.height, 1)
    numeric: list[str] = []
    categorical: list[str] = []
    fill: dict[str, float] = {}
    categories: dict[str, list[str]] = {}
    dropped: list[dict[str, str]] = []

    for col in df.columns:
        if col in (target, group) or col in drop:
            continue
        series = df[col]
        if series.null_count() / rows > MAX_MISSING_RATIO:
            continue
        unique = series.n_unique()
        if unique <= 1:
            continue

        if _is_numeric(series.dtype):
            if unique / rows > 0.9 and series.dtype in (pl.Int64, pl.Int32, pl.UInt64, pl.UInt32):
                dropped.append({"name": col, "reason": "疑似 ID"})
                continue
            values = series.cast(pl.Float64).to_numpy()
            finite = values[np.isfinite(values)]
            numeric.append(col)
            fill[col] = float(np.median(finite)) if finite.size else 0.0
        else:
            if unique > MAX_CARDINALITY:
                continue
            categorical.append(col)
            categories[col] = sorted({str(v) for v in series.cast(pl.Utf8).fill_null("缺失").to_numpy()})

    if not numeric and not categorical:
        raise ValueError("没有可用特征列")

    target_series = df[target]
    if _is_numeric(target_series.dtype) and target_series.n_unique() > 10:
        task = "regression"
        positive = negative = None
    else:
        labels = sorted({str(v) for v in target_series.cast(pl.Utf8).to_numpy()})
        if len(labels) != 2:
            raise ValueError(f"目标列有 {len(labels)} 个类别，目前只支持二分类或回归")
        values = target_series.cast(pl.Utf8).to_numpy()
        counts = {label: int(np.sum(values == label)) for label in labels}
        positive = min(counts, key=counts.get)
        negative = next(label for label in labels if label != positive)
        task = "classification"

    return {
        "rows": df.height,
        "cols": len(df.columns),
        "task": task,
        "numeric": numeric,
        "categorical": categorical,
        "fill": fill,
        "categories": categories,
        "positive": positive,
        "negative": negative,
        "dropped": dropped,
    }


def build_script(
    *,
    file_name: str,
    target: str,
    task: str,
    model: str,
    params: dict[str, Any],
    group: str | None,
    drop: list[str],
    test_size: float,
    out_dir: str,
    seed: int = 42,
) -> tuple[str, dict[str, Any]]:
    """生成脚本源码 + 数据集摘要。"""
    path = Path(out_dir) / file_name
    schema = inspect_dataset(path, target, group, drop)

    labels = {"rf": "随机森林", "gb": "梯度提升", "lr": "逻辑回归", "mlp": "神经网络"}
    model = model if model in labels else "rf"
    task = task if task in ("classification", "regression") else schema["task"]

    slug = _slugify(f"{Path(file_name).stem}_{target}_{model}")
    metric_key = "val_pr_auc" if task == "classification" else "val_r2"
    if task == "regression":
        params.setdefault("n_estimators", 300 if model == "rf" else 200)
    else:
        params.setdefault("n_estimators", 300 if model == "rf" else 200)
    if model in ("lr", "mlp"):
        params.setdefault("epochs", 30)

    config = {
        "file": file_name,
        "target": target,
        "task": task,
        "model": model,
        "model_label": labels[model],
        "params": params,
        "group": group,
        "drop": drop,
        "test_size": float(test_size),
        "positive": schema["positive"],
        "negative": schema["negative"],
        "numeric": schema["numeric"],
        "categorical": schema["categorical"],
        "fill": schema["fill"],
        "categories": schema["categories"],
        "seed": seed,
        "out_dir": ".",
        "slug": slug,
        "metric_key": metric_key,
    }

    header = (
        "自律训练脚本 —— 由 SmeltLab 根据数据集自动生成\n\n"
        f"数据集：{file_name}（{schema['rows']} 行 × {schema['cols']} 列）\n"
        f"目标列：{target}（{'二分类' if task == 'classification' else '回归'}）\n"
        f"模型：{labels[model]} · 特征 {len(schema['numeric']) + len(schema['categorical'])} 个"
        f"（数值 {len(schema['numeric'])} / 类别 {len(schema['categorical'])}）\n"
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        "流程：读取数据 → 构建特征 → 切分 → 训练（逐轮上报进度）→ 测试集评估 → 保存模型与预测\n"
        "运行：python 本文件"
    )

    script = _TEMPLATE.replace("__HEADER__", header).replace(
        "__CONFIG__", json.dumps(config, ensure_ascii=False, indent=4)
    )

    summary = {
        "file": file_name,
        "rows": schema["rows"],
        "cols": schema["cols"],
        "task": task,
        "target": target,
        "model": model,
        "model_label": labels[model],
        "numeric": len(schema["numeric"]),
        "categorical": len(schema["categorical"]),
        "positive": schema["positive"],
        "negative": schema["negative"],
        "dropped": schema["dropped"],
        "slug": slug,
    }
    return script, summary
