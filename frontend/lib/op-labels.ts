/** 清洗操作码 -> 中文名（后端返回的是 dedup / pii_mask 这类标识） */
export const OP_LABELS: Record<string, string> = {
  dedup: '删除重复行',
  pii_mask: '敏感信息脱敏',
  date_standardize: '日期标准化',
  outlier: '异常值处理',
  missing: '缺失值处理',
  text_clean: '文本清洗',
  label_normalize: '标签归一',
  llm_validate: '模型校验',
  sample: '智能采样',
  chunk: '切分数据集',
  augment: '数据增强',
  type_cast: '类型转换',
};

export function opLabel(operation: string): string {
  return OP_LABELS[operation] || operation;
}
