import { redirect } from 'next/navigation';

/** 数据清洗已改为对话内的 data-cleaner 技能，旧入口直接回首页 */
export default function UploadPage() {
  redirect('/');
}
