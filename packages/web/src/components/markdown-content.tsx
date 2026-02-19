"use client";

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-6 text-lg font-semibold text-foreground first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 text-base font-semibold text-foreground first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="mb-3 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 list-disc pl-5 space-y-1 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal pl-5 space-y-1 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm">{children}</li>
          ),
          code: ({ className: codeClassName, node, children, ...props }) => {
            // Fenced code blocks are wrapped in <pre><code> by react-markdown
            const isBlock = node?.position && node.position.start.line !== node.position.end.line;
            const isInline = !codeClassName && !isBlock;
            if (isInline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-xs", codeClassName)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-sm border border-border bg-muted/50 p-3 font-mono text-xs last:mb-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground italic last:mb-0">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => {
            const safeHref = href && /^https?:\/\//i.test(href) ? href : undefined;
            if (!safeHref) return <span>{children}</span>;
            return (
              <a
                href={safeHref}
                className="text-primary underline underline-offset-2 hover:text-primary/80"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          hr: () => <hr className="my-4 border-border" />,
          img: () => <span className="text-xs text-muted-foreground">[image]</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
