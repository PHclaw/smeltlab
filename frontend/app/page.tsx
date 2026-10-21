'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlignLeft,
  BarChart3,
  CircleDashed,
  Copy,
  ShieldCheck,
  Sparkles,
  Sprout,
} from 'lucide-react';
import AppShell from '@/components/agent/AppShell';
import Composer from '@/components/agent/Composer';
import {
  type AgentStatus,
  type Attachment,
  getAgentStatus,
  newConversationId,
  titleFrom,
  upsertConversation,
} from '@/lib/agent';
import { useAuth } from '@/lib/auth';

const QUICK_ACTIONS = [
  { label: '数据体检', icon: Activity, prompt: '帮我检查这个数据集的质量问题，给出健康报告和评分' },
  { label: '智能去重', icon: Copy, prompt: '删除数据中的重复行，并告诉我去掉了多少条' },
  { label: '缺失值处理', icon: CircleDashed, prompt: '分析缺失值分布，给出填充或删除的建议' },
  { label: '敏感信息脱敏', icon: ShieldCheck, prompt: '识别并脱敏邮箱、手机号、身份证号等敏感信息' },
  { label: '格式标准化', icon: AlignLeft, prompt: '统一日期与文本格式，修正大小写和空格问题' },
  { label: '数据增强', icon: Sprout, prompt: '为训练数据生成增强样本，提升模型的泛化能力' },
  { label: '训练模型', icon: BarChart3, prompt: '帮我用这份数据训练一个模型，先看一下数据结构并给出训练配置' },
];

export default function EntryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    getAgentStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  // 已在首页时再点「新建会话」：清空当前草稿
  useEffect(() => {
    const reset = () => {
      setInput('');
      setAttachments([]);
      setSessionId('');
    };
    window.addEventListener('smeltlab:new-session', reset);
    return () => window.removeEventListener('smeltlab:new-session', reset);
  }, []);

  /** 上传附件和发起对话都要会话 id，首次交互时惰性创建 */
  const ensureSessionId = () => {
    if (sessionId) return sessionId;
    const id = newConversationId();
    setSessionId(id);
    return id;
  };

  const handleSubmit = (text?: string, forcedSkill?: string) => {
    const message = (text ?? input).trim();
    if (!message) return;

    const id = sessionId || newConversationId();
    const now = Date.now();
    const activeSkill = forcedSkill;

    upsertConversation({
      id,
      title: titleFrom(message),
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: `${now}`,
          role: 'user',
          content: message,
          attachments,
          skill: activeSkill,
          createdAt: now,
        },
      ],
    });

    router.push(`/chat/${id}?autostart=1`);
  };

  return (
    <AppShell scroll={false}>
      <div className="relative flex h-full flex-col bg-white">
        {/* 顶部 */}
        <div className="flex h-14 items-center justify-center">
          <Link
            href="/landing#pricing"
            className="flex h-8 items-center gap-1.5 rounded-full bg-indigo-50 px-3.5 text-[12.5px] font-medium text-indigo-600 transition hover:bg-indigo-100"
          >
            <Sparkles size={13} />
            升级套餐
          </Link>
        </div>

        {/* 中部 */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <h1 className="select-none text-[52px] font-black leading-none tracking-[-0.035em] text-gray-900">
            SmeltLab
          </h1>
          <p className="mt-4 text-[13.5px] text-gray-400">
            {user ? `${user.name}，把脏数据交给对话` : '把脏数据交给对话'}
          </p>

          <div className="mt-9 w-full max-w-[720px]">
            <Composer
              variant="hero"
              value={input}
              onChange={setInput}
              onSubmit={() => handleSubmit()}
              getSessionId={ensureSessionId}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              placeholder="描述你想怎么处理数据，也可以把文件拖进来"
            />
          </div>

          {status && !status.available && (
            <p className="mt-3 text-[12px] text-amber-600">
              未检测到本地 pi 引擎，请先安装：npm install -g @earendil-works/pi-coding-agent
            </p>
          )}

          <div className="mt-6 flex max-w-[720px] flex-wrap items-center justify-center gap-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  setInput(action.prompt);
                  // 快捷入口统一走数据清洗技能
                  handleSubmit(action.prompt, 'data-cleaner');
                }}
                className="flex h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[12.5px] text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
              >
                <action.icon size={13} strokeWidth={1.8} className="text-gray-500" />
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-center pb-5">
          <Link
            href="/recipes"
            className="flex items-center gap-1.5 text-[12px] text-gray-400 transition hover:text-gray-600"
            title="去灵感库看看现成的清洗配方"
          >
            <Sparkles size={12} />
            探索灵感
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
