import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Dica } from "@/components/ui/dica";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Explicação da tela no ⓘ ao lado do título (Princípio 7) */
  dica?: ReactNode;
  backHref: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, dica, backHref, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div className="flex items-start gap-3">
        <Link
          href={backHref}
          aria-label="Voltar"
          data-voltar
          className="mt-1 p-2 rounded-lg text-ink-muted hover:text-acento hover:bg-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">
            {title}
            {dica && <Dica texto={dica} rotulo={title} className="ml-1.5" lado="direita" />}
          </h1>
          {description && <p className="text-sm text-ink-muted mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
