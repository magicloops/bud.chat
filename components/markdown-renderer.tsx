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
    return content
      // Convert box-drawing character lines to horizontal rules
      .replace(/^([─═━┅┄┉┈]{10,})$/gm, '\n---\n')
      // Handle section headers that might have box characters around them
      .replace(/^([─═━┅┄┉┈]+)\n(.+?)\n([─═━┅┄┉┈]+)$/gm, '\n---\n### $2\n---\n')
      // Convert numbered sections with box characters to proper headers
      .replace(/^(\d+)\.\s+(.+?)$/gm, (match, num, title) => {
        return `\n### ${num}. ${title}\n`;
      })
      // Preserve structured bullet points
      .replace(/^•\s+(.+)$/gm, '• $1')
      // Handle em-dash bullet points  
      .replace(/^[–—]\s+(.+)$/gm, '- $1')
      // Ensure proper spacing around sections
      .replace(/\n{3,}/g, '\n\n');
  }, [content]);

  return (
    <div className={`${className} break-words overflow-wrap-anywhere`}>
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
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold mt-6 mb-3 first:mt-0 break-words border-b border-muted-foreground/20 pb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-5 mb-3 first:mt-0 break-words border-b border-muted-foreground/10 pb-1">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-md font-semibold mt-4 mb-2 first:mt-0 break-words text-primary">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-6 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ className, children, ...rest }) => (
            // ordered is a boolean that React doesn't understand, so we drop it, 
            // but keep everything else - especially "start"
            <ol
              {...rest}
              className={`list-decimal list-outside ml-6 my-2 space-y-1 ${className || ''}`}
            >
              {children}
            </ol>
          ),
          li: ({ className, children, ...rest }) => (
            <li {...rest} className={`break-words ${className || ''}`}>
              {children}
            </li>
          ),
          p: ({ children }) => {
            // Check if this paragraph contains structured content (numbered sections, etc.)
            const textContent = children?.toString() || '';
            const isStructuredSection = /^\d+\.\s+/.test(textContent.trim());
            const isSubSection = /^[–—]\s+/.test(textContent.trim());
            
            if (isStructuredSection) {
              return <p className="mb-3 mt-4 break-words font-medium">{children}</p>;
            } else if (isSubSection) {
              return <p className="mb-1 ml-4 break-words">{children}</p>;
            }
            
            return <p className="mb-2 last:mb-0 break-words">{children}</p>;
          },
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