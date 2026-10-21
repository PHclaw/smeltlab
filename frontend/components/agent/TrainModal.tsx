'use client';

/**
 * 训练弹窗：不依赖 Agent 是否记得输出配置卡。
 * 选文件 → 选目标列 → 复用 TrainConfigCard 选模型/调参 → 训练 → 进度与结果。
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { getTrainDatasets, getTrainSchema, type TrainDataset, type TrainSchema } from '@/lib/api';
import TrainConfigCard from './TrainConfigCard';

export default function TrainModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const params = useParams<{ id: string }>();
  const sessionId = String(params?.id || '');

  const [files, setFiles] = useState<TrainDataset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [schema, setSchema] = useState<TrainSchema | null>(null);
  const [target, setTarget] = useState('');
  const [group, setGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    setError('');
    getTrainDatasets(sessionId)
      .then(setFiles)
      .catch((err) => setError(err instanceof Error ? err.message : '读取工作区失败'))
      .finally(() => setLoading(false));
  }, [open, sessionId]);

  const chooseFile = async (name: string) => {
    setSelected(name);
    setSchema(null);
    setLoading(true);
    setError('');
    try {
      const data = await getTrainSchema(sessionId, name);
      setSchema(data);
      setTarget(
        data.recommendation?.target ||
          data.target_candidates[0]?.name ||
          data.columns[0]?.name ||
          '',
      );
      setGroup(data.recommendation?.group || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取数据结构失败');
    } finally {
      setLoading(false);
    }
  };

  const startConfig = () => {
    if (!selected || !schema || !target) return;
    const rec = schema.recommendation;
    setSpec(
      JSON.stringify({
        file: selected,
        target,
        task: rec?.task || 'auto',
        rows: schema.rows,
        cols: schema.cols,
        group: group.trim() || null,
        drop: rec?.drop || [],
        recommended: {
          model: rec?.model || 'rf',
          test_size: rec?.test_size ?? 0.25,
        },
      }),
    );
  };

  const reset = () => {
    setSpec(null);
    setSchema(null);
    setSelected(null);
    setTarget('');
    setGroup('');
  };

  const close = () => {
    onClose();
    // 关闭后回到选文件状态，避免下次打开看到上一次的结果
    setTimeout(reset, 200);
  };

  const rec = schema?.recommendation;
  const taskLabel =
    rec?.task === 'regression' ? '回归' : rec?.task === 'classification' ? '二分类' : '自动判断';
  const targetSummary = rec?.target_stats
    ? `目标范围 ${rec.target_stats.min} ~ ${rec.target_stats.max}，均值 ${rec.target_stats.mean}`
    : '';
  const classSummary = rec?.class_counts
    ? Object.entries(rec.class_counts)
        .slice(0, 5)
        .map(([label, count]) => `${label} ${count}`)
        .join(' · ')
    : (rec?.classes || []).slice(0, 5).join(' · ');

  return (
    <Modal
      open={open}
      onClose={close}
      title="训练模型"
      description="选择工作区里的数据集与目标列，AI 会生成训练脚本并执行"
      widthClass="max-w-2xl"
    >
      <div className="max-h-[70vh] overflow-y-auto pr-0.5">
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            正在读取…
          </div>
        )}

        {!loading && !spec && (
          <>
            <p className="mb-2 text-[12px] text-gray-500">1. 选择数据集</p>
            {files.length === 0 ? (
              <p className="mb-4 rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-[12px] text-gray-400">
                这个会话里还没有数据文件，先上传或在对话里清洗一份数据
              </p>
            ) : (
              <div className="mb-4 space-y-1.5">
                {files.map((file) => (
                  <button
                    key={file.name}
                    onClick={() => chooseFile(file.name)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                      selected === file.name
                        ? 'border-gray-900 bg-gray-50'
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <FileText size={13} className="shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800">{file.name}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">
                      {file.format.toUpperCase()} ·{' '}
                      {file.size > 1024 * 1024
                        ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                        : `${Math.max(1, Math.round(file.size / 1024))} KB`}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {schema && (
              <div className="space-y-3">
                {rec && (
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] leading-5 text-gray-500">
                    <p className="text-gray-700">
                      推荐：目标列「{rec.target || '未识别，请手动填写'}」
                      {rec.group ? ` · 按「${rec.group}」分组切分` : ''}
                      {' · '}
                      {taskLabel}
                      {' · '}
                      {rec.model === 'lr' ? '逻辑回归' : '随机森林'}
                      {` · 测试集 ${Math.round(rec.test_size * 100)}%`}
                    </p>
                    {rec.task === 'classification' && classSummary && (
                      <p className="truncate" title={classSummary}>
                        类别分布：{classSummary}
                      </p>
                    )}
                    {rec.task === 'regression' && targetSummary && <p>{targetSummary}</p>}
                    {rec.drop.length > 0 && (
                      <p className="truncate" title={rec.drop.join('、')}>
                        建议剔除（疑似泄漏或无关）：{rec.drop.join('、')}
                      </p>
                    )}
                  </div>
                )}

                <p className="text-[12px] text-gray-500">2. 选择目标列（要预测的字段）</p>
                <div className="flex flex-wrap gap-1.5">
                  {schema.target_candidates.map((column) => (
                    <button
                      key={column.name}
                      onClick={() => setTarget(column.name)}
                      className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${
                        target === column.name
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                      title={column.top?.join(' / ') || ''}
                    >
                      {column.name}
                      <span
                        className={`ml-1 text-[10.5px] ${
                          target === column.name ? 'text-gray-400' : 'text-gray-400'
                        }`}
                      >
                        {column.unique} 类
                      </span>
                    </button>
                  ))}
                  {schema.target_candidates.length === 0 && (
                    <p className="text-[11.5px] text-amber-600">
                      没有低基数列，可能是纯回归数据；请在下拉里手动选择目标列
                    </p>
                  )}
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-gray-400">
                    目标列（也可以手动输入）
                  </span>
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="列名"
                    className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-[12.5px] text-gray-900 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-gray-400">
                    分组列（可选，同一患者/用户有多行时填写）
                  </span>
                  <input
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    placeholder="例如 患者编号"
                    className="h-8 w-full rounded-lg border border-gray-200 px-2.5 text-[12.5px] text-gray-900 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
                  />
                </label>

                <button
                  onClick={startConfig}
                  disabled={!target}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
                >
                  下一步：选择模型与参数
                </button>
              </div>
            )}
          </>
        )}

        {!loading && spec && (
          <div>
            <button
              onClick={reset}
              className="mb-2 flex items-center gap-1 text-[11.5px] text-gray-400 transition hover:text-gray-600"
            >
              <ArrowLeft size={12} />
              重新选择数据集
            </button>
            <TrainConfigCard spec={spec} />
          </div>
        )}
      </div>
    </Modal>
  );
}
