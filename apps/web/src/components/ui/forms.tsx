// Champs de formulaire.
import clsx from 'clsx';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

/** Style commun des champs de saisie. */
export const inputClass =
  'w-full rounded border border-line-strong bg-page px-3 py-2 text-sm text-ink placeholder:text-ink-4 transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-blue-500/20';

/** Champ « en place » à la Notion : sans bordure tant qu'on ne le survole ou ne le sélectionne pas. */
export const inlineInputClass =
  'w-full rounded border border-transparent bg-transparent px-2 py-1 text-ink placeholder:text-ink-4 transition-colors hover:bg-hover focus:border-accent focus:bg-page focus:outline-none';

/** Champ texte. */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(inputClass, className)} />;
}

/** Zone de texte sur plusieurs lignes. */
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(inputClass, 'leading-6', className)} />;
}

/** Libellé au-dessus d'un champ, avec une aide optionnelle en dessous. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
