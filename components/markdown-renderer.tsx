'use client';

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// Import highlight.js CSS
import 'highlight.js/styles/github.css';

interface MarkdownRendererProps {
  content: string
  className?: string
}

const MarkdownRenderer = memo(function MarkdownRenderer({ 
  content, 
  className = 'text-sm' 
}: MarkdownRendererProps) {
  // Pre-process content to handle special formatting patterns
  const processedContent = React.useMemo(() => {
    let txt = content
      // Convert box-drawing character lines to horizontal rules
      .replace(/^([─═━┅┄┉┈]{10,})$/gm, '\n---\n')
      // Handle section headers that might have box characters around them
      .replace(/^([─═━┅┄┉┈]+)\n(.+?)\n([─═━┅┄┉┈]+)$/gm, '\n---\n### $2\n---\n')
      // Convert numbered sections with box characters to proper headers
      .replace(/^(\d+)\.\s+(.+?)$/gm, (match, num, title) => {
        return `\n### ${num}. ${title}\n`;
      })
      // A. / B. / C. -> sub-headers
      .replace(/^([A-Z])\.\s+/gm, '#### $1. ')
      // bullet "• something" -> "- something"
      .replace(/^•\s+/gm, '- ')
      // en-dash sub-items "– nested" -> "  - nested"
      .replace(/^[–—]\s+/gm, '  - ')
      // Ensure proper spacing around sections
      .replace(/\n{3,}/g, '\n\n');

      // NEW: convert 1‑3 leading spaces *inside* a paragraph line
      // to hard spaces so the parser keeps them.
      // • look for either BOM or newline, then 1‑3 plain spaces, then a non‑space char
      // • replace each plain space with \u00A0 (NBSP)
      txt = txt.replace(/(^|\n)( {1,3})(?=\S)/g, (_, brk, s) =>
        brk + '\u00A0'.repeat(s.length)
      );
      return txt;
  }, [content]);

  return (
    <div className={`prose prose-gray max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
        // Custom styling for different elements
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code: (props: any) => {
            const { node: _node, className, children, ...restProps } = props;
            const inline = (props as { inline?: boolean })?.inline;
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <pre className="bg-muted rounded-md p-1 overflow-x-auto my-2 w-0 min-w-full">
                <code className={`${className} block whitespace-pre`} {...restProps}>
                  {children}
                </code>
              </pre>
            ) : (
              <code
                className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono break-words"
                {...restProps}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <div className="relative">
              {children}
            </div>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-muted-foreground/20 pl-4 my-2 italic text-muted-foreground break-words">
              {children}
            </blockquote>
          ),
          // Let prose handle most styling, just override a few key elements
          h3: ({ children }) => (
            <h3 className="text-primary">{children}</h3>
          ),
          a: ({ href, children }) => (
            <a 
              href={href} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-muted">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-muted bg-muted/50 px-3 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-muted px-3 py-2">{children}</td>
          ),
          hr: () => (
            <hr className="my-4 border-t border-muted-foreground/20" />
          ),
          // Handle text nodes to preserve formatting
          text: ({ children }) => {
            const text = children as string;
            // If this is a line of special characters that wasn't caught by preprocessing
            if (typeof text === 'string' && /^[─═━┅┄┉┈•–—]+$/.test(text.trim())) {
              return <div className="my-2 text-muted-foreground font-mono text-xs">{text}</div>;
            }
            return <>{children}</>;
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
