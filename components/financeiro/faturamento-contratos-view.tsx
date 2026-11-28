"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, FileSignature, Hourglass, RotateCw } from "lucide-react";
import { cn, formatarMoeda, LABELS_STATUS_MEDICAO } from "@/lib/utils";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { BarraPeriodo, CardResumo, GradeCards, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { valorSemMoeda } from "@/lib/planilha";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { Dica } from "@/components/ui/dica";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/avisos";
import { ROTULO_ETAPA, ROTULO_SITUACAO } from "@/lib/faturamento/rotina-contratos";
import type { LinhaFaturamentoContrato, ResumoFaturamentoContratos } from "@/lib/faturamento/painel-contratos-server";

const TOM_SITUACAO: Record<string, TomStatus> = {
  PENDENTE: "previsto", AGUARDANDO: "atencao", PENDENCIA: "atrasado", FALHA: "atrasado-solido", CONCLUIDA: "ok", CANCELADA: "previsto",
};
const BOLETO: Record<string, string> = { EMITIDO: "Emitido", PAGO: "Pago", CANCELADO: "Cancelado", VENCIDO: "Vencido", PENDENTE: "Pendente" };
const hrefConta = (id: string) => `/financeiro/contas-receber?conta=${id}&periodo=todos`;

type Exec = NonNullable<LinhaFaturamentoContrato["execucao"]>;

/** A NFS-e da medição, com o link para a medição (onde ficam a nota, o PDF e o histórico) */
function Nf({ e }: { e: Exec }) {
  if (!e.nf || !e.medicao) return <span className="text-ink-subtle">—</span>;
  const texto = e.nf.situacao === "AUTORIZADA" || e.nf.situacao === "MANUAL" ? `nº ${e.nf.numero ?? "—"}` : e.nf.situacao === "PREFEITURA" ? "Na prefeitura" : "Não aceita";
  return (
    <Link href={`/financeiro/medicoes/${e.medicao.id}`} data-nf-situacao={e.nf.situacao}
      className={cn("hover:underline whitespace-nowrap", e.nf.situacao === "NAO_ACEITA" ? "text-atrasado-texto" : e.nf.situacao === "PREFEITURA" ? "text-atencao-texto" : "text-acento")}>
      {texto}
    </Link>
  );
}

/** O boleto de cada cobrança da medição (a conta, ou cada parcela), com o link para a conta */
function Boletos({ e }: { e: Exec }) {
  if (!e.cobrancas.length) return <span className="text-ink-subtle">—</span>;
  const varias = e.cobrancas.length > 1;
  return (
    <span className="flex flex-col">
      {e.cobrancas.map((c) => (
        <Link key={c.id} href={hrefConta(c.id)} data-boleto-conta={c.id} className={cn("hover:underline whitespace-nowrap", c.boleto ? "text-acento" : "text-ink-muted")}>
          {varias ? `${c.numero.split("/").pop()}: ` : ""}{c.boleto ? BOLETO[c.boleto] ?? c.boleto : "Sem boleto"}
        </Link>
      ))}
    </span>
  );
}
const retentavel = (s: string) => ["FALHA", "PENDENCIA"].includes(s);

/** As colunas da planilha (TabelaPro: largura, mostrar/esconder e ordem por usuário) */
const COLUNAS: ColunaPro[] = [
  { id: "cliente", titulo: "Cliente · contrato", obrigatoria: true, minimo: 200, classe: "truncate" },
  { id: "valor", titulo: "Cobrança (R$)", largura: 124, alinhar: "direita" },
  { id: "situacao", titulo: "Situação", largura: 180 },
  { id: "medicao", titulo: "Medição", largura: 150, classe: "truncate" },
  { id: "nf", titulo: "NF", largura: 120 },
  { id: "boleto", titulo: "Boleto", largura: 110 },
  { id: "erro", titulo: "Erro", largura: 240 },
];

/** "Medição · Aguardando" / "Na fila"… e o que esperar quando ainda não há execução */
function Situacao({ l }: { l: LinhaFaturamentoContrato }) {
  const e = l.execucao;
  if (!e) return <span className="text-ink-muted" data-previsto>{l.previsto ?? "—"}</span>;
  const fim = e.situacao === "CONCLUIDA" || e.situacao === "CANCELADA";
  return (
    <StatusPill tom={TOM_SITUACAO[e.situacao] ?? "previsto"} tamanho="sm" data-situacao={e.situacao}>
      {fim ? ROTULO_SITUACAO[e.situacao] : `${ROTULO_ETAPA[e.etapa] ?? e.etapa} · ${ROTULO_SITUACAO[e.situacao] ?? e.situacao}`}
    </StatusPill>
  );
}

function BotaoTentar({ id, ocupado, onTentar }: { id: string; ocupado: boolean; onTentar: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onTentar(id)} disabled={ocupado}
      className="inline-flex items-center gap-1 text-xs font-semibold text-acento hover:underline disabled:opacity-50" data-tentar={id}>
      <RotateCw className={cn("w-3.5 h-3.5", ocupado && "animate-spin")} /> Tentar de novo
    </button>
  );
}

/**
 * "Faturamento de contratos": uma linha por contrato com faturamento automático no mês escolhido —
 * em que etapa está, a medição, a NF, o boleto e o erro (com "Tentar de novo").
 */
export function FaturamentoContratosView({ periodo, linhas, resumo, soAtencao }: {
  periodo: PeriodoTela; linhas: LinhaFaturamentoContrato[]; resumo: ResumoFaturamentoContratos; soAtencao: boolean;
}) {
  const { navegar } = useListagemUrl({ chave: "faturamento-contratos", qAtual: "" });
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const visiveis = soAtencao ? linhas.filter((l) => l.execucao && retentavel(l.execucao.situacao)) : linhas;

  async function tentar(id: string) {
    setOcupado(id);
    try {
      const r = await fetch(`/api/faturamento-contratos/${id}/tentar`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível tentar de novo.", "erro"); return; }
      // Falhou de novo: volta para a fila (ou para FALHA/pendência) com o erro — mostra o erro
      const s = d.execucao?.situacao as string | undefined;
      if (d.execucao?.erro || (s && retentavel(s))) toast(d.execucao?.erro ?? "Ainda não deu certo.", "erro");
      else toast("Cobrança enviada.");
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); } finally { setOcupado(null); }
  }

  return (
    <div className="space-y-5" data-tela-faturamento-contratos>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><CalendarClock className="w-5 h-5 text-ink-muted" /></div>
          <h1 className="page-title">Faturamento de contratos</h1>
          <Dica rotulo="Faturamento de contratos" texto="Os contratos com “Faturamento automático” ligado. Todo dia de manhã a rotina cria a medição no dia de faturamento e segue para a aprovação. Se algo falhar, ela tenta de novo nos 2 dias seguintes e depois avisa no sino." />
        </div>
        <Link href="/financeiro/medicoes" className="text-sm text-ink-muted hover:text-ink">Ver medições</Link>
      </div>

      <BarraPeriodo rotulo="Competência" periodo={periodo} navegar={navegar} somenteMes dica="Pela competência: o mês de referência da cobrança." />
      <GradeCards colunas={4}>
        <CardResumo id="contratos" rotulo="Contratos automáticos" icone={FileSignature} cor="text-ink" v={resumo.contratos.v} q={resumo.contratos.q} unidade={["contrato", "contratos"]} />
        <CardResumo id="concluidas" rotulo="Concluídas" icone={CheckCircle2} cor="text-ok" v={resumo.concluidas.v} q={resumo.concluidas.q} unidade={["contrato", "contratos"]} />
        <CardResumo id="andamento" rotulo="Em andamento" icone={Hourglass} cor="text-atencao" v={resumo.andamento.v} q={resumo.andamento.q} unidade={["contrato", "contratos"]}
          dica="Na fila para a próxima rodada ou esperando alguém (o cliente aprovar, o pedido de compra)." />
        <CardResumo id="atencao" rotulo="Com pendência" icone={AlertTriangle} cor="text-atrasado" v={resumo.atencao.v} q={resumo.atencao.q} unidade={["contrato", "contratos"]}
          ativo={soAtencao} onClick={() => navegar({ atencao: soAtencao ? null : "1" })} />
      </GradeCards>

      {visiveis.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center" data-lista-vazia>
          <CalendarClock className="w-6 h-6 text-ink-subtle" />
          <p className="text-sm font-medium text-ink">{soAtencao ? "Nada parado neste mês" : "Nenhum contrato com faturamento automático"}</p>
          {!soAtencao && <p className="text-xs text-ink-muted max-w-sm">Ligue “Faturamento automático” no contrato (aba Contrato › Valores e faturamento).</p>}
        </div>
      ) : (
        <section className="card overflow-hidden" data-faturamento-lista>
          <TabelaPro
            tela="faturamento-contratos" colunas={COLUNAS}
            barra={<span data-contagem-faturamento>{visiveis.length === 1 ? "1 contrato" : `${visiveis.length} contratos`}</span>}
            cartoes={(
              <ul className="divide-y divide-surface-border">
                {visiveis.map((l) => {
                  const e = l.execucao;
                  return (
                    <li key={l.contratoId} className="px-4 py-3 space-y-1" data-linha-contrato={l.contratoId}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate">{l.cliente}</p>
                          <p className="text-xs text-ink-muted truncate">{l.contratoNumero} · {l.frequencia}</p>
                        </div>
                        <p className="font-bold text-ink tabular-nums shrink-0">{formatarMoeda(l.valor)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <Situacao l={l} />
                        {e?.medicao && <Link href={`/financeiro/medicoes/${e.medicao.id}`} className="text-acento hover:underline">{e.medicao.numero}</Link>}
                        {e?.nf && <span className="text-ink-muted" data-nf-cartao>NF <Nf e={e} /></span>}
                        {e && e.cobrancas.some((c) => c.boleto) && (
                          <span className="inline-flex flex-wrap gap-x-1 text-ink-muted" data-boleto-cartao>Boleto {e.cobrancas.filter((c) => c.boleto).map((c) => (
                            <Link key={c.id} href={hrefConta(c.id)} className="text-acento hover:underline">{BOLETO[c.boleto!] ?? c.boleto}</Link>
                          ))}</span>
                        )}
                      </div>
                      {e?.erro && <p className="text-xs text-atrasado-texto" data-erro>{e.erro}</p>}
                      {e && retentavel(e.situacao) && <BotaoTentar id={e.id} ocupado={ocupado === e.id} onTentar={tentar} />}
                    </li>
                  );
                })}
              </ul>
            )}
            linhas={visiveis.map((l) => {
              const e = l.execucao;
              return {
                id: l.contratoId, atributos: { "data-linha-contrato": l.contratoId }, titulos: { cliente: l.cliente, erro: e?.erro ?? undefined },
                celulas: {
                  cliente: (
                    <span className="block min-w-0">
                      <span className="block font-medium text-ink truncate">{l.cliente}</span>
                      <span className="block text-[11px] text-ink-subtle truncate">
                        <Link href={`/contratos/${l.contratoId}`} className="hover:underline">{l.contratoNumero}</Link> · {l.frequencia}{l.aprovacaoAutomatica ? " · aprova sozinho" : ""}
                      </span>
                    </span>
                  ),
                  valor: <span className="font-semibold text-ink" data-valor>{valorSemMoeda(l.valor)}</span>,
                  situacao: <Situacao l={l} />,
                  medicao: e?.medicao ? (
                    <span className="block min-w-0">
                      <Link href={`/financeiro/medicoes/${e.medicao.id}`} className="font-mono text-[11px] text-acento hover:underline" data-medicao={e.medicao.id}>{e.medicao.numero}</Link>
                      <span className="block text-[11px] text-ink-subtle truncate">{LABELS_STATUS_MEDICAO[e.medicao.status] ?? e.medicao.status}</span>
                    </span>
                  ) : "—",
                  nf: <span data-nf>{e ? <Nf e={e} /> : "—"}</span>,
                  boleto: <span data-boleto>{e ? <Boletos e={e} /> : "—"}</span>,
                  erro: (
                    <span className="block">
                      {e?.erro ? <span className="block text-atrasado-texto line-clamp-2" data-erro>{e.erro}</span> : <span className="text-ink-subtle">—</span>}
                      {e && e.tentativas > 0 && !retentavel(e.situacao) && <span className="block text-[11px] text-ink-subtle">{e.tentativas} de 3 tentativas</span>}
                      {e && retentavel(e.situacao) && <BotaoTentar id={e.id} ocupado={ocupado === e.id} onTentar={tentar} />}
                    </span>
                  ),
                },
              };
            })}
          />
        </section>
      )}
    </div>
  );
}
