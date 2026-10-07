// Rendu Markdown + LaTeX (KaTeX) de tous les contenus rédigés par l'IA ou l'étudiant.
import clsx from 'clsx';
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

/** Convertit les délimiteurs LaTeX \( \) et \[ \] en $ et $$ (souvent produits par les modèles). */
function normalizeMath(src: string): string {
  return src
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
}

/** Markdown avec formules ; une erreur de LaTeX n'empêche jamais l'affichage. */
export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}>
        {normalizeMath(children ?? '')}
      </ReactMarkdown>
    </div>
  );
});
