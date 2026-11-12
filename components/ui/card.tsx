import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";
import { Dica } from "@/components/ui/dica";

/**
 * Card do sistema de design: superfície branca, borda discreta, raio 14px, sombra levíssima.
 * `as` deixa usar a tag certa (section/article) sem perder o estilo.
 */
export function Card({ as: Tag = "div", padded = true, className, children, ...props }: HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside";
  /** Respiro interno padrão (p-5). Desligue para cards com tabela/lista encostando na borda. */
  padded?: boolean;
}) {
  return (
    <Tag {...props} className={cn("bg-white rounded-card border border-surface-border shadow-card", padded && "p-5", className)}>
      {children}
    </Tag>
  );
}

/** Título de card: rótulo pequeno em caixa-alta (com ícone e ⓘ opcionais) e ação à direita. */
export function CardTitulo({ icone: Icone, children, acao, dica, className }: {
  icone?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  acao?: ReactNode;
  /** Explicação do bloco no ⓘ ao lado do título (Princípio 7) */
  dica?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 mb-4", className)}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
        {Icone && <Icone className="w-3.5 h-3.5 text-ink-subtle" />} {children}
        {dica && <Dica texto={dica} rotulo={typeof children === "string" ? children : undefined} lado="direita" />}
      </h3>
      {acao}
    </div>
  );
}
