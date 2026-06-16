# DataCleanr

AI-powered data cleaning pipeline for ML engineers.

**Clean your ML training data in minutes, not days.**

## Quick Start

### Backend (FastAPI)

```bash
cd backend
pip install fastapi uvicorn python-multipart polars pyarrow anthropic pydantic pydantic-settings python-dotenv
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY (optional - presets work without it)
python -m uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:3000

## Architecture

```
User uploads CSV/JSON/Excel
  → Profiler Engine (Polars) → Health Report (score, issues, column analysis)
  → Cleaning Engine:
      → Natural Language: LLM generates plan → deterministic code execution
      → Preset Actions: direct deterministic execution
  → Diff Review (before/after comparison)
  → Export cleaned data
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/datasets/upload` | Upload file (multipart) |
| GET | `/api/datasets/:id/profile` | Get data health report |
| GET | `/api/datasets/:id/preview` | Preview first N rows |
| GET | `/api/datasets/:id/export` | Export dataset |
| POST | `/api/clean/:id` | Run cleaning (AI or preset) |
| GET | `/api/clean/jobs/:id/diff` | Get change diff |
| GET | `/api/clean/jobs/:id/export` | Export cleaned data |

## Supported Operations

| Operation | Description |
|-----------|-------------|
| `dedup` | Remove exact/fuzzy duplicate rows |
| `pii_mask` | Detect and mask PII (email, phone, SSN, CN ID) |
| `missing` | Handle missing values (drop/fill) |
| `outlier` | Filter statistical outliers (IQR method) |
| `text_clean` | Strip whitespace, normalize text |
| `date_standardize` | Standardize mixed date formats |

## Tech Stack

- **Backend**: Python 3.10+, FastAPI, Polars, Anthropic Claude API
- **Frontend**: Next.js 14, React 18, Tailwind CSS, TypeScript
- **AI**: Hybrid model — LLM for understanding, deterministic code for execution

## License

MIT
