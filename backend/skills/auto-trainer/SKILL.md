---
name: auto-trainer
description: 在清洗后的数据上自动训练模型并给出可视化评估。当用户提出「训练模型」「建模」「预测某个字段」「分类」「回归」「哪个模型效果最好」「调参」「特征重要性」等需求时使用。
---

# 自动建模技能

你负责在对话里完成**找数据 → 定目标 → 给出训练配置卡 → 解释结果**。真正的代码生成、训练与可视化由界面上的训练卡完成。

## 工具

```bash
<python> -m app.cli schema --file <文件名>          # 行数/列数/候选目标列 + 推荐配置
<python> -m app.cli train --file ... --target ...   # 命令行快速训练（仅在用户明确要求时用）
```

`<python>` 换成运行环境里给出的 Python 解释器路径（含空格时要加引号）。

## 主流程

1. **找文件**：`ls` 查看工作区，优先选 `cleaned_*` 文件；有多个文件且用户没说，问一句。
2. **看结构**：执行 `schema`，拿到 rows / columns / `target_candidates`。
3. **定目标**（最多问一次）：
   - 用户没指定 → 从候选中推荐 1 个并说明理由，请用户确认；
   - 用户已指定 → 直接进入下一步。
4. **输出训练配置卡**：在回复末尾放一个 ```train-config 代码块，里面是**单行、合法** JSON：

```train-config
{"file":"cleaned_data.csv","target":"死亡","task":"classification","rows":1954,"cols":258,"group":"病人ID","drop":["住院费用","出院情况"],"positive":"1","recommended":{"model":"rf","test_size":0.25},"note":"按患者分组切分，避免同一病人跨集"}
```

字段说明：
- `file`、`target`、`task`（`classification` / `regression`）必填；`rows`/`cols` 用 `schema` 输出里的数字
- `group`：有患者/用户/设备 ID 且一人多行时必填，避免数据泄漏
- `drop`：疑似结局信息列（费用、出院情况、出院类型、各类评分结果等），最多列 8 个
- `positive`：二分类的正例取值（通常是少数类）
- `recommended.model`：`rf` / `gb` / `lr` / `mlp`，按数据规模推荐（小样本优先 rf 或 lr）
- `recommended.test_size`：默认 0.25

5. **卡片下方一句话**：说明默认参数可以改、点击「开始训练」会按数据自动生成训练脚本并执行。**不要**再重复输出图表或指标（训练还没开始）。
6. **训练结束后**：用户会说「训练完了」或直接追问。此时按结果解释：最佳指标、混淆矩阵/曲线的含义、特征重要性、以及能不能用（样本量、正例数量、数据泄漏风险）。结果里的数字只能引用界面展示过的内容，不要编造。
7. **回退**：用户明确要求「不要界面、直接跑命令行」时，才使用 `train` 子命令，并按它的 JSON 输出组织表格与图表。

## 自写训练脚本时的日志规范（必须遵守）

用户明确说「不要界面、直接训练」，或必须自己生成训练脚本时，脚本**必须**同步写一份可实时读取的训练日志。缺日志的脚本视为不合格。

**文件约定**

- 路径：`train_logs/<脚本名>_<YYYYmmdd-HHMMSS>.jsonl`，放在工作区（产物会自动展示给用户）。
- 编码 UTF-8，**追加模式** `open(path, "a", encoding="utf-8")`，每行写完立即 `flush()`。
- **一行一条合法 JSON**，不写表头、注释、多行结构，保证 `for line in f: json.loads(line)` 可用。

**字段约定（每条记录都要有，缺失填 null）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | string | ISO8601 带时区，如 `2026-10-20T21:03:11+08:00` |
| `step` | int | 从 0 开始，每个 epoch / 每批树增量加 1 |
| `stage` | string | `start` / `epoch` / `batch` / `eval` / `end` / `error` / `aborted` |
| `loss` | number\|null | 当前损失 |
| `metric` | object | 关键指标，如 `{"pr_auc":0.81,"f1":0.63}` |
| `lr` | number\|null | 当前学习率 |
| `elapsed_s` | number | 自训练开始的秒数，保留 3 位小数 |
| `pct` | int\|null | 0-100 的总体进度 |
| `error` | string | 仅 `error` / `aborted` 记录需要，截断到 500 字 |

**参考实现（直接复用，不要简化掉 flush / finally）**

```python
import json
import time
from datetime import datetime

class TrainLog:
    """JSONL 训练日志：一行一条、追加写入、异常也不丢已有记录。"""

    def __init__(self, path, meta=None):
        self.fh = open(path, "a", encoding="utf-8")
        self.started = time.time()
        self.step = 0
        self.write("start", metric=meta or {}, pct=0)

    def write(self, stage, *, loss=None, metric=None, lr=None, pct=None, error=None):
        record = {
            "ts": datetime.now().astimezone().isoformat(timespec="seconds"),
            "step": self.step,
            "stage": stage,
            "loss": None if loss is None else round(float(loss), 6),
            "metric": metric or {},
            "lr": None if lr is None else float(lr),
            "elapsed_s": round(time.time() - self.started, 3),
            "pct": None if pct is None else int(pct),
        }
        if error is not None:
            record["error"] = str(error)[:500]
        self.fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.fh.flush()
        if stage in ("epoch", "batch", "eval"):
            self.step += 1

    def close(self):
        try:
            self.fh.close()
        except Exception:
            pass
```

调用方式（异常与中断都要留痕）：

```python
log = TrainLog("train_logs/train_20261020-210311.jsonl", {"rows": len(df), "target": target, "model": "rf"})
try:
    for epoch in range(epochs):
        loss = train_one_epoch(...)
        log.write("epoch", loss=loss, metric={"pr_auc": auc}, lr=lr, pct=int(20 + 70 * epoch / epochs))
    log.write("end", metric=best_metrics, pct=100)
except KeyboardInterrupt:
    log.write("aborted", error="user interrupt", pct=None)
    raise
except Exception as exc:
    log.write("error", error=exc, pct=None)
    raise
finally:
    log.close()
```

**同步输出 stdout 进度**：每次 `log.write(...)` 后同时打印 `@@PROGRESS {"pct": <同上>, "stage": "<阶段名>"}`（flush），界面进度条读它，两者数值必须一致。

**读取方式**：`tail -n 20 <日志文件>` 逐行 JSON 解析即可实时看到最新 step、loss、指标与进度；日志不完整也只会缺最后几行，不影响已写入内容。

## 硬性规则

- 配置卡的 JSON 必须一行写完、可被 `JSON.parse` 解析；不要加注释、尾逗号或代码块外的文字。
- `rows`、`cols`、列名必须来自 `schema`/`profile` 输出，禁止估算。
- 分类任务优先看 PR-AUC；正例很少时必须提前说明「结果只作探索性参考」。
- 不要声称训练已经完成，除非用户告诉你已经跑完；不要伪造指标。
- 不要贴命令原文、JSON 原文（配置卡除外）、堆栈或绝对路径。
- 自己写训练脚本时必须带 JSONL 训练日志（`train_logs/*.jsonl`），且 `stage`/`pct` 与 `@@PROGRESS` 对齐；没有日志的脚本不要交付。
- 日志必须能在训练过程中被读取（追加 + 逐行 flush），禁止训练结束才一次性写文件。
- 回复用简体中文，结论先行，不要寒暄。
