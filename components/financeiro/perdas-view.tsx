"use client";

import Link from "next/link";
import { ArrowLeft, TrendingDown, Receipt, Users } from "lucide-react";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { BarraPeriodo, CardResumo, GradeCards, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { Dica } from "@/components/ui/dica";

export interface LinhaPerda {
  id: string; numero: string; descricao: string; cliente: string; clienteId: string;
  valor: number; recebido: number; valorPerda: number;
  perdaEm: string | null; motivo: string | null; vencimento: string | null; por: string | null;
}
export interface ClientePerda { clienteId: string; nome: string; qtd: number; valor: number }

/** A cobrança na tela do Contas a Receber (gaveta), em qualquer período — a perda pode ser de um vencimento antigo */
const hrefCobranca = (id: string) => `/financeiro/contas-receber?conta=${id}&periodo=todos`;
const qtdCobrancas = (n: number) => `${n} ${n === 1 ? "cobrança" : "cobranças"}`;

/**
 * Relatório "Perdas por período e cliente": o que foi dado como perdido (inadimplência), pela data
 * em que a cobrança foi marcada como perda. Por cliente (quem mais deixou de pagar) e a lista.
 */
export function PerdasView({ periodo, total, clientes, linhas }: {
  periodo: PeriodoTela; total: { valor: number; qtd: number; clientes: number }; clientes: ClientePerda[]; linhas: LinhaPerda[];
}) {
  const { navegar } = useListagemUrl({ chave: "perdas", qAtual: "", lembrarFiltros: false });
  const vazio = linhas.length === 0;
  return (
    <div className="space-y-5" data-tela-perdas>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-atrasado-claro rounded-lg"><TrendingDown className="w-5 h-5 text-atrasado-texto" /></div>
          <h1 className="page-title">Perdas com clientes</h1>
          <Dica rotulo="Perdas" texto="Cobranças que a empresa deu como perdidas (o cliente não vai pagar). O que já tinha entrado continua recebido. Marque ou reverta pelo ⋮ do Contas a Receber." />
        </div>
        <Link href="/financeiro/contas-receber" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Contas a Receber</Link>
      </div>

      <BarraPeriodo periodo={periodo} navegar={navegar} permitirTodos dica="Pela data em que a cobrança foi marcada como perda." />
      <GradeCards colunas={4}>
        <CardResumo id="valor" rotulo="Perdido no período" icone={TrendingDown} cor="text-atrasado" v={total.valor} legenda={qtdCobrancas(total.qtd)} />
        <CardResumo id="maior-cliente" rotulo="Maior perda por cliente" icone={Users} cor="text-ink" v={clientes[0]?.valor ?? 0}
          legenda={total.clientes === 0 ? "nenhum cliente" : `${clientes[0]?.nome} · ${total.clientes} ${total.clientes === 1 ? "cliente" : "clientes"} no período`} />
      </GradeCards>

      {vazio ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center" data-lista-vazia>
          <Receipt className="w-6 h-6 text-ink-subtle" />
          <p className="text-sm font-medium text-ink">{periodo.tipo === "todos" ? "Nenhuma perda registrada" : `Nenhuma perda em ${periodo.tipo === "mes" ? periodo.rotulo.toLowerCase() : "o período"}`}</p>
          {periodo.tipo !== "todos" && (
            <button type="button" onClick={() => navegar({ mes: null, de: null, ate: null, periodo: "todos" })} className="text-sm text-primary-600 hover:underline" data-ver-todo-periodo>Ver todo o período</button>
          )}
        </div>
      ) : (
        <>
          {/* Por cliente: quem mais deixou de pagar */}
          <section className="card overflow-hidden" data-perdas-por-cliente>
            <h2 className="px-4 py-3 text-sm font-semibold text-ink border-b border-surface-border">Por cliente</h2>
            <ul className="md:hidden divide-y divide-surface-border">
              {clientes.map((c) => (
                <li key={c.clienteId} className="flex items-center justify-between gap-3 px-4 py-2.5" data-cliente-perda={c.clienteId}>
                  <div className="min-w-0"><p className="font-medium text-ink truncate">{c.nome}</p><p className="text-xs text-ink-muted">{qtdCobrancas(c.qtd)}</p></div>
                  <p className="font-bold text-atrasado-texto tabular-nums shrink-0">{formatarMoeda(c.valor)}</p>
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className={cn(PLANILHA.tabela, "table-fixed")}>
                <thead>
                  <tr className={PLANILHA.cabecalho}>
                    <th scope="col" className={cn(PLANILHA.th, "text-left")}>Cliente</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-right w-[8rem]")}>Cobranças</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-right w-[9rem]")}>Perdido (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => (
                    <tr key={c.clienteId} className={PLANILHA.linha} data-cliente-perda={c.clienteId}>
                      <td className={cn(PLANILHA.td, "font-medium text-ink truncate")}>{c.nome}</td>
                      <td className={cn(PLANILHA.td, PLANILHA.numero, "text-ink-muted")}>{c.qtd}</td>
                      <td className={cn(PLANILHA.td, PLANILHA.numero, "font-semibold text-ink")} data-valor-cliente>{valorSemMoeda(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink/15 bg-surface-alt/60">
                    <td className={cn(PLANILHA.td, "font-semibold text-ink")}>Total</td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "text-ink-muted")}>{total.qtd}</td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "font-bold text-ink")} data-total-perdas>{valorSemMoeda(total.valor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* As cobranças em perda */}
          <section className="card overflow-hidden" data-perdas-lista>
            <h2 className="px-4 py-3 text-sm font-semibold text-ink border-b border-surface-border">Cobranças em perda</h2>
            <ul className="md:hidden divide-y divide-surface-border">
              {linhas.map((l) => (
                <li key={l.id} data-linha-perda={l.id}>
                  <Link href={hrefCobranca(l.id)} className="block px-4 py-3 hover:bg-surface-alt">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ink truncate">{l.cliente}</p>
                      <p className="font-bold text-atrasado-texto tabular-nums shrink-0">{formatarMoeda(l.valorPerda)}</p>
                    </div>
                    <p className="text-xs text-ink-muted truncate">{l.numero} · {l.descricao}</p>
                    <p className="text-xs text-ink-subtle mt-0.5">
                      {l.perdaEm ? `Perda em ${formatarData(l.perdaEm)}` : "Perda"}{l.por ? ` por ${l.por}` : ""}
                      {l.recebido > 0 && ` · já recebido ${formatarMoeda(l.recebido)}`}
                    </p>
                    {l.motivo && <p className="text-xs text-ink mt-0.5 line-clamp-2">{l.motivo}</p>}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className={cn(PLANILHA.tabela, "table-fixed")}>
                <thead>
                  <tr className={PLANILHA.cabecalho}>
                    <th scope="col" className={cn(PLANILHA.th, "text-left w-[5.75rem]")}>Perda em</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-left w-[8.5rem] hidden lg:table-cell")}>Nº</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-left w-[20%]")}>Cliente</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-left")}>Motivo</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-left w-[8rem] hidden xl:table-cell")}>Quem marcou</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-right w-[7.5rem] hidden lg:table-cell")}>Já recebido (R$)</th>
                    <th scope="col" className={cn(PLANILHA.th, "text-right w-[7.5rem]")}>Perdido (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} className={cn(PLANILHA.linha, "hover:bg-primary-50/40")} data-linha-perda={l.id}>
                      <td className={cn(PLANILHA.td, "tabular-nums whitespace-nowrap text-ink-muted")}>{l.perdaEm ? formatarData(l.perdaEm) : "—"}</td>
                      <td className={cn(PLANILHA.td, "hidden lg:table-cell truncate font-mono text-[11px]")} title={l.numero}>
                        <Link href={hrefCobranca(l.id)} className="text-acento hover:underline" data-abrir-conta={l.id}>{l.numero}</Link>
                      </td>
                      <td className={cn(PLANILHA.td, "truncate")}>
                        <Link href={hrefCobranca(l.id)} className="font-medium text-ink hover:text-primary-600">{l.cliente}</Link>
                        <p className="text-[11px] text-ink-subtle truncate" title={l.descricao}>{l.descricao}</p>
                      </td>
                      <td className={cn(PLANILHA.td, "text-ink")}><span className="line-clamp-2" title={l.motivo ?? ""}>{l.motivo ?? "—"}</span></td>
                      <td className={cn(PLANILHA.td, "hidden xl:table-cell truncate text-ink-muted")}>{l.por ?? "—"}</td>
                      <td className={cn(PLANILHA.td, PLANILHA.numero, "hidden lg:table-cell text-ink-muted")}>{l.recebido > 0 ? valorSemMoeda(l.recebido) : "—"}</td>
                      <td className={cn(PLANILHA.td, PLANILHA.numero, "font-semibold text-ink")} data-valor-perda>{valorSemMoeda(l.valorPerda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total.qtd > linhas.length && <p className="px-4 py-2 text-xs text-ink-muted border-t border-surface-border">Mostrando as {linhas.length} mais recentes de {total.qtd}. Escolha um período menor para ver as outras.</p>}
          </section>
        </>
      )}
    </div>
  );
}
