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
  // When true, render with minimal pipeline (no remark/rehype plugins, simple code handling)
  light?: boolean
}

const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className = 'prose dark:prose-invert max-w-none text-sm sm:pr-[20px]',
  light = false,
}: MarkdownRendererProps) {
  // Pre-process content to handle special formatting patterns
  const processedContent = React.useMemo(() => {
    // Convert box-drawing character lines to horizontal rules
    return content.replace(/^([─═━┅┄┉┈]{10,})$/gm, '\n---\n');
  }, [content]);

  return (
    <div className={className}>
      <MemoizedReactMarkdown
        remarkPlugins={light ? [] : [remarkGfm, remarkMath]}
        rehypePlugins={light ? [] : [rehypeMathjax]}
        components={
          light
            ? {
                // Lightweight code handler: no highlighter
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                code({ inline, className, children, ...props }: any) {
                  const isBlock = !inline && /language-\w+/.test(className || '');
                  if (isBlock) {
                    return (
                      <pre className="text-xs whitespace-pre-wrap" {...props}>
                        {children}
                      </pre>
                    );
                  }
                  return (
                    <code className={`${className || ''} before:content-[''] after:content-['']`} {...props}>
                      {children}
                    </code>
                  );
                }
              }
            : {
                // Full renderer with code highlighter
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                pre({ children, ...props }: any) {
                  if (React.isValidElement(children)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const codeChild = children.props as any;
                    const hasLanguage = codeChild?.className && typeof codeChild.className === 'string' && /language-\w+/.test(codeChild.className);
                    if (hasLanguage) {
                      return <div className="p-0">{children}</div>;
                    }
                  }
                  return <pre {...props}>{children}</pre>;
                },
                table({ children }) {
                  return <table className="border-collapse border border-black px-3 py-1 dark:border-white">{children}</table>;
                },
                th({ children }) {
                  return (
                    <th className="break-words border border-black bg-[#9ca3af] px-3 py-1 text-white dark:border-white">{children}</th>
                  );
                },
                td({ children }) {
                  return <td className="break-words border border-black px-3 py-1 dark:border-white">{children}</td>;
                },
              }
        }
      >
        {processedContent}
      </MemoizedReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
