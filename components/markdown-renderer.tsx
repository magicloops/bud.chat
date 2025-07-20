'use client';

import React, { memo, useEffect } from 'react';
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
  return (
    <div className={`${className} break-words overflow-wrap-anywhere`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
        // Custom styling for different elements
          code: ({ node, className, children, ...props }: any) => {
            const inline = (props as any)?.inline;
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <pre className="bg-muted rounded-md p-1 overflow-x-auto my-2 w-0 min-w-full">
                <code className={`${className} block whitespace-pre`} {...props}>
                  {children}
                </code>
              </pre>
            ) : (
              <code
                className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono break-words"
                {...props}
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
            <h1 className="text-xl font-semibold mt-4 mb-2 first:mt-0 break-words">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-4 mb-2 first:mt-0 break-words">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-md font-semibold mt-3 mb-2 first:mt-0 break-words">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-6 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ ordered, className, children, ...rest }) => (
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
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 break-words">{children}</p>
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
