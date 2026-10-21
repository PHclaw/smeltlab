'use client';

import { Fragment, type ReactNode } from 'react';
import Chart from './Chart';
import TrainConfigCard from './TrainConfigCard';

/** 极简 Markdown 渲染：标题 / 列表 / 代码块 / 行内加粗与代码 / 链接。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-gray-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[13px] text-gray-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      nodes.push(
        <a
          key={key}
          href={m?.[2] || '#'}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-600 underline underline-offset-2"
        >
          {m?.[1]}
        </a>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const segments = (text || '').split(/```/);

  segments.forEach((segment, segIndex) => {
    // 奇数段是代码块
    if (segIndex % 2 === 1) {
      const firstBreak = segment.indexOf('\n');
      const info = (firstBreak >= 0 ? segment.slice(0, firstBreak) : '').trim().toLowerCase();
      const body = firstBreak >= 0 ? segment.slice(firstBreak + 1) : segment;

      // ```chart（或 chart json）渲染成图，不按代码块处理
      if (info.split(/\s+/)[0] === 'chart') {
        blocks.push(<Chart key={`chart-${segIndex}`} spec={body} />);
        return;
      }

      // ```train-config 渲染成可交互的训练配置卡
      if (info.split(/\s+/)[0] === 'train-config') {
        blocks.push(<TrainConfigCard key={`train-${segIndex}`} spec={body} />);
        return;
      }

      blocks.push(
        <pre
          key={`code-${segIndex}`}
          className="my-3 overflow-x-auto rounded-xl bg-gray-900 px-4 py-3 text-[12.5px] leading-6 text-gray-100"
        >
          <code className="font-mono whitespace-pre">{body.replace(/\n$/, '')}</code>
        </pre>,
      );
      return;
    }

    const lines = segment.split('\n');
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const content = paragraph.join(' ');
      blocks.push(
        <p key={`p-${segIndex}-${blocks.length}`} className="my-2 leading-7">
          {renderInline(content, `p-${segIndex}-${blocks.length}`)}
        </p>,
      );
      paragraph = [];
    };

    const flushList = () => {
      if (!list) return;
      const Tag = list.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag
          key={`l-${segIndex}-${blocks.length}`}
          className={`my-2 space-y-1 pl-5 leading-7 ${list.ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {list.items.map((item, idx) => (
            <li key={`${segIndex}-${idx}`}>{renderInline(item, `li-${segIndex}-${idx}`)}</li>
          ))}
        </Tag>,
      );
      list = null;
    };

    const splitRow = (line: string) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());

    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      const nextLine = (lines[i + 1] || '').trim();

      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      // 表格：表头行 + |---|---| 分隔行
      if (trimmed.startsWith('|') && /^\|[\s:|-]+\|?$/.test(nextLine) && nextLine.includes('-')) {
        flushParagraph();
        flushList();
        const header = splitRow(trimmed);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().startsWith('|')) {
          rows.push(splitRow(lines[j].trim()));
          j += 1;
        }
        const tableKey = `t-${segIndex}-${blocks.length}`;
        blocks.push(
          <div key={tableKey} className="my-3 overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  {header.map((cell, idx) => (
                    <th key={`${tableKey}-h-${idx}`} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      {renderInline(cell, `${tableKey}-h-${idx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={`${tableKey}-r-${rIdx}`} className="border-t border-gray-100">
                    {header.map((_, cIdx) => (
                      <td key={`${tableKey}-r-${rIdx}-${cIdx}`} className="px-3 py-2 align-top text-gray-600">
                        {renderInline(row[cIdx] || '', `${tableKey}-r-${rIdx}-${cIdx}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        i = j - 1;
        continue;
      }

      const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        const size = level === 1 ? 'text-[19px]' : level === 2 ? 'text-[17px]' : 'text-[15px]';
        blocks.push(
          <p key={`h-${segIndex}-${blocks.length}`} className={`mt-4 mb-1.5 font-semibold text-gray-900 ${size}`}>
            {renderInline(heading[2], `h-${segIndex}-${blocks.length}`)}
          </p>,
        );
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        flushParagraph();
        flushList();
        blocks.push(<hr key={`hr-${segIndex}-${blocks.length}`} className="my-4 border-gray-100" />);
        continue;
      }

      const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
      if (bullet) {
        flushParagraph();
        if (!list || list.ordered) {
          flushList();
          list = { ordered: false, items: [] };
        }
        list.items.push(bullet[1]);
        continue;
      }

      const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
      if (ordered) {
        flushParagraph();
        if (!list || !list.ordered) {
          flushList();
          list = { ordered: true, items: [] };
        }
        list.items.push(ordered[1]);
        continue;
      }

      flushList();
      paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
  });

  return <div className="text-[15px] text-gray-800">{blocks.length ? blocks : <Fragment />}</div>;
}

export default Markdown;
