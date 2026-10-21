'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  FileText,
  FolderClosed,
  Globe,
  Loader2,
  Monitor,
  Network,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { Attachment, uploadAttachment } from '@/lib/agent';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  streaming?: boolean;
  variant?: 'hero' | 'chat';
  placeholder?: string;
  /** 上传附件需要会话 id，由外层惰性创建 */
  getSessionId: () => string;
  attachments?: Attachment[];
  onAttachmentsChange?: (items: Attachment[]) => void;
  /** 关闭附件入口 */
  showAttach?: boolean;
  /** 是否显示「快速 / 进阶」 */
  showMode?: boolean;
}

const ATTACH_ACTIONS = [
  { key: 'file', label: '添加文件与图片', hint: '从电脑上传', icon: FileText, enabled: true },
  { key: 'cluster', label: '集群', hint: '批量处理一次完成更多', icon: Network, enabled: false },
  { key: 'web', label: '联网搜索', hint: '查找实时信息', icon: Globe, enabled: false },
];

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming = false,
  variant = 'chat',
  placeholder = '描述你想怎么处理数据，也可以把文件拖进来',
  getSessionId,
  attachments = [],
  onAttachmentsChange,
  showAttach = true,
  showMode = true,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'fast' | 'advanced'>('fast');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);

  // 高度自适应
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, variant === 'hero' ? 200 : 180)}px`;
  }, [value, variant]);

  const canSend = Boolean(value.trim()) && !streaming && !uploading;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      const sessionId = getSessionId();
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadAttachment(file, sessionId));
      }
      onAttachmentsChange?.([...attachments, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      setMenuOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (name: string) => {
    onAttachmentsChange?.(attachments.filter((a) => a.name !== name));
  };

  // ---------------------------------------------------------------- 拖拽上传
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    if (showAttach) handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full border bg-white shadow-[0_2px_20px_rgba(15,23,42,0.06)] transition ${
        variant === 'hero' ? 'rounded-[26px]' : 'rounded-[22px]'
      } ${dragging ? 'border-gray-900 ring-2 ring-gray-900/10' : 'border-gray-200'}`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[inherit] bg-white/85">
          <span className="flex items-center gap-2 text-[13px] font-medium text-gray-700">
            <Paperclip size={15} />
            松开即可上传文件
          </span>
        </div>
      )}
      {/* 附件 chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3.5">
          {attachments.map((item) => (
            <span
              key={item.name}
              className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-[12px] text-gray-700"
            >
              <FileText size={12} className="text-gray-500" />
              <span className="max-w-[180px] truncate">{item.name}</span>
              <button onClick={() => removeAttachment(item.name)} className="text-gray-400 hover:text-gray-700">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder}
        className={`w-full resize-none bg-transparent text-[15px] leading-7 text-gray-900 placeholder:text-gray-400 focus:outline-none ${
          variant === 'hero' ? 'px-5 pt-4 pb-2' : 'px-4 pt-3.5 pb-1'
        }`}
      />

      {/* 底部操作行 */}
      <div className={`flex items-center justify-between px-2.5 pb-2.5 ${variant === 'hero' ? 'pl-3.5' : 'pl-2.5'}`}>
        <div className="relative">
          {showAttach ? (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
              title="添加"
            >
              <Plus size={16} />
            </button>
          ) : (
            <span className="block w-8" />
          )}

          {menuOpen && (
            <div className="absolute bottom-11 left-0 z-20 w-64 overflow-hidden rounded-2xl border border-gray-100 bg-white p-1.5 shadow-xl">
              {ATTACH_ACTIONS.map((action) => (
                <button
                  key={action.key}
                  disabled={!action.enabled}
                  onClick={() => action.enabled && fileInputRef.current?.click()}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                    action.enabled ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-45'
                  }`}
                >
                  <action.icon size={16} className="shrink-0 text-gray-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-gray-800">{action.label}</span>
                    <span className="block truncate text-[11px] text-gray-400">{action.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="flex items-center gap-2">
          {showMode && (
            <div className="flex items-center gap-2 text-[12.5px]">
              <button
                onClick={() => setMode('fast')}
                className={mode === 'fast' ? 'text-gray-800' : 'text-gray-400 hover:text-gray-600'}
              >
                快速
              </button>
              <button
                onClick={() => setMode('advanced')}
                className={mode === 'advanced' ? 'text-gray-800' : 'text-gray-400 hover:text-gray-600'}
              >
                进阶
              </button>
            </div>
          )}

          {streaming && onStop ? (
            <button
              onClick={onStop}
              className="grid h-8 w-8 place-items-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700"
              title="停止生成"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => canSend && onSubmit()}
              disabled={!canSend}
              className={`grid h-8 w-8 place-items-center rounded-full transition ${
                canSend ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-200 text-white'
              }`}
              title={streaming ? '处理中' : '发送'}
            >
              {streaming ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* 进入页专属：项目 / 附件 / 客户端 */}
      {variant === 'hero' && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[12px] text-gray-500">
          <div className="flex items-center gap-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 transition hover:text-gray-800"
            >
              <FolderClosed size={13} />
              选择项目
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 transition hover:text-gray-800"
            >
              <Paperclip size={13} />
              附件
            </button>
          </div>
          <button className="flex items-center gap-1.5 transition hover:text-gray-800">
            <Monitor size={13} />
            使用客户端
          </button>
        </div>
      )}

      {(uploading || uploadError) && (
        <p className={`px-4 pb-2 text-[11.5px] ${uploadError ? 'text-red-500' : 'text-gray-400'}`}>
          {uploadError || '附件上传中…'}
        </p>
      )}
    </div>
  );
}

export default Composer;
