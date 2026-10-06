import Link from "next/link";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";

/**
 * Peças visuais do dashboard. Números e textos ficam sempre nas cores de texto (ink);
 * a cor de status aparece só no ícone, e sempre acompanhada de texto.
 */

export type Tom = "neutro" | "info" | "ok" | "atencao" | "critico";

const TOM_ICONE: Record<Tom, string> = {
  neutro: "bg-slate-100 text-slate-600",
  info: "bg-primary-50 text-primary-600",
  ok: "bg-success-50 text-success-600",
  atencao: "bg-amber-50 text-amber-600",
  critico: "bg-red-50 text-red-600",
};

export function Bloco({ titulo, icone: Icone, href, link = "Ver tudo", children, className, id }: {
  titulo: string; icone: LucideIcon; href?: string; link?: string; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section data-bloco={id} aria-labelledby={id ? `bloco-${id}` : undefined}
      className={cn("bg-white rounded-xl border border-surface-border shadow-card p-4 sm:p-5 flex flex-col min-w-0", className)}>
      <header className="flex items-center justify-between gap-3 mb-4">
        <h2 id={id ? `bloco-${id}` : undefined} className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icone className="w-4 h-4 text-ink-muted" aria-hidden /> {titulo}
        </h2>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 shrink-0">
            {link} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** Indicador: rótulo, número grande e uma linha de contexto. */
export function Kpi({ rotulo, valor, moeda, detalhe, href, tom = "neutro", icone: Icone }: {
  rotulo: string; valor: number; moeda?: boolean; detalhe?: string; href?: string; tom?: Tom; icone: LucideIcon;
}) {
  const corpo = (
    <div className="flex items-start justify-between gap-2 h-full">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted leading-tight">{rotulo}</p>
        <p className={cn("font-bold text-ink tracking-tight tabular-nums mt-1.5 whitespace-nowrap", moeda ? "text-xl lg:text-2xl" : "text-2xl sm:text-3xl")}>
          {moeda ? formatarMoeda(valor) : valor.toLocaleString("pt-BR")}
        </p>
        {detalhe && <p className="text-xs text-ink-subtle mt-0.5 leading-snug">{detalhe}</p>}
      </div>
      <span className={cn("p-2 rounded-lg shrink-0", TOM_ICONE[tom])}><Icone className="w-4 h-4" aria-hidden /></span>
    </div>
  );
  const cls = "block rounded-lg border border-surface-border bg-surface-alt/40 p-3 min-w-0";
  return href
    ? <Link href={href} className={cn(cls, "hover:border-primary-200 hover:bg-white transition-colors")}>{corpo}</Link>
    : <div className={cls}>{corpo}</div>;
}

/** `valores`: blocos com valores em R$ ficam em 1 coluna no celular, para o número caber inteiro. */
export function GradeKpi({ children, colunas = 4, valores }: { children: React.ReactNode; colunas?: 2 | 3 | 4; valores?: boolean }) {
  return (
    <div className={cn("grid gap-3", valores ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2", colunas === 3 && "lg:grid-cols-3", colunas === 4 && "lg:grid-cols-4")}>
      {children}
    </div>
  );
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted text-center py-6">{children}</p>;
}

export function BlocoComErro({ titulo, icone }: { titulo: string; icone: LucideIcon }) {
  return (
    <Bloco titulo={titulo} icone={icone}>
      <p className="text-sm text-ink-muted flex items-center gap-2 py-4">
        <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden /> Não foi possível carregar este bloco agora.
      </p>
    </Bloco>
  );
}

export { formatarMoeda };
