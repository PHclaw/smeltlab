# 贡献指南

感谢你愿意为 SmeltLab 出力！这个项目的目标是：**让机器学习工程师把洗数据的时间从几小时压到几分钟**。任何朝着这个目标的改进都欢迎。

## 提交 Issue

- **Bug**：请附上复现步骤、数据样本（可脱敏）、期望与实际结果。
- **需求**：请描述你最想让工具自动处理的脏数据场景，例如「日期列混了三种格式」「电话有空格和横杠」——真实场景比抽象描述更有价值。

## 提交 Pull Request

1. Fork 仓库并基于 `main` 创建分支：`feat/your-feature` 或 `fix/your-fix`。
2. 保持改动聚焦：一个 PR 只做一件事。
3. 提交前自查：
   - 后端：`cd backend && python -m compileall app`，新代码带类型注解；
   - 前端：`cd frontend && npm run lint`；
   - 新功能请附一段可复现的演示数据，或一段录屏。
4. 提交信息用动词开头，例如 `feat: 支持多分类训练`、`fix: 修复中文列名乱码`。

## 代码约定

- 后端：FastAPI + Pydantic，服务层放 `app/services/`，一个模块只做一件事；
- 清洗与建模必须用确定性代码（Polars / scikit-learn），**不要让 LLM 生成指标数字**；
- 面向用户的提示词、日志、进度描述统一用简体中文，结论先行；
- 新增工具步骤必须在界面上可见（阶段名 + 耗时），不接受黑箱执行。

## 本地开发

```bash
# 后端
cd backend && pip install -r requirements.txt && python -m uvicorn app.main:app --reload --port 8000

# 前端
cd frontend && npm install && npm run dev
```

演示数据在 `sample_data/dirty_patients.csv`，可直接拖进页面测试完整流程。

## 图片与品牌素材

README 头图与文章头图由 `docs/_banner.py` 生成，依赖 Pillow；字号字体路径写死在脚本顶部（`C:/Windows/Fonts/msyh.ttc`），非 Windows 环境需要先改掉：

```bash
pip install pillow
python docs/_banner.py
```

| 文件 | 用途 |
|---|---|
| `docs/banner-readme.png` | README 顶部头图 |
| `docs/banner-1280x640.png` | GitHub 社交预览图（Settings → General → Social preview 上传） |
| `docs/banner-900x383.png` | 公众号 / 知乎 / 掘金文章头图 |

改文案、换截图或换仓库地址后重跑脚本；仓库地址写在脚本 `footer` 参数的默认值里。
