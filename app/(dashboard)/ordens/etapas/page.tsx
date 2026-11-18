import type { Metadata } from "next";
import { acento } from "@/lib/ui/tokens";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ConteudoUrl, FiltroSelectUrl, ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { Dica } from "@/components/ui/dica";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { marcarPrazosVencidos } from "@/lib/prazo-server";
import {
  cn, formatarDataHora, LABELS_STATUS_OS_PRAZO, LABELS_RESPONSAVEL_PRAZO, LABELS_STATUS_PRAZO_ETAPA,
} from "@/lib/utils";
import { Timer, AlertTriangle, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Etapas com prazo" };

const PESO_STATUS: Record<string, number> = { ATRASADO: 0, ATIVO: 1, CONCLUIDO: 2, CANCELADO: 3 };

/** Princípio 7: a explicação da tela sai do corpo e vira o ⓘ do título. */
const AJUDA = "Acompanhamento das etapas com prazo adicionadas às OS (compra de peça, aprovação…), da mais urgente para a menos: atrasadas primeiro, depois pela data limite da etapa atual. Os modelos de etapas ficam em Configurações › Etapas com prazo; para ver as OS com o prazo vencido, use o filtro Prazo da lista de OS.";

export default async function EtapasComPrazoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { status = "", templateId = "" } = sp;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  await marcarPrazosVencidos(empresaId);

  const where: any = { ordemServico: { empresaId } };
  if (status) where.status = status;
  if (templateId) where.templateId = templateId;

  // UX-4 (Y5): a ordenação é por URGÊNCIA (calculada): busca o filtro inteiro (com teto alto),
  // ordena e PAGINA em memória — a página some só quando o filtro passar do teto, não aos 300
  const TETO_PRAZOS = 2000;
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const [total, prazos, templates] = await Promise.all([
    prisma.osPrazo.count({ where }),
    prisma.osPrazo.findMany({
      where,
      include: {
        etapas: { orderBy: { ordem: "asc" } },
        template: { select: { cor: true } },
        ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      },
      orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
      take: TETO_PRAZOS,
    }),
    prisma.prazoTemplate.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  // Ordena por urgência: atrasados primeiro, depois por limite da etapa atual
  const enriquecidos = prazos.map((p) => {
    const atual = p.etapas.find((e) => e.ordem === p.etapaAtual) ?? p.etapas[p.etapas.length - 1];
    return { p, atual, limite: atual?.prazoLimite ? new Date(atual.prazoLimite).getTime() : Infinity };
  });
  enriquecidos.sort((a, b) => {
    const sa = PESO_STATUS[a.p.status] ?? 9;
    const sb = PESO_STATUS[b.p.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.limite - b.limite;
  });
  const totalPaginavel = Math.min(total, TETO_PRAZOS);
  const pagina = paginaValida(paginaPedida, porPagina, totalPaginavel);
  const { skip, take } = janela(pagina, porPagina);
  const paginaDePrazos = enriquecidos.slice(skip, skip + take);

  return (
    <ListaUrl chave="prazos" paramBusca="q" qAtual="">
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-surface-alt rounded-lg"><Timer className="w-5 h-5 text-ink-muted" aria-hidden /></div>
        <h1 className="page-title flex items-center gap-1.5">Etapas com prazo <Dica texto={AJUDA} rotulo="Etapas com prazo" lado="direita" /></h1>
        <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
      </div>

      <div className="card overflow-hidden">
        {/* Filtros do padrão da casa: mudam a URL na hora (sem botão "Filtrar") */}
        <div className="p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
          <FiltroSelectUrl param="status" vazio="Todos os status" rotulo="Filtrar por status"
            opcoes={Object.entries(LABELS_STATUS_OS_PRAZO).map(([value, label]) => ({ value, label }))} />
          <FiltroSelectUrl param="templateId" vazio="Todos os modelos" rotulo="Filtrar por modelo de etapas"
            opcoes={templates.map((t) => ({ value: t.id, label: t.nome }))} />
        </div>

        <ConteudoUrl>
        {paginaDePrazos.length === 0 ? (
          <ListaVazia mensagem="Nenhuma etapa com prazo encontrada" />
        ) : (
          <div className="divide-y divide-surface-border">
            {paginaDePrazos.map(({ p, atual }) => {
              const atrasado = p.status === "ATRASADO";
              return (
                <Link key={p.id} href={`/ordens/${p.ordemServico.id}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3 hover:bg-primary-50/40 transition-colors gap-1.5 sm:gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.template?.cor ?? acento.DEFAULT }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        <span className="font-mono text-primary-600">{p.ordemServico.numero}</span> · {p.nome}
                      </p>
                      <p className="text-xs text-ink-muted truncate">
                        {p.ordemServico.cliente.nomeFantasia ?? p.ordemServico.cliente.nome}
                        {atual && ` · Etapa atual: ${atual.nome} (${LABELS_RESPONSAVEL_PRAZO[atual.responsavel]})`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 pl-6 sm:pl-0">
                    {atual && (
                      <span className={cn("text-xs flex items-center gap-1", atrasado ? "text-atrasado-texto font-semibold" : "text-ink-muted")}>
                        {atrasado ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                        {formatarDataHora(atual.prazoLimite)}
                      </span>
                    )}
                    <span className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full",
                      p.status === "CONCLUIDO" ? "bg-success-50 text-success-700" :
                      atrasado ? "bg-atrasado-claro text-atrasado-texto" :
                      p.status === "CANCELADO" ? "bg-surface-linha text-ink-muted" : "bg-primary-50 text-primary-700",
                    )}>{LABELS_STATUS_OS_PRAZO[p.status]}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40">
          <PaginacaoUrl total={totalPaginavel} pagina={pagina} porPagina={porPagina} rotulo="registros" />
        </div>
      </div>
    </div>
    </ListaUrl>
  );
}
