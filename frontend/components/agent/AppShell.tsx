'use client';

import type { ReactNode } from 'react';
import Sidebar from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  /** false 时由页面自己管理滚动（例如清洗工作台） */
  scroll?: boolean;
  activeConversationId?: string;
}

/** 全站统一外壳：左侧边栏 + 右侧内容区。 */
export function AppShell({ children, scroll = true, activeConversationId }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar activeConversationId={activeConversationId} />
      <main
        className={
          scroll ? 'min-w-0 flex-1 overflow-y-auto' : 'flex min-w-0 flex-1 flex-col overflow-hidden'
        }
      >
        {children}
      </main>
    </div>
  );
}

export default AppShell;
