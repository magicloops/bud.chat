'use client';

import React, { FC, memo } from 'react';
import ReactMarkdown, { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeMathjax from 'rehype-mathjax';
import { CodeBlock } from '@/components/CodeBlock';

// Memoize ReactMarkdown for better performance
const MemoizedReactMarkdown: FC<Options> = memo(ReactMarkdown);

interface MarkdownRendererProps {
  content: string
  className?: string
}

const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className = 'prose dark:prose-invert max-w-none text-sm sm:pr-[20px]' 
}: MarkdownRendererProps) {
  // Pre-process content to handle special formatting patterns
  const processedContent = React.useMemo(() => {
    // Convert box-drawing character lines to horizontal rules
    return content.replace(/^([─═━┅┄┉┈]{10,})$/gm, '\n---\n');
  }, [content]);

  return (
    <div className={className}>
      <MemoizedReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeMathjax]}
        components={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');

          return !inline && match ? (
            <div className="mt-[1.25rem] mb-[1.25rem]">
              <CodeBlock
                key={Math.random()}
                language={(match && match[1]) || ''}
                value={String(children).replace(/\n$/, '')}
                {...props}
              />
            </div>
          ) : (
            <code className={`${className || ''} before:content-[''] after:content-['']`} {...props}>
              {children}
            </code>
          );
        },
        // Override pre to remove padding when it contains a CodeBlock
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pre({ children, ...props }: any) {
          // Check if children contains a CodeBlock (has language class)
          if (React.isValidElement(children)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const codeChild = children.props as any;
            const hasLanguage = codeChild?.className && typeof codeChild.className === 'string' && /language-\w+/.test(codeChild.className);
            
            if (hasLanguage) {
              // For code blocks with language, render without padding
              return <div className="p-0">{children}</div>;
            }
          }
          
          // For regular pre blocks without language
          return <pre {...props}>{children}</pre>;
        },
        table({ children }) {
          return (
            <table className="border-collapse border border-black px-3 py-1 dark:border-white">
              {children}
            </table>
          );
        },
        th({ children }) {
          return (
            <th className="break-words border border-black bg-[#9ca3af] px-3 py-1 text-white dark:border-white">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="break-words border border-black px-3 py-1 dark:border-white">
              {children}
            </td>
          );
        },
        }}
      >
        {processedContent}
      </MemoizedReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
