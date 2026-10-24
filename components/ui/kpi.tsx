import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Número-chave (KPI): rótulo pequeno + valor em Archivo. Quando clicável é um <button> real
 * (vai para a aba/tela do número); o par rótulo/valor fica num <dl> semântico por fora.
 */
export function Kpi({ icone: Icone, rotulo, children, onClick, className, ...props }: {
  icone?: React.ComponentType<{ className?: string }>;
  rotulo: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick">) {
  const corpo = (
    <>
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {Icone && <Icone className="w-3.5 h-3.5 text-ink-subtle" />} {rotulo}
      </dt>
      <dd className="mt-1 font-display text-base sm:text-lg font-semibold tabular-nums text-ink truncate">{children}</dd>
    </>
  );
  const base = "text-left bg-white border border-surface-border rounded-card px-4 py-3 min-w-0 shadow-card";
  if (!onClick) return <div className={cn(base, className)}>{corpo}</div>;
  return (
    <button type="button" {...props} onClick={onClick}
      className={cn(base, "transition-colors hover:border-acento/40 hover:bg-acento-claro/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2", className)}>
      {corpo}
    </button>
  );
}
