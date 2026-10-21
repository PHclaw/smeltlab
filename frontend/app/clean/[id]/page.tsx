import { redirect } from 'next/navigation';

/** 清洗工作台已并入对话，旧链接统一回首页重新开始 */
export default function CleanPage() {
  redirect('/');
}
