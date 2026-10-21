/**
 * 体检问题的中文展示层。
 *
 * 后端 profiler 用英文模板生成问题文案，同时依赖这些关键字做分类，
 * 因此不改动后端，只在展示时按模板做一次翻译；未命中的文案原样返回。
 */

const ISSUE_RULES: [RegExp, (...m: string[]) => string][] = [
  [/^(.+?)% values are missing$/, (_, pct) => `缺失 ${pct}%`],
  [/^All values are identical \(constant column\)$/, () => '所有取值完全相同（常量列）'],
  [/^Very high cardinality — may be an ID field$/, () => '基数极高，可能是 ID 字段'],
  [/^~(\d+)% of values have invalid email format$/, (_, pct) => `约 ${pct}% 的取值不是合法邮箱`],
  [/^Mixed date formats detected: (.+)$/, (_, formats) => `检测到多种日期格式：${formats}`],
  [/^(\d+) outlier values \((.+?)%\)$/, (_, n, pct) => `${n} 个异常值（${pct}%）`],
  [/^(\d+) values with extra whitespace \((.+?)%\)$/, (_, n, pct) => `${n} 个取值含首尾空格（${pct}%）`],
  [/^Inconsistent label casing: (.+)$/, (_, detail) => `标签大小写不一致：${detail}`],
  [/^(\d+) duplicate rows \((.+?)%\)$/, (_, n, pct) => `${n} 行重复（${pct}%）`],
  [/^Dataset is empty$/, () => '数据集为空'],
];

const SUGGEST_RULES: [RegExp, (...m: string[]) => string][] = [
  [
    /^Fill missing values in '(.+)' using mean\/median\/mode or drop rows$/,
    (_, col) => `填充「${col}」的缺失值，或删除对应行`,
  ],
  [/^Remove exact and near-duplicate rows$/, () => '删除重复行'],
  [/^Remove duplicate rows$/, () => '删除重复行'],
  [/^Review and filter outlier values in '(.+)'$/, (_, col) => `检查并过滤「${col}」中的异常值`],
  [/^Standardize format for '(.+)' column$/, (_, col) => `统一「${col}」列的格式`],
  [/^Review consistency of '(.+)' values$/, (_, col) => `检查「${col}」的取值一致性`],
  [/^Review '(.+)' column$/, (_, col) => `检查「${col}」列`],
  [/^Upload a dataset with at least 1 row$/, () => '请上传至少包含 1 行数据的数据集'],
];

const CATEGORY_LABELS: Record<string, string> = {
  duplication: '重复',
  missing: '缺失',
  outlier: '异常值',
  format: '格式',
  consistency: '一致性',
  schema: '结构',
};

function apply(rules: [RegExp, (...m: string[]) => string][], text: string): string {
  for (const [pattern, render] of rules) {
    const match = pattern.exec(text);
    if (match) return render(...(match as unknown as string[]));
  }
  return text;
}

/** 提取问题所属列（后端把列名放在 `[col] ` 前缀里） */
export function issueColumn(message: string): string | null {
  const match = /^\[([^\]]+)\]\s/.exec(message || '');
  return match ? match[1] : null;
}

/** 把后端英文问题描述转成中文（去掉列名前缀，列名单独展示） */
export function tIssue(message: string): string {
  if (!message) return message;
  const body = (message || '').replace(/^\[[^\]]+\]\s*/, '').trim();
  return apply(ISSUE_RULES, body);
}

/** 把后端英文修复建议转成中文 */
export function tSuggestion(suggestion: string): string {
  if (!suggestion) return suggestion;
  return apply(SUGGEST_RULES, suggestion.trim());
}

/** 问题分类的中文名 */
export function tCategory(category: string): string {
  return CATEGORY_LABELS[category] || category;
}
