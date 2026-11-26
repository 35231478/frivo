import Link from "next/link";
import { ChevronRight, Rocket } from "lucide-react";
import { HREF_IMPLANTACAO, type Progresso } from "@/lib/implantacao/etapas";

/**
 * Destaque da Implantação no painel, enquanto não chega a 100% (só para quem configura a empresa).
 * Uma faixa só, sem ocupar bloco: o quanto falta e a próxima etapa. Em 100%, some daqui.
 */
export function DestaqueImplantacao({ progresso }: { progresso: Progresso }) {
  return (
    <Link href={HREF_IMPLANTACAO} data-implantacao-destaque={progresso.pct}
      className="group flex items-center gap-3 rounded-card border border-primary-200 bg-primary-50/60 px-4 py-3 hover:border-primary-300 transition-colors">
      <span className="p-2 rounded-lg bg-white text-primary-600 shrink-0"><Rocket className="w-5 h-5" aria-hidden /></span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-semibold text-ink">Implantação: {progresso.feitas} de {progresso.total} etapas</span>
          <span className="text-xs text-ink-muted">Próxima: <strong className="text-ink">{progresso.proxima?.titulo}</strong></span>
        </span>
        <span className="block h-1.5 rounded-full bg-white overflow-hidden" aria-hidden>
          <span className="block h-full rounded-full bg-primary-500" style={{ width: `${progresso.pct}%` }} />
        </span>
      </span>
      <span className="text-sm font-bold tabular-nums text-primary-700 shrink-0">{progresso.pct}%</span>
      <ChevronRight className="w-4 h-4 text-primary-500 shrink-0" aria-hidden />
    </Link>
  );
}
