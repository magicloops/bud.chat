'use client';

import { FC, memo, useState } from 'react';
import { Check, Clipboard, Download } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { coldarkDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface Props {
  language: string;
  value: string;
}

// Language to file extension mapping
const programmingLanguages: Record<string, string> = {
  javascript: '.js',
  python: '.py',
  java: '.java',
  c: '.c',
  cpp: '.cpp',
  'c++': '.cpp',
  'c#': '.cs',
  ruby: '.rb',
  php: '.php',
  swift: '.swift',
  'objective-c': '.m',
  kotlin: '.kt',
  typescript: '.ts',
  go: '.go',
  perl: '.pl',
  rust: '.rs',
  scala: '.scala',
  haskell: '.hs',
  lua: '.lua',
  shell: '.sh',
  sql: '.sql',
  html: '.html',
  css: '.css',
};

const generateRandomString = (length: number, lowercase = false) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXY3456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return lowercase ? result.toLowerCase() : result;
};

export const CodeBlock: FC<Props> = memo(({ language, value }) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = () => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    });
  };

  const downloadAsFile = () => {
    const fileExtension = programmingLanguages[language] || '.file';
    const suggestedFileName = `file-${generateRandomString(3, true)}${fileExtension}`;
    const fileName = window.prompt('Enter file name', suggestedFileName);

    if (!fileName) {
      return;
    }

    const blob = new Blob([value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="codeblock relative font-sans text-[16px] w-full max-w-full"
      style={{ borderRadius: '0.375rem', overflow: 'hidden' }}
    >
      <div className="flex items-center justify-between py-1.5 px-4 bg-[#282c34]">
        <span className="text-xs lowercase text-white">{language}</span>

        <div className="flex items-center">
          <button
            className="flex gap-1.5 items-center rounded bg-none p-1 text-xs text-white"
            onClick={copyToClipboard}
          >
            {isCopied ? (
              <Check size={18} />
            ) : (
              <Clipboard size={18} />
            )}
            {isCopied ? 'Copied!' : 'Copy code'}
          </button>
          <button
            className="flex items-center rounded bg-none p-1 text-xs text-white"
            title="Download code"
            onClick={downloadAsFile}
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      <SyntaxHighlighter
        language={language}
        style={coldarkDark}
        wrapLongLines={true}
        customStyle={{
          margin: 0,
          backgroundColor: '#16161d',
          borderRadius: 0,
          width: '100%',
          maxWidth: '100%',
          overflowX: 'auto',
          boxSizing: 'border-box',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}
        codeTagProps={{
          style: {
            display: 'block',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          },
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';
