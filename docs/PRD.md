# SmeltLab - AI 数据清洗管道 MVP 产品规划

> **版本**: v0.1 MVP  
> **目标**: 4 周内上线可付费的最小可行产品  
> **目标用户**: AI/ML 开发者  
> **状态**: 规划阶段  

---

## 目录

1. [产品定位与愿景](#1-产品定位与愿景)
2. [目标用户画像](#2-目标用户画像)
3. [核心痛点与使用场景](#3-核心痛点与使用场景)
4. [MVP 功能范围](#4-mvp-功能范围)
5. [用户流程设计](#5-用户流程设计)
6. [技术架构](#6-技术架构)
7. [数据模型](#7-数据模型)
8. [API 设计](#8-api-设计)
9. [UI/UX 规划](#9-uiux-规划)
10. [定价模型](#10-定价模型)
11. [上市策略 (GTM)](#11-上市策略-gtm)
12. [成功指标](#12-成功指标)
13. [风险分析与应对](#13-风险分析与应对)
14. [4 周时间线](#14-四周时间线)
15. [MVP 之后](#15-mvp-之后)

---

## 1. 产品定位与愿景

### 一句话定位

**SmeltLab** — 用自然语言驱动的 AI 数据清洗管道，帮 ML 工程师把 3 天的数据清洗工作缩短到 3 分钟。

### 核心价值主张

| 对谁 | 解决什么 | 怎么解决 |
|------|---------|---------|
| AI/ML 开发者 | 微调/训练前的数据清洗耗时且痛苦 | 上传数据 → AI 自动分析 → 自然语言指令清洗 → 一键导出 |

### 为什么是现在？

1. **AI 训练数据需求爆发** — 每个做 fine-tuning / RAG 的团队都需要高质量清洗数据
2. **现有工具断层** — 企业级太重（Databricks），开源太原始（手写 Pandas 脚本）
3. **LLM 能力成熟** — GPT-4/Claude 已能可靠理解数据结构和清洗意图
4. **EMNLP 2025 论文验证** — LLM Agent 自动生成清洗工作流已被学术界验证可行

### 品牌

- **产品名**: SmeltLab
- **域名候选**: smeltlab.com / smeltlab.ai / cleandr.ai
- **Tagline**: "Clean data in minutes, not days."
- **中文 Tagline**: "数据清洗，从 3 天到 3 分钟。"

---

## 2. 目标用户画像

### 主要用户：AI/ML 开发者

```
姓名: 张明
年龄: 26-35
角色: AI 创业公司 ML 工程师 / 大厂 AI 团队数据工程师
技术水平: 熟练 Python/Pandas，了解 LLM fine-tuning
日常痛点:
  - 老板说"下周把模型跑起来"，但训练数据还是一团糟
  - 花 3 天写 Pandas 脚本清洗数据，改一个需求又要重写
  - 从多个来源合并数据时，格式混乱、重复、缺失值让人崩溃
  - 清洗完不知道数据质量到底怎么样，心里没底
工具现状: Jupyter + Pandas + 各种 Stack Overflow 复制的脚本
付费意愿: 高（公司报销，$50-200/月 不是问题）
发现渠道: Hacker News, Reddit r/MachineLearning, Twitter/X AI 圈, GitHub
```

### 次要用户（MVP 后扩展）

- **AI 独立开发者** — 做 AI side project，数据量不大但清洗烦人
- **数据分析师** — 不会写代码但需要清洗从各系统导出的报表
- **AI 产品经理** — 需要快速评估训练数据质量

---

## 3. 核心痛点与使用场景

### MVP 优先场景（按价值排序）

#### 场景 1: Fine-tuning 训练数据清洗 ⭐⭐⭐⭐⭐

```
触发: 张明要对 Llama 3 做 fine-tuning，有 50,000 条训练数据
问题:
  - 数据从 3 个不同来源收集，格式不一致
  - 有大量重复条目（约 15%）
  - 包含 PII 信息（姓名、邮箱、手机号）需要脱敏
  - 有些样本质量差（太短、乱码、语言混杂）
现状: 花 2-3 天写 Python 脚本，每次需求变化都要改代码
期望: 上传数据，告诉 AI "去重、脱敏、过滤低质量样本"，5 分钟搞定
```

#### 场景 2: RAG 知识库数据预处理 ⭐⭐⭐⭐

```
触发: 李华要给 RAG 系统导入 2000 份内部文档
问题:
  - 文档格式混杂（PDF/Word/HTML/Markdown）
  - 提取的文本有乱码、页眉页脚噪声、表格错位
  - 需要按统一 schema 结构化（标题/日期/正文/标签）
  - chunk 切分策略需要智能处理
现状: 用 LangChain/LlamaIndex 的默认 loader，效果差
期望: 上传文档，AI 自动理解结构，输出 RAG-ready 的 clean chunks
```

#### 场景 3: 多源数据合并清洗 ⭐⭐⭐⭐

```
触发: 王磊需要从 CRM + Excel + API 三个来源合并客户数据
问题:
  - 同一客户在不同系统中名字不同（"张三" / "Zhang San" / "张三丰"）
  - 日期格式混乱（2024-01-01 / 01/01/2024 / 2024年1月1日）
  - 电话号码格式不统一（+86-138... / 13800... / 86138...）
  - 部分字段缺失需要用合理值填充
现状: 手动 Excel VLOOKUP + 写 Python 脚本逐条处理
期望: 上传多个文件，AI 自动识别实体、统一格式、智能合并
```

#### 场景 4: 数据质量审计 ⭐⭐⭐

```
触发: 陈洁的模型上线前需要审计训练数据质量
问题:
  - 不确定数据中有多少标注错误
  - 需要检查数据分布是否偏移
  - 要生成数据质量报告给领导审批
现状: 手写检查脚本，容易遗漏
期望: 一键生成数据质量报告，可视化展示所有问题
```

---

## 4. MVP 功能范围

### IN（MVP 必须做）

| # | 功能 | 优先级 | 描述 |
|---|------|--------|------|
| F1 | **文件上传** | P0 | 支持 CSV、JSON、JSONL、Excel（.xlsx）拖拽上传，最大 100MB |
| F2 | **数据探测 (Profiling)** | P0 | 上传后自动生成数据体检报告：行数/列数、类型推断、缺失率、唯一值、分布概览、异常值检测 |
| F3 | **AI 问题诊断** | P0 | AI 分析数据并列出发现的问题（按严重程度排序），如："检测到 15.3% 重复行"、"email 列有 23% 格式异常" |
| F4 | **自然语言清洗指令** | P0 | 用户在输入框中用自然语言描述清洗需求，AI 理解并执行 |
| F5 | **预置清洗操作** | P0 | 一键执行常见操作：去重、PII 脱敏、格式标准化、缺失值处理、异常值过滤 |
| F6 | **Diff 对比视图** | P0 | 清洗前后逐行/逐字段对比，高亮变更，支持逐条接受/拒绝 |
| F7 | **导出** | P0 | 下载清洗后的文件（保持原格式），支持 CSV/JSON/JSONL/Excel |
| F8 | **清洗历史** | P1 | 记录每次清洗操作的步骤，可随时回退到任意版本 |
| F9 | **Recipe 保存** | P1 | 把清洗步骤保存为可复用的 Recipe，下次对类似数据一键复用 |
| F10 | **用户认证** | P1 | GitHub OAuth 登录（目标用户是开发者，GitHub 登录最自然） |
| F11 | **用量统计** | P1 | Dashboard 显示已用额度、清洗行数、剩余配额 |
| F12 | **付费集成** | P1 | Stripe 集成，Free/Pro 两档 |

### OUT（MVP 不做，后续迭代）

| 功能 | 理由 |
|------|------|
| PDF/Word 文档解析 | 技术复杂度高，MVP 先聚焦结构化数据 |
| 数据库直连（SQL/NoSQL） | 安全风险大，MVP 用文件上传足够 |
| 团队协作 | MVP 面向个人开发者 |
| API 开放 | MVP 先做 Web UI，验证产品价值 |
| 定时任务/自动管道 | MVP 先手动触发 |
| 多语言 UI | MVP 先做英文（目标用户全球化） |
| 私有部署 | MVP 用 SaaS 模式 |
| CLI 工具 | MVP 后根据需求决定 |

### 预置清洗操作清单（F5 详细）

| 操作 | 说明 | AI 智能点 |
|------|------|----------|
| **去重 (Dedup)** | 精确去重 + 模糊去重 | AI 判断"相似但不完全相同"的记录是否重复 |
| **PII 脱敏** | 检测并替换姓名、邮箱、电话、地址、身份证号 | AI 根据上下文识别，不靠正则（更准确） |
| **格式标准化** | 日期、电话、地址、货币统一格式 | AI 推断当前格式并转为目标格式 |
| **缺失值处理** | 删除/填充/插值 | AI 根据数据分布选择最优策略 |
| **异常值检测** | 统计异常 + 语义异常 | AI 不仅看数值，还看语义（"age=999"） |
| **文本清洗** | 去空格/特殊字符/统一编码/语言检测 | AI 判断保留哪些有意义的内容 |
| **长度过滤** | 按字段长度过滤低质量样本 | AI 推荐合理阈值 |
| **语言统一** | 检测并过滤/翻译非目标语言 | AI 多语言识别 |
| **标签一致性** | 检查分类标签是否一致 | AI 发现 "positive" vs "Positive" vs "pos" |
| **数据拆分** | train/val/test 划分 | AI 保证分布一致性（stratified split） |

---

## 5. 用户流程设计

### 核心用户流程（Happy Path）

```
[1] 首页/落地页
    │  "AI-Powered Data Cleaning for ML Engineers"
    │  [Try Free →]
    ▼
[2] 登录（GitHub OAuth）
    │  首次：自动创建账户，赠送 Free 额度
    ▼
[3] Dashboard
    │  显示：最近项目列表、用量统计、[+ New Project]
    ▼
[4] 创建项目 → 上传数据
    │  拖拽上传 CSV/JSON/JSONL/Excel
    │  自动识别编码和分隔符
    ▼
[5] 数据探测报告（自动生成，3-5秒）
    │
    │  ┌─────────────────────────────────────────┐
    │  │  📊 Data Health Score: 62/100            │
    │  │                                          │
    │  │  ⚠️  Issues Found (7):                   │
    │  │  🔴 Critical: 15.3% duplicate rows       │
    │  │  🔴 Critical: 23% emails invalid format  │
    │  │  🟡 Warning: 8% missing values in 'age'  │
    │  │  🟡 Warning: Mixed date formats          │
    │  │  🟢 Info: 3 outlier values in 'price'    │
    │  │  ...                                     │
    │  │                                          │
    │  │  [Auto Clean All ⚡]  [Custom Clean 🛠]   │
    │  └─────────────────────────────────────────┘
    │
    ▼
[6] 清洗工作台
    │
    │  方式 A: 自然语言
    │  ┌─────────────────────────────────────┐
    │  │ 💬 "Remove all duplicate rows,      │
    │  │     mask email and phone fields,    │
    │  │     standardize dates to ISO format"│
    │  │                     [Run ▶]         │
    │  └─────────────────────────────────────┘
    │
    │  方式 B: 预置操作按钮
    │  [🔄 Dedup] [🔒 PII Mask] [📅 Date Fix]
    │  [📊 Outliers] [❌ Missing] [📝 Text Clean]
    │
    ▼
[7] Diff 预览
    │
    │  ┌──────────────────────────────────────┐
    │  │  Showing 2,341 changes               │
    │  │                                      │
    │  │  Row 42:                             │
    │  │  email: john@gmail → [MASKED]  ❌    │
    │  │  date:  01/15/2024 → 2024-01-15  ✅  │
    │  │  name:  John Doe → John Doe (trim) ✅ │
    │  │                                      │
    │  │  [Accept All] [Reject All] [Review]  │
    │  └──────────────────────────────────────┘
    │
    ▼
[8] 确认并导出
    │  [⬇ Download CSV] [⬇ Download JSON]
    │  [💾 Save as Recipe] [📊 Quality Report]
    ▼
[9] 完成
    │  "Cleaned 50,000 rows in 2m 34s"
    │  "Quality Score: 62 → 94 (+32)"
    │  [Share on Twitter] [Start New Project]
```

### 关键交互原则

1. **即时反馈** — 每个操作 3 秒内给视觉反馈（loading skeleton / progress bar）
2. **可撤销** — 任何清洗步骤都可以 undo，给用户安全感
3. **渐进式披露** — 先展示概览，点击展开详情
4. **不破坏原始数据** — 所有操作都在副本上进行，原始文件永远不变

---

## 6. 技术架构

### 整体架构

```
                    ┌─────────────────────────┐
                    │      用户浏览器           │
                    │   Next.js 14 (App Router)│
                    │   + Tailwind + shadcn/ui │
                    └───────────┬─────────────┘
                                │ HTTPS
                    ┌───────────▼─────────────┐
                    │        Nginx / CDN       │
                    │     (Cloudflare Free)    │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
    ┌─────────▼──────┐ ┌───────▼───────┐ ┌───────▼──────┐
    │  Next.js API   │ │  FastAPI      │ │  Worker      │
    │  Routes        │ │  Backend      │ │  (Celery)    │
    │  (BFF 层)      │ │  (核心引擎)   │ │  (异步任务)  │
    │                │ │               │ │              │
    │ · Auth 代理    │ │ · 数据探测    │ │ · 大批量清洗 │
    │ · 轻量 CRUD    │ │ · AI 清洗     │ │ · 文件处理   │
    │ · 实时状态     │ │ · Recipe 管理 │ │ · 报告生成   │
    └───────┬────────┘ └───────┬───────┘ └───────┬──────┘
            │                  │                  │
    ┌───────▼──────────────────▼──────────────────▼──────┐
    │                    数据层                            │
    │                                                     │
    │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
    │  │ Postgres │  │ Redis    │  │ S3/MinIO         │  │
    │  │ (Supabase│  │ (Upstash)│  │ (Cloudflare R2)  │  │
    │  │  Free)   │  │          │  │                  │  │
    │  │          │  │          │  │                  │  │
    │  │ · 用户   │  │ · 缓存   │  │ · 原始文件       │  │
    │  │ · 项目   │  │ · 队列   │  │ · 清洗结果       │  │
    │  │ · Recipe │  │ · 会话   │  │ · 报告 PDF       │  │
    │  │ · 用量   │  │          │  │                  │  │
    │  └──────────┘  └──────────┘  └──────────────────┘  │
    └─────────────────────────────────────────────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │     外部服务             │
                    │                         │
                    │  · Claude API (清洗引擎) │
                    │  · GitHub OAuth (登录)   │
                    │  · Stripe (支付)        │
                    │  · Resend (邮件通知)    │
                    │  · PostHog (分析)       │
                    └─────────────────────────┘
```

### 技术栈选型

| 层 | 技术 | 版本 | 选型理由 |
|----|------|------|---------|
| **前端** | Next.js (App Router) | 14.x | SSR/SSG、API Routes、Vercel 一键部署 |
| **UI 组件** | shadcn/ui + Tailwind | latest | 高质量组件、高度可定制、开发者体验好 |
| **图表** | Recharts | 2.x | React 原生、轻量、够用 |
| **后端** | Python FastAPI | 0.110+ | 异步、高性能、自动生成 API 文档 |
| **数据处理** | Polars | 0.20+ | 比 Pandas 快 10-100x、内存效率高 |
| **AI 引擎** | Claude 3.5 Sonnet API | latest | 性价比高、指令遵循强、输出稳定 |
| **PII 检测** | Presidio (Microsoft) | latest | 开源、可扩展、支持多语言 PII |
| **数据库** | PostgreSQL (Supabase) | 15 | Free tier 500MB、自带 Auth、实时 |
| **缓存/队列** | Redis (Upstash) | latest | Serverless、按用量计费、免费额度大 |
| **文件存储** | Cloudflare R2 | — | 无出站流量费用、S3 兼容 API |
| **任务队列** | Celery + Redis | 5.x | 成熟稳定、支持重试和优先级 |
| **部署-前端** | Vercel | — | Next.js 原生支持、全球 CDN、Free tier |
| **部署-后端** | Railway | — | 简单易用、自动扩缩、$5 free credit/月 |
| **认证** | GitHub OAuth + Supabase Auth | — | 目标用户是开发者，GitHub 登录最自然 |
| **支付** | Stripe | — | 全球支付标准、Subscription API 成熟 |
| **邮件** | Resend | — | 开发者友好、React Email 支持 |
| **分析** | PostHog | — | 开源、Free tier 大、事件+漏斗分析 |
| **监控** | Sentry | — | 错误追踪标准方案 |
| **CI/CD** | GitHub Actions | — | 免费、集成好 |

### 核心引擎设计："混合模型"策略

这是产品最核心的技术决策——**LLM 负责"理解"，确定性代码负责"执行"**。

```
用户输入: "Remove duplicates and mask all emails"
                │
                ▼
    ┌───────────────────────┐
    │ Step 1: LLM 理解意图  │
    │                       │
    │ Claude 分析:          │
    │ · 用户数据 schema     │
    │ · 数据样本 (前 100 行) │
    │ · 用户指令            │
    │                       │
    │ 输出: 清洗计划        │
    │ (结构化 JSON)         │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Step 2: 生成清洗脚本  │
    │                       │
    │ LLM 生成 Python 代码: │
    │ · 使用 Polars API     │
    │ · 调用 Presidio       │
    │ · 确定性逻辑          │
    │                       │
    │ 输出: .py 清洗脚本    │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Step 3: 沙盒执行      │
    │                       │
    │ · 在隔离环境运行脚本  │
    │ · 捕获 stdout/stderr  │
    │ · 限制执行时间 (60s)  │
    │ · 限制内存 (2GB)      │
    │                       │
    │ 输出: 清洗结果 + diff │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Step 4: 结果验证      │
    │                       │
    │ · 检查输出数据完整性  │
    │ · 生成质量报告        │
    │ · 计算前后对比        │
    │                       │
    │ 输出: diff + report   │
    └───────────────────────┘
```

**为什么这样设计？**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 纯 LLM 处理数据 | 灵活 | 贵、慢、可能幻觉改错数据 |
| 纯规则引擎 | 快、确定 | 不灵活、无法理解自然语言 |
| **混合模型 ✅** | 灵活 + 快速 + 确定 + 低成本 | 需要好的 prompt engineering |

---

## 7. 数据模型

### 核心表结构

```sql
-- 用户表
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id   BIGINT UNIQUE NOT NULL,
    email       TEXT NOT NULL,
    name        TEXT,
    avatar_url  TEXT,
    plan        TEXT DEFAULT 'free',        -- free | pro | team
    usage_rows  INTEGER DEFAULT 0,          -- 本月已清洗行数
    usage_reset TIMESTAMPTZ,                -- 用量重置时间
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 项目表
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'active',      -- active | archived
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 数据集表（上传的原始数据）
CREATE TABLE datasets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,              -- 文件名
    format      TEXT NOT NULL,              -- csv | json | jsonl | xlsx
    row_count   INTEGER,
    col_count   INTEGER,
    file_size   BIGINT,                     -- bytes
    storage_key TEXT NOT NULL,              -- R2 object key
    schema_info JSONB,                      -- 列名、类型、示例值
    profile     JSONB,                      -- 数据探测报告
    status      TEXT DEFAULT 'pending',     -- pending | profiling | ready | error
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- 清洗任务表
CREATE TABLE clean_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id  UUID REFERENCES datasets(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    instruction TEXT,                       -- 用户的自然语言指令
    job_type    TEXT NOT NULL,              -- natural_language | preset | recipe
    operations  JSONB,                     -- 清洗操作列表（结构化）
    generated_code TEXT,                    -- LLM 生成的清洗脚本
    status      TEXT DEFAULT 'queued',      -- queued | running | done | failed
    rows_before INTEGER,
    rows_after  INTEGER,
    changes_count INTEGER,
    diff_data   JSONB,                     -- 变更 diff (存储在 R2, 此处为 key)
    diff_storage_key TEXT,
    error_msg   TEXT,
    duration_ms INTEGER,                    -- 执行耗时
    created_at  TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- Recipe 表（可复用清洗配方）
CREATE TABLE recipes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    operations  JSONB NOT NULL,            -- 清洗操作序列
    tags        TEXT[],                     -- 标签: ["dedup", "pii", "dates"]
    is_public   BOOLEAN DEFAULT false,     -- 是否公开分享
    usage_count INTEGER DEFAULT 0,         -- 使用次数
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 用量日志
CREATE TABLE usage_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    job_id      UUID REFERENCES clean_jobs(id),
    rows_processed INTEGER NOT NULL,
    ai_tokens_used INTEGER,                -- LLM token 消耗
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX idx_datasets_user ON datasets(user_id);
CREATE INDEX idx_datasets_project ON datasets(project_id);
CREATE INDEX idx_clean_jobs_dataset ON clean_jobs(dataset_id);
CREATE INDEX idx_clean_jobs_user ON clean_jobs(user_id);
CREATE INDEX idx_usage_logs_user_date ON usage_logs(user_id, created_at);
CREATE INDEX idx_recipes_tags ON recipes USING GIN(tags);
```

### 关键 JSONB 结构示例

```jsonc
// schema_info (数据集列信息)
{
  "columns": [
    {
      "name": "email",
      "inferred_type": "email",
      "null_count": 0,
      "null_pct": 0.0,
      "unique_count": 42350,
      "unique_pct": 84.7,
      "sample_values": ["john@gmail.com", "jane@yahoo.com", "..."],
      "issues": ["23% invalid format"]
    },
    {
      "name": "date",
      "inferred_type": "date",
      "formats_detected": ["MM/DD/YYYY", "YYYY-MM-DD", "DD.MM.YYYY"],
      "null_count": 120,
      "null_pct": 0.24,
      "sample_values": ["01/15/2024", "2024-03-20", "..."],
      "issues": ["Mixed date formats detected"]
    }
  ]
}

// profile (数据探测报告)
{
  "health_score": 62,
  "total_rows": 50000,
  "total_columns": 8,
  "duplicate_rows": 7650,
  "duplicate_pct": 15.3,
  "issues": [
    {
      "severity": "critical",
      "category": "duplication",
      "message": "15.3% duplicate rows detected",
      "affected_rows": 7650,
      "suggestion": "Remove exact and near-duplicate rows"
    },
    {
      "severity": "critical",
      "category": "format",
      "message": "23% of email values have invalid format",
      "affected_column": "email",
      "affected_rows": 11500,
      "suggestion": "Standardize or mask email field"
    }
  ]
}

// operations (清洗操作序列)
{
  "steps": [
    {
      "id": "step_1",
      "type": "dedup",
      "config": {
        "method": "exact",
        "columns": null,
        "keep": "first"
      },
      "rows_removed": 7650
    },
    {
      "id": "step_2",
      "type": "pii_mask",
      "config": {
        "entities": ["EMAIL", "PHONE", "PERSON"],
        "method": "hash",
        "columns": ["email", "phone", "name"]
      },
      "values_masked": 42350
    },
    {
      "id": "step_3",
      "type": "date_standardize",
      "config": {
        "target_format": "YYYY-MM-DD",
        "columns": ["date", "created_at"]
      },
      "values_transformed": 18200
    }
  ]
}
```

---

## 8. API 设计

### RESTful API（后端 FastAPI）

```yaml
# === 认证 ===
GET    /api/auth/github           # GitHub OAuth 重定向
GET    /api/auth/github/callback  # OAuth 回调
POST   /api/auth/logout           # 登出
GET    /api/auth/me               # 获取当前用户信息

# === 项目管理 ===
GET    /api/projects              # 列出用户所有项目
POST   /api/projects              # 创建项目
GET    /api/projects/:id          # 获取项目详情
PATCH  /api/projects/:id          # 更新项目
DELETE /api/projects/:id          # 删除项目

# === 数据集管理 ===
GET    /api/projects/:id/datasets           # 列出项目下的数据集
POST   /api/projects/:id/datasets/upload    # 上传文件 (multipart/form-data)
GET    /api/datasets/:id                    # 获取数据集详情
GET    /api/datasets/:id/profile            # 获取数据探测报告
GET    /api/datasets/:id/preview            # 获取数据预览 (前 100 行)
DELETE /api/datasets/:id                    # 删除数据集

# === 清洗任务 ===
POST   /api/datasets/:id/clean              # 提交清洗任务
  body: {
    instruction: "Remove duplicates and mask emails",  # 自然语言
    operations: [...],                                  # 或预置操作
    recipe_id: "uuid"                                   # 或使用 Recipe
  }
GET    /api/clean-jobs/:id                   # 获取任务状态
GET    /api/clean-jobs/:id/diff              # 获取 diff 数据
GET    /api/clean-jobs/:id/diff/stream       # SSE 流式返回 diff (大文件)
POST   /api/clean-jobs/:id/apply             # 确认应用清洗结果
POST   /api/clean-jobs/:id/reject            # 拒绝清洗结果

# === 导出 ===
GET    /api/datasets/:id/export              # 导出清洗后的数据
  query: ?format=csv|json|jsonl|xlsx
  response: 文件下载

# === Recipe 管理 ===
GET    /api/recipes                          # 列出我的 Recipes
POST   /api/recipes                          # 创建 Recipe
GET    /api/recipes/:id                      # 获取 Recipe 详情
PATCH  /api/recipes/:id                      # 更新 Recipe
DELETE /api/recipes/:id                      # 删除 Recipe
GET    /api/recipes/community                # 浏览社区公开 Recipes
POST   /api/recipes/:id/apply               # 将 Recipe 应用到数据集

# === 用量 & 计费 ===
GET    /api/usage                            # 获取当前用量
GET    /api/usage/history                    # 用量历史
POST   /api/billing/checkout                 # 创建 Stripe 结账会话
GET    /api/billing/portal                   # Stripe 客户门户

# === WebSocket / SSE ===
WS     /ws/clean-jobs/:id                    # 实时推送清洗进度
```

### API 设计原则

1. **所有列表接口支持分页** — `?page=1&per_page=20`
2. **统一错误格式** — `{ "error": "code", "message": "...", "details": {} }`
3. **Rate limiting** — Free: 10 req/min, Pro: 60 req/min
4. **CORS** — 仅允许自己的前端域名
5. **认证** — JWT in cookie (httpOnly, secure)

---

## 9. UI/UX 规划

### 页面清单

| 页面 | 路由 | 描述 |
|------|------|------|
| Landing Page | `/` | 产品介绍、功能展示、定价、CTA |
| Login | `/login` | GitHub OAuth 登录页 |
| Dashboard | `/dashboard` | 项目列表、用量概览 |
| New Project | `/projects/new` | 创建项目 + 上传数据 |
| Project Detail | `/projects/:id` | 数据集列表、项目概览 |
| Data Profiling | `/datasets/:id/profile` | 数据体检报告（自动跳转） |
| Cleaning Workspace | `/datasets/:id/clean` | **核心页面** — 清洗工作台 |
| Diff Review | `/datasets/:id/diff/:jobId` | 清洗结果 Diff 审查 |
| Recipes | `/recipes` | 我的 Recipe 列表 |
| Recipe Editor | `/recipes/:id` | 编辑/查看 Recipe |
| Community Recipes | `/recipes/community` | 社区公开 Recipe |
| Settings | `/settings` | 账户设置、订阅管理 |
| Pricing | `/pricing` | 定价页 |

### 核心页面 Wireframe: 清洗工作台

```
┌──────────────────────────────────────────────────────────────┐
│  SmeltLab   Dashboard > Project > dataset_v2.csv > Clean  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Data Overview ─────────────────────────────────────────┐ │
│  │  📄 dataset_v2.csv  │  50,000 rows  │  8 cols  │ 12MB  │ │
│  │  Health: ████████░░ 62/100  │  7 issues found           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Clean ─────────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  💬 What do you want to clean?                          │ │
│  │  ┌──────────────────────────────────────────────┐       │ │
│  │  │ Remove duplicates, mask PII in email and     │       │ │
│  │  │ phone columns, standardize all dates to      │       │ │
│  │  │ ISO format                                   │       │ │
│  │  └──────────────────────────────────────────────┘       │ │
│  │                                          [▶ Run Clean]  │ │
│  │                                                          │ │
│  │  ── or use quick actions ──                              │ │
│  │  [🔄 Dedup] [🔒 PII Mask] [📅 Dates] [📊 Outliers]    │ │
│  │  [❌ Missing] [📝 Text] [🌐 Language] [🏷 Labels]      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ Cleaning Pipeline ─────────────────────────────────────┐ │
│  │                                                          │ │
│  │  ✅ Step 1: Dedup (exact)     -7,650 rows    2.1s      │ │
│  │  ✅ Step 2: PII Mask (email)  42,350 masked  4.3s      │ │
│  │  ✅ Step 3: PII Mask (phone)  38,200 masked  3.8s      │ │
│  │  🔄 Step 4: Date Standardize  processing...  --        │ │
│  │  ⏳ Step 5: Outlier Filter    queued         --        │ │
│  │                                                          │ │
│  │  Total: 3/5 done  │  ETA: ~15s                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Diff 审查页面

```
┌──────────────────────────────────────────────────────────────┐
│  Review Changes   2,341 total changes  │ Filter: All ▼      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Summary ───────────────────────────────────────────────┐│
│  │  Rows: 50,000 → 42,350 (-7,650 dedup)                  ││
│  │  Emails masked: 42,350  │  Dates fixed: 18,200          ││
│  │  Quality: 62 → 94 (+32)                                 ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Changes ────────────── [Accept All] [Reject All] ──────┐│
│  │                                                          ││
│  │  Row #1                                                  ││
│  │  ┌──────────┬─────────────────────┬─────────────────┐   ││
│  │  │ Field    │ Before              │ After           │   ││
│  │  ├──────────┼─────────────────────┼─────────────────┤   ││
│  │  │ email    │ john@gmail.com      │ a3f8c2...[MASK] │   ││
│  │  │ phone    │ +1 (555) 123-4567   │ ***-***-****    │   ││
│  │  │ date     │ 01/15/2024          │ 2024-01-15      │   ││
│  │  └──────────┴─────────────────────┴─────────────────┘   ││
│  │                                    [✅ Accept] [❌ Reject]││
│  │                                                          ││
│  │  Row #2 ...                                              ││
│  │  ...                                                     ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  [⬅ Back to Clean]              [✅ Apply & Export ⬇]       │
└──────────────────────────────────────────────────────────────┘
```

### Landing Page 关键区块

```
1. Hero: "Clean Data in Minutes, Not Days"
   - 30秒 demo 视频/GIF
   - [Try Free →] CTA

2. Problem: "80% of ML time is data cleaning"
   - 痛点共鸣，数据佐证

3. How it works: 3 步动画
   Upload → AI Cleans → Download

4. Features: 6 个核心功能卡片
   - AI-Powered Profiling
   - Natural Language Cleaning
   - PII Detection & Masking
   - Smart Deduplication
   - Before/After Diff
   - Reusable Recipes

5. Social Proof: 用户评价 / 使用数字

6. Pricing: Free vs Pro 对比表

7. FAQ: 常见问题

8. Footer: Links + Newsletter
```

### UI 设计规范

| 项目 | 规范 |
|------|------|
| **主色调** | Indigo #6366F1（科技感、信任） |
| **辅色** | Emerald #10B981（成功/正向）、Amber #F59E0B（警告） |
| **字体** | Inter (正文) + JetBrains Mono (代码/数据) |
| **圆角** | 8px (卡片) / 6px (按钮) / 4px (输入框) |
| **暗色模式** | MVP 不做，仅浅色模式 |
| **响应式** | Desktop first，MVP 不优化移动端（目标用户在电脑上使用） |

---

## 10. 定价模型

### MVP 阶段定价（2 档，极简）

| | **Free** | **Pro** |
|---|---|---|
| **价格** | $0 | $49/月 |
| **清洗行数** | 5,000 行/月 | 500,000 行/月 |
| **文件上传** | 10MB/文件 | 100MB/文件 |
| **AI 清洗** | ✅ 基础（3 次/天） | ✅ 无限 |
| **预置操作** | ✅ 全部 | ✅ 全部 |
| **Recipe** | 保存 3 个 | 无限 |
| **导出** | CSV only | CSV/JSON/JSONL/Excel |
| **清洗历史** | 7 天 | 无限 |
| **Diff 审查** | ✅ | ✅ |
| **社区 Recipe** | ✅ 只读 | ✅ 可读可写 |

### 定价策略思考

| 考量 | 决策 |
|------|------|
| **为什么 $49 而不是 $29？** | 目标用户是公司报销的 ML 工程师，$49 在审批线以下，不需要审批 |
| **为什么按行数而不是按次？** | 行数直接对应价值（清洗 100 行和 100 万行的成本和价值都不同） |
| **Free tier 目的** | 让用户"上瘾"——免费额度刚好够体验完整流程，但不够日常使用 |
| **后续定价** | MVP 验证后加 $99/月的 Team 档 + 按量 API 计费 |

### 成本估算（单位经济）

| 项目 | Free 用户 | Pro 用户 |
|------|----------|----------|
| **AI API 成本** (Claude) | ~$0.02/次 × 3 次/天 = $1.8/月 | ~$0.02/次 × 30 次/月 = $0.6/月 |
| **计算成本** (Railway) | ~$0.5/月 | ~$2/月 |
| **存储成本** (R2) | ~$0.01/月 | ~$0.15/月 |
| **数据库** (Supabase) | ~$0 (shared) | ~$0.5/月 |
| **总成本/用户** | **~$2.3/月** | **~$3.25/月** |
| **收入** | $0 | $49/月 |
| **毛利率** | - | **93.4%** ✅ |

> Free 用户每月亏 $2.3，但他们是转化漏斗的顶部。假设 5% 转化率，获取 1 个 Pro 用户的成本 = $2.3 × 20 = $46，第一月即回本。

---

## 11. 上市策略 (GTM)

### 发布前 (Week 1-3)

| 渠道 | 动作 | 目标 |
|------|------|------|
| **Twitter/X** | 每天发 build in public 帖子，展示开发进度 | 积累 100+ 关注者 |
| **Reddit** | 在 r/MachineLearning, r/datascience 发讨论帖 | 收集早期反馈 |
| **GitHub** | 开源数据探测模块 (profiling engine) | 引流 + 建立信任 |
| **邮件列表** | Landing page 放 waitlist 注册 | 收集 200+ 邮箱 |

### 发布日 (Week 4)

| 渠道 | 动作 | 目标 |
|------|------|------|
| **Product Hunt** | 选周二/周三发布，准备 maker comment | Top 5 daily |
| **Hacker News** | Show HN 帖子 | Front page |
| **Reddit** | 同时在 3 个 subreddit 发 launch 帖 | 500+ upvotes |
| **Twitter/X** | Launch 推文 + 演示视频 | 100+ retweets |
| **微信公众号** | 中文介绍文章（覆盖国内用户） | 1000+ 阅读 |
| **V2EX** | 中文技术社区发布 | 首页 |

### 发布后 (持续)

| 策略 | 动作 | 目标 |
|------|------|------|
| **SEO** | 写 5 篇教程："How to clean training data for fine-tuning Llama 3" | 自然流量 |
| **内容营销** | YouTube/B站 教程视频 | 建立信任 |
| **社区** | 在 AI 社区活跃回答问题 | 口碑 |
| **集成** | 发布 HuggingFace Space / Colab 集成 | 降低使用门槛 |

### 关键增长杠杆

1. **"Cleaned with SmeltLab" 水印** — 免费用户导出的数据附带元数据标记，传播品牌
2. **社区 Recipe 市场** — 用户分享清洗配方，吸引新用户搜索特定场景
3. **开源 Profiler** — 开源数据探测模块，GitHub star 引流到 SaaS

---

## 12. 成功指标

### MVP 发布后 30 天目标

| 指标 | 目标 | 衡量方式 |
|------|------|---------|
| **注册用户** | 500 | Supabase Auth |
| **完成首次清洗的用户** | 200 (40% 激活率) | PostHog 事件 |
| **付费用户** | 10 (5% 转化率) | Stripe |
| **MRR** | $490 | Stripe Dashboard |
| **NPS** | > 40 | 用户调查 |
| **Product Hunt 排名** | Top 5 daily | Product Hunt |

### 北极星指标

**周活跃清洗任务数 (Weekly Active Clean Jobs)**
- 理由：反映产品核心价值（用户是否真的在用产品清洗数据）
- 比 DAU 更准确（一个用户可能一周只做一次大批量清洗）

### 关键漏斗

```
访问 Landing Page          100%
  │
  ▼
注册 (GitHub OAuth)         15%
  │
  ▼
上传数据                    60%  (of 注册)
  │
  ▼
执行首次清洗                80%  (of 上传)
  │
  ▼
查看 Diff & 导出            70%  (of 清洗)
  │
  ▼
7 天内回访                  30%  (of 导出)
  │
  ▼
付费转化                     5%  (of 注册)
```

### 要追踪的关键事件

```javascript
// PostHog 事件
"user_signed_up"
"project_created"
"dataset_uploaded"          // properties: { format, row_count, file_size }
"profile_viewed"            // properties: { health_score, issues_count }
"clean_job_started"         // properties: { type, operations_count }
"clean_job_completed"       // properties: { duration_ms, rows_before, rows_after, changes }
"diff_reviewed"             // properties: { accepted_pct, rejected_pct }
"data_exported"             // properties: { format }
"recipe_saved"
"recipe_applied"
"upgrade_to_pro"
```

---

## 13. 风险分析与应对

| # | 风险 | 概率 | 影响 | 应对策略 |
|---|------|------|------|---------|
| R1 | **LLM 成本超预期** — 清洗大数据集时 API 调用费用过高 | 高 | 高 | 混合模型策略：LLM 只分析 schema + 样本（~2K tokens），生成脚本后用 Polars 执行；设置单次清洗 token 上限 |
| R2 | **LLM 清洗出错** — AI 错误地修改或删除了有效数据 | 中 | 高 | Diff 审查机制 + 可回滚 + 不修改原始数据；沙盒执行 + 输出验证 |
| R3 | **数据安全风险** — 用户上传敏感数据（PII/商业机密） | 中 | 极高 | R2 加密存储 + 自动过期删除(7天) + 不用于训练 + 隐私政策 + SOC2 准备 |
| R4 | **竞品快速跟进** — Databricks/大厂加入类似功能 | 中 | 中 | 速度是护城河，先占 "AI-native data cleaning" 心智；社区 Recipe 生态 |
| R5 | **大文件处理性能差** — 100MB 文件处理超时/OOM | 中 | 中 | 流式处理 + 分块 + Celery 异步 + 进度条；MVP 限制 100MB |
| R6 | **付费转化率低于预期** — 用户用完免费额度就离开 | 中 | 中 | 优化 Free tier 限制 + Pro 价值感 + 邮件引导 + Recipe 锁定效应 |
| R7 | **4 周内完不成 MVP** | 高 | 中 | 严格砍需求：只做 CSV+JSON、只做英文 UI、不做移动端 |

### 数据安全承诺（写进产品）

```
🔒 SmeltLab Security Promise:
1. Your data is encrypted at rest (AES-256) and in transit (TLS 1.3)
2. Raw files are auto-deleted after 7 days (configurable)
3. We NEVER use your data to train AI models
4. LLM calls only send schema + samples, never full datasets
5. All cleaning runs in isolated sandboxes
6. SOC 2 Type II certification in progress
```

---

## 14. 四周时间线

### Week 1: 核心引擎 + 基础 UI

| 天 | 任务 | 交付 |
|----|------|------|
| D1 | 项目初始化：monorepo 搭建、CI/CD、Supabase/R2 配置 | 开发环境就绪 |
| D2 | 数据探测引擎 (Profiler)：CSV/JSON 解析 + schema 推断 + 问题检测 | Profiler API 可运行 |
| D3 | AI 清洗引擎 v1：LLM 意图理解 + 脚本生成 + 沙盒执行 | 清洗引擎可运行 |
| D4 | 预置清洗操作：去重 + PII 脱敏 + 格式标准化 | 3 个 preset 可用 |
| D5 | 前端：Landing page + Auth (GitHub OAuth) + Dashboard | 用户可登录 |
| D6-7 | 前端：上传组件 + Profile 报告页 + 清洗工作台基础版 | 端到端可跑通 |

### Week 2: 体验打磨

| 天 | 任务 | 交付 |
|----|------|------|
| D8 | Diff 引擎：逐行对比 + 变更统计 + 存储优化 | Diff API 可用 |
| D9 | 前端：Diff 审查页面 + 接受/拒绝交互 | Diff 页面完整 |
| D10 | 导出功能：CSV/JSON/JSONL/Excel + 下载 | 导出可用 |
| D11 | Recipe 系统：保存/加载/应用清洗配方 | Recipe CRUD |
| D12 | 清洗历史 + 回退功能 | 版本管理 |
| D13-14 | UI 打磨：Loading 状态、错误处理、空状态、Toast | 体验流畅 |

### Week 3: 商业化 + 稳定性

| 天 | 任务 | 交付 |
|----|------|------|
| D15 | Stripe 集成：订阅管理 + 用量计费 | 付费可运行 |
| D16 | 用量统计 Dashboard + 配额限制 | 用量系统 |
| D17 | 性能优化：大文件分块上传 + 异步处理 + 进度条 | 100MB 文件可处理 |
| D18 | 安全加固：Rate limiting、输入验证、CORS、加密 | 安全基线 |
| D19 | 邮件通知：注册欢迎、清洗完成、用量告警 | 邮件系统 |
| D20-21 | 全面测试 + Bug 修复 + 边界情况处理 | 稳定可用 |

### Week 4: 发布准备 + 上线

| 天 | 任务 | 交付 |
|----|------|------|
| D22 | Landing Page 优化：定价页、FAQ、演示视频 | 转化优化 |
| D23 | SEO 文章 ×3 + Open Source Profiler README | 内容准备 |
| D24 | Product Hunt 页面准备 + 截图 + 描述 | PH 准备 |
| D25 | 部署生产环境 + 域名 + SSL + 监控 | 生产环境就绪 |
| D26 | 邀请 10 个 beta 用户测试 + 收集反馈 | Beta 测试 |
| D27 | 根据反馈修复关键问题 | 最终修复 |
| D28 | **🚀 LAUNCH DAY** — Product Hunt + HN + Reddit + Twitter | 上线！ |

---

## 15. MVP 之后

### V1.1 (Month 2): 扩展数据源

- [ ] PDF 解析 (DocLing/Tesseract)
- [ ] Google Sheets 集成
- [ ] SQL 数据库直连 (PostgreSQL/MySQL)
- [ ] API 数据源 (REST/GraphQL)
- [ ] S3/GCS 文件导入

### V1.2 (Month 3): 团队协作

- [ ] 团队空间 + 邀请成员
- [ ] 共享项目和 Recipe
- [ ] 审批工作流（清洗 → 审查 → 批准 → 导出）
- [ ] 操作审计日志

### V1.3 (Month 4): 自动化管道

- [ ] 定时任务 (cron)
- [ ] Webhook 触发
- [ ] API 开放 (第三方集成)
- [ ] Zapier/Make 集成

### V2.0 (Month 6): 平台化

- [ ] Recipe 市场 (买卖)
- [ ] 插件系统 (自定义清洗操作)
- [ ] 私有部署 (Enterprise)
- [ ] SOC 2 Type II 认证
- [ ] 多语言 UI (中文/日文)

---

## 附录 A: 竞品对比矩阵

| 功能 | SmeltLab | Databricks | OpenRefine | Pandas (手写) | Trifacta |
|------|-----------|-----------|-----------|-------------|---------|
| AI 自然语言清洗 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 自动数据探测 | ✅ | ✅ | 部分 | ❌ | ✅ |
| Diff 对比审查 | ✅ | ❌ | ❌ | ❌ | 部分 |
| PII 智能检测 | ✅ | ❌ | ❌ | ❌ | 部分 |
| 可复用 Recipe | ✅ | ❌ | 部分 | ❌ | ✅ |
| 无需写代码 | ✅ | ❌ | ✅ | ❌ | ✅ |
| 价格 | $0-49/月 | $1000+/月 | 免费 | 免费 | $500+/月 |
| 上手时间 | 1 分钟 | 数天 | 30 分钟 | 需要会 Python | 数天 |

## 附录 B: 技术参考

- [Polars 文档](https://docs.pola.rs/)
- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [Claude API 文档](https://docs.anthropic.com/)
- [Microsoft Presidio](https://microsoft.github.io/presidio/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Supabase 文档](https://supabase.com/docs)

## 附录 C: 命名候选

| 名称 | 域名 | 含义 |
|------|------|------|
| **SmeltLab** | smeltlab.com | 直接、好记、Flickr 式命名 |
| **Cleandr** | cleandr.ai | 更短、更现代 |
| **Scrubbr** | scrubbr.dev | "scrub" = 清洗数据 |
| **TidyData** | tidydata.ai | 致敬 Tidy Data 论文 |
| **DataSpark** | dataspark.ai | 数据 + 火花 |

**推荐: SmeltLab** — 最直白地传达产品价值，利于 SEO。

---

> 📝 **文档维护**: 本文档随产品开发持续更新。每个 Sprint 结束时 review 一次。
