<div align="center">

# SmeltLab

**AI data cleaning + one-click modeling — upload dirty data, say one sentence, get clean data and a trained model.**

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![Polars](https://img.shields.io/badge/Polars-powered-orange.svg)](https://pola.rs/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING)

</div>

<p align="center">
  <img src="docs/banner-readme.png" alt="SmeltLab — AI data cleaning and one-click modeling UI" width="860" />
</p>

<p align="center">
  <a href="docs/demo-clean.gif">🎬 Cleaning demo</a> ·
  <a href="docs/demo-train.gif">▶ Modeling demo</a> ·
  <a href="demo_videos/">📹 4 demo videos</a> ·
  <a href="sample_data/dirty_patients.csv">📥 Sample data</a>
</p>

---

## 🤯 Why we built this: cleaning data takes longer than modeling

Everyone who does machine learning wastes time on the same thing:

- You get a CSV, spend half an hour running `df.info()` to check missing values, duplicates, and outliers;
- Dates come in three formats, gender has nine different spellings, and `999` and `-1` are mixed into the age column;
- Only after cleaning do you realize that **post-hoc information** like "hospitalization cost" and "discharge department" leaked into features, inflating metrics;
- Once you finally clean it, another hour goes to setting up the environment, splitting data, training models, and plotting curves.

**SmeltLab compresses this pipeline into three steps: Upload → One sentence → Results.**

> **Why "SmeltLab"**: Smelting turns ore into metal — dirty data goes in, a trainable model comes out. Lab is the workbench — health check, cleaning, training, and interpretation, all in one interface.

---

## ✨ Features: Data Health Check · Auto Cleaning · One-Click AutoML

| | |
|---|---|
| 🩺 **Data Health Check** | Health score 0–100 · 5 issue categories · Column-level profiling |
| 🧹 **One-Click Cleaning** | 9 preset operations · Before/after diff review |
| 💬 **Conversational Cleaning** | Plain language: "Remove duplicates, unify formats, mask PII" |
| 👀 **Visible Process** | Real-time step updates · Per-step timing · Progress bars for long tasks |
| 🎯 **Training Recommendations** | Auto-detect target / group / leakage columns |
| 🚀 **One-Click Modeling** | Random Forest · Gradient Boosting · Logistic Regression · Neural Network |
| 📈 **Result Visualization** | PR-AUC / ROC / Confusion matrix / Feature importance |
| 🤖 **AI Interpretation** | Whether metrics are usable, what the risks are, what to do next |
| 🧩 **Recipe Reuse** | Save cleaning steps as Recipes, apply to similar data with one click |
| 🔒 **Local-First** | Data and artifacts stay on your machine, preset features work fully offline |

---

## 🖥 Screenshots: Conversational Data Cleaning & Model Training

<p align="center">
  <img src="docs/demo-clean.gif" alt="Conversational cleaning: steps tick by in real time, each with timing, long tasks show progress" width="720" />
</p>

<p align="center"><em>Real-time visible process — not a black box</em></p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/health-report.png" alt="Data health check and cleaning results"/></td>
    <td width="50%"><img src="docs/screenshots/train-config.png" alt="Training config: auto-recommended target/group/exclusion columns"/></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/chat-train-card.png" alt="In-chat training card"/></td>
    <td width="50%"><img src="docs/screenshots/train-result.png" alt="Training results and curves"/></td>
  </tr>
</table>

<p align="center">
  <img src="docs/demo-train.gif" alt="One-click modeling" width="720" />
</p>

---

## ⚡ Quick Start: Run FastAPI + Next.js Locally

### 1. Clone the repository

```bash
git clone https://github.com/PHclaw/smeltlab.git
cd smeltlab
```

### 2. Start the backend (FastAPI · port 8000)

```bash
# macOS / Linux
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

```powershell
# Windows (PowerShell)
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

### 3. Start the frontend (Next.js · port 3000)

```bash
cd frontend
npm install
npm run dev
```

### 4. Try the demo

Open **http://localhost:3000**, drag [`sample_data/dirty_patients.csv`](sample_data/dirty_patients.csv) into the input box, and send:

> Please health-check and clean this data, then train a model to predict "complications"

<details>
<summary>🔑 Want "conversational cleaning / AI interpretation"?</summary>

Configure a model provider in `backend/.env` (pick one):

```bash
AI_PROVIDER=glm            # or anthropic
GLM_API_KEY=sk-xxx         # corresponding API key
```

> The full experience works without an API key: data health checks, 9 preset cleaning operations, training card modeling, and metric curves don't depend on an LLM.
</details>

---

## 🧭 Three Ways to Use: Conversational / Training Card / CLI

| Mode | For whom | Entry point |
|---|---|---|
| 💬 **Conversational** | Most people: plain language, fully automated | Type your request in the homepage input |
| 🎛 **Training Card** | Want to choose models and tune params | Chat page → "Train" (top right) → Select dataset → Start training |
| ⌨️ **CLI** | Integrate into your own pipeline | `python -m app.cli ...` |

```bash
cd backend

# Health check: score + issue list + target column candidates + recommended training config
python -m app.cli profile --file ../sample_data/dirty_patients.csv

# Cleaning: 9 operations, composable
python -m app.cli clean --file ../sample_data/dirty_patients.csv --ops dedup,missing,outlier,text_clean,pii_mask --out cleaned_patients.csv

# View recommended config
python -m app.cli schema --file cleaned_patients.csv

# Train directly
python -m app.cli train --file cleaned_patients.csv --target Complications --group PatientID --time-budget 300

# All available operations
python -m app.cli ops
```

---

## 🏗 Architecture: Deterministic Cleaning + LLM Only for Intent Understanding

```
+-------------------------------------------------------------------+
|Browser   Next.js 14 / React / Tailwind                            |
|  upload . chat . train card . charts . SSE progress               |
+-------------------------------------------------------------------+
                             |
                             | REST + SSE
                             v
+-------------------------------------------------------------------+
|FastAPI   app/api/routes                                           |
|  datasets . clean . train . agent . recipes . auth . settings     |
+-------------------------------------------------------------------+
                             |
                             v
+-------------------------------------------------------------------+
|Services   app/services                                            |
|  profiler        health score, issue detect, column profile       |
|  cleaner         9 preset ops + before/after diff                 |
|  trainer         light AutoML, grouped split, metrics, charts     |
|  trainer_codegen readable script + progress + JSONL log           |
|  training_jobs   run jobs, parse progress and result              |
|  pi_agent        local agent (pi CLI) -> visible step feed        |
+-------------------------------------------------------------------+
                             |
                             v
                             +--> Polars + scikit-learn  (local workspace)
```

**Design trade-offs**: All cleaning and modeling is done with deterministic code (Polars / scikit-learn); the LLM only handles "intent understanding + result interpretation". Metrics are reproducible, the process is auditable, and the model never fabricates numbers.

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 · React 18 · TypeScript · Tailwind CSS |
| Backend | FastAPI · Pydantic · Polars · scikit-learn · joblib |
| Agent | pi CLI (local agent engine, JSONL event stream) |
| Storage | Local file workspace (SQLite only for accounts/quotas) |

---

## 📁 Project Structure

```
SmeltLab/
├── backend/
│   ├── app/
│   │   ├── api/routes/      # REST endpoints (datasets / clean / train / agent ...)
│   │   ├── services/        # profiler / cleaner / trainer / trainer_codegen / pi_agent ...
│   │   └── cli.py           # CLI entry: profile / clean / schema / train / ops
│   ├── skills/              # Agent skill definitions (data cleaning, auto modeling)
│   └── requirements.txt
├── frontend/
│   ├── app/                 # Pages: chat / clean / train / recipes / settings
│   └── components/          # UI components (training card, charts, markdown rendering ...)
├── sample_data/             # Dirty demo datasets (194 rows × 15 columns)
├── demo_videos/             # 4 demo videos (landscape + portrait) and recording scripts
└── docs/                    # PRD / screenshots / GIF demos / social preview banners
```

---

## 🗺 Roadmap

- [ ] Multi-class and multi-target support
- [ ] Hyperparameter auto-search (Optuna)
- [ ] Docker Compose one-click deployment
- [ ] Recipe community marketplace

<details>
<summary>Already shipped</summary>

- [x] Data health check (score + 5 issue categories)
- [x] 9 preset cleaning operations + diff review
- [x] Conversational cleaning with visible process
- [x] Training card: auto-recommended target / group / leakage columns
- [x] 4 models + curves + feature importance + AI interpretation
- [x] JSONL training logs (readable line-by-line in real time)
</details>

---

## ❓ FAQ

**Q: Is my data uploaded to the cloud?**

No. Data health checks, 9 preset cleaning operations, training card modeling, metrics, and curves are all completed locally using Polars / scikit-learn. Raw files and artifacts stay on your machine (by default in session workspaces under `backend/uploads`). Only features like "conversational cleaning" and "AI interpretation" call the model provider you configure in `backend/.env`.

**Q: What can I do without an API key?**

The full core pipeline works: Upload → Health check (score / 5 issue categories / column profiling) → Select cleaning operations → Before/after diff review → Training card modeling → PR-AUC / ROC / Confusion matrix / Feature importance. What's missing is "plain language commands" and "AI metric interpretation".

**Q: What data formats are supported?**

CSV, Excel (`.xlsx` / `.xls`), JSON, JSONL, Parquet; export supports CSV / JSON, CLI supports CSV and Parquet.

**Q: Does cleaning overwrite the original data?**

No. Cleaning results are written to new files; the original files remain unchanged. Every change can be reviewed column-by-column in the diff before confirming, and recipes can be saved for reuse on similar data.

**Q: Does it support multi-class classification and regression?**

Currently supports binary classification and regression (Random Forest / Gradient Boosting / Logistic Regression / Neural Network), with automatic detection of target columns, group columns, and post-hoc leakage columns. Multi-class and multi-target are on the roadmap.

**Q: How much data can it handle?**

Designed for small-to-medium tabular data on a local machine. Scale is primarily limited by memory; no distributed or billion-row optimizations yet. If you have specific large-scale data needs, feel free to open an Issue describing your scenario.

---

## 🔍 How SmeltLab Compares

| Tool | What it's good at | SmeltLab's difference |
|---|---|---|
| Handwritten pandas scripts | Full control, any quirky requirement | Chains "health check → clean → model → interpret" into one pipeline; cleaning steps save as Recipes for reuse — no rewriting for every dataset |
| OpenRefine | Manual row-by-row curation, clustering dirty values | Focuses on automatic health checks and connects to downstream modeling; supports "say one sentence" to trigger multi-step cleaning |
| ydata-profiling | Generates detailed data profile reports | Profiling is just the first step; cleaning and training follow directly, no tool switching needed |
| Cloud AutoML platforms | Model tuning and compute power | Local-first; preset features work fully offline; data never leaves your machine |

---

## 🙏 Acknowledgments

Built on the shoulders of: [Polars](https://pola.rs/) · [scikit-learn](https://scikit-learn.org/) · [FastAPI](https://fastapi.tiangolo.com/) · [Next.js](https://nextjs.org/) · [pi coding agent](https://github.com/earendil-works/pi)

---

## 🤝 Contributing

Issues and PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and local development setup.

We'd also love to hear: **What's the dirty data scenario you most want SmeltLab to handle automatically?**

---

## 📄 License

[MIT](LICENSE) © SmeltLab contributors

---

<div align="center">

**If this project saved you time on data cleaning, please give it a ⭐ Star — it makes a big difference for future development.**

</div>
