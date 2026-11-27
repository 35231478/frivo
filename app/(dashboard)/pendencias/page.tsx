import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { escopoDoSino } from "@/lib/alertas/sino";
import { contarSino } from "@/lib/alertas/sino-server";
import { painelDePendencias, totalDoPainel } from "@/lib/alertas/pendencias";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";
import { Card, CardTitulo } from "@/components/ui/card";
import { Dica } from "@/components/ui/dica";
import { COR_TOM, ICONE_PENDENCIA } from "@/components/alertas/icones-pendencia";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pendências" };

const AJUDA = "O que precisa de ação hoje, por área. Os números são os mesmos do sino e cada pessoa vê só o que a permissão dela libera. Um toque abre o registro, quando é um só, ou a lista já filtrada. As contas do dia aparecem só aqui, fora do número do sino.";

/** Painel de pendências do escritório: o que precisa de ação hoje (lib/alertas/pendencias). */
export default async function PendenciasPage() {
  const session = await auth();
  const u = session!.user!;
  const escopoTecnico = escopoDaSessao(session!);
  const escopo = escopoDoSino({ permissoes: u.permissoes, role: u.role, restrito: escopoTecnico.restrito });
  const contagem = await contarSino({ empresaId: u.empresaId, usuarioId: u.id!, escopo, filtroTecnico: filtroEscopo(escopoTecnico) });
  const areas = painelDePendencias(contagem, escopo);
  const total = totalDoPainel(areas);

  return (
    <div className="space-y-5" data-pendencias>
      <div>
        <h1 className="page-title flex items-center gap-1.5">Pendências de hoje <Dica texto={AJUDA} rotulo="Pendências de hoje" lado="direita" /></h1>
        <p className="page-subtitle">{total === 0 ? "Nada esperando ação." : total === 1 ? "1 item esperando ação." : `${total} itens esperando ação.`}</p>
      </div>

      {areas.length === 0 ? (
        <Card className="text-center py-10" data-pendencias-vazio>
          <CheckCircle2 className="w-8 h-8 text-ok mx-auto mb-2" aria-hidden />
          <p className="text-sm text-ink-muted">Nenhuma pendência hoje.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-start">
          {areas.map((a) => (
            <Card key={a.area} as="section" padded={false} data-area={a.area} aria-label={a.rotulo}>
              <CardTitulo className="px-5 pt-5 mb-2">{a.rotulo}</CardTitulo>
              <ul className="divide-y divide-surface-border">
                {a.itens.map((i) => {
                  const Icone = ICONE_PENDENCIA[i.icone];
                  return (
                    <li key={i.id}>
                      <Link href={i.href} data-pendencia={i.id}
                        className="flex items-center gap-3 px-5 py-3.5 min-h-[52px] hover:bg-surface-alt transition-colors">
                        <Icone className={cn("w-5 h-5 shrink-0", COR_TOM[i.tom])} aria-hidden />
                        <span className="flex-1 min-w-0 text-sm font-medium text-ink">{i.rotulo}</span>
                        <span className="font-display text-lg font-semibold tabular-nums text-ink">{i.valor}</span>
                        <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
