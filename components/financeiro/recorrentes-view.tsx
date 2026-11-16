"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Pause, Pencil, Play, Plus, Repeat, RefreshCw, SkipForward, Sigma } from "lucide-react";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { ItemMenu, MenuAcoes, SeparadorMenu } from "@/components/ui/menu-acoes";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { statusVisualPagar } from "@/lib/financeiro-status";
import { RegraRecorrenteForm } from "@/components/financeiro/regra-recorrente-form";
import {
  MSG_CONTA_PAGA, ROTULO_SITUACAO, resumoDaRegra, rotuloCompetencia, textoFrequencia,
  type SituacaoRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia";

const AJUDA = "A despesa que se repete: a regra é descrita uma vez (aluguel, internet, assinatura, salário) e o sistema abre uma conta a pagar por competência, cada uma independente — pagar, ajustar ou cancelar uma não mexe nas outras. Sem data para terminar, ele mantém uns 12 meses gerados à frente. Pausar e encerrar só tiram do caminho as ocorrências futuras em aberto: conta paga nunca muda.";

export interface RegraView {
  id: string;
  descricao: string;
  favorecido: { nome: string; tipo: "FORNECEDOR" | "COLABORADOR"; ativo: boolean; semCadastro: boolean };
  passoMeses: number;
  diaVencimento: number;
  ajusteDiaNaoUtil: string;
  valor: number;
  valorEstimado: boolean;
  inicioAno: number; inicioMes: number;
  fimAno: number | null; fimMes: number | null; ocorrencias: number | null;
  situacao: string;
  encerramentoMotivo: string | null;
  categoriaId: string | null; categoria: string | null;
  centroCusto: { id: string; nome: string; ativo: boolean } | null;
  fornecedorId: string | null; tecnicoId: string | null;
  formaPagamento: string | null;
  observacao: string | null;
  contas: number;
  proximoVencimento: string | null;
}
const CLASSE_SITUACAO: Record<SituacaoRecorrencia, string> = {
  ATIVA: "bg-ok-claro text-ok-texto",
  PAUSADA: "bg-atencao-claro text-atencao-texto",
  ENCERRADA: "bg-surface-alt text-ink-muted",
};

/** Lista das REGRAS de despesa recorrente (as contas geradas vivem em Contas a pagar). */
export function RecorrentesView({ regras, categorias, podeMexer, emAberto }: {
  regras: RegraView[];
  categorias: { id: string; nome: string; cor: string; ativo: boolean }[];
  podeMexer: boolean;
  emAberto: { v: number; q: number };
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<RegraView | null>(null);
  const [vendo, setVendo] = useState<RegraView | null>(null);
  const contagem = (s: SituacaoRecorrencia) => regras.filter((r) => r.situacao === s).length;

  /** Toda ação da regra passa por aqui: o servidor manda, e quando recusa a tela NÃO muda. */
  async function acao(r: RegraView, acao: "PAUSAR" | "RETOMAR" | "ENCERRAR" | "GERAR", motivo?: string) {
    try {
      const res = await fetch(`/api/contas-pagar/recorrencias/${r.id}/acao`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, motivo: motivo ?? null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d.erro ?? "Não foi possível concluir a ação.", "erro");
        return;
      }
      const d = await res.json().catch(() => ({}));
      const n = Number(d.canceladas ?? 0);
      const geradas = Number(d.contas ?? 0);
      if (acao === "PAUSAR") toast(n > 0 ? `Despesa pausada. ${n} ${n === 1 ? "ocorrência futura cancelada" : "ocorrências futuras canceladas"}.` : "Despesa pausada.");
      if (acao === "RETOMAR") toast(geradas > 0 ? `Despesa retomada. ${geradas} ${geradas === 1 ? "conta gerada" : "contas geradas"}.` : "Despesa retomada.");
      if (acao === "ENCERRAR") toast(n > 0 ? `Despesa encerrada. ${n} ${n === 1 ? "ocorrência futura cancelada" : "ocorrências futuras canceladas"}.` : "Despesa encerrada.");
      if (acao === "GERAR") toast(geradas > 0 ? `${geradas} ${geradas === 1 ? "conta gerada" : "contas geradas"}.` : "Nada a gerar: o horizonte já está completo.");
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); }
  }

  async function encerrar(r: RegraView) {
    const mensagem = [
      `Encerrar “${r.descricao}”?`,
      "A regra para de gerar e as ocorrências futuras ainda em aberto são canceladas.",
      "O histórico fica: nada é apagado, e o que já foi pago continua registrado.",
    ].join(" ");
    if (!(await confirmar({ mensagem, perigo: true, confirmarTexto: "Encerrar despesa", cancelarTexto: "Voltar" }))) return;
    await acao(r, "ENCERRAR");
  }

  const Vazio = () => (
    <div className="flex flex-col items-center gap-2 py-10 text-center" data-lista-vazia>
      <p className="text-sm font-medium text-ink">Nenhuma despesa recorrente cadastrada</p>
      <p className="text-sm text-ink-muted max-w-md">
        A despesa que volta todo mês nasce em <strong>Nova conta a pagar</strong>, marcando “Repetir (recorrente)”.
      </p>
      {podeMexer && (
        <Link href="/financeiro/contas-pagar/nova" className="text-sm text-primary-600 hover:underline" data-ir-nova-conta>Criar a primeira</Link>
      )}
    </div>
  );

  const menu = (r: RegraView) => {
    const encerrada = r.situacao === "ENCERRADA";
    return (
      <div className="flex items-center justify-end">
        <MenuAcoes rotulo={`Ações de ${r.descricao}`}>
          {(f) => (
            <>
              <ItemMenu icone={Repeat} onClick={() => { f(); setVendo(r); }} id="ocorrencias">Ver ocorrências</ItemMenu>
              {podeMexer && !encerrada && <ItemMenu icone={Pencil} onClick={() => { f(); setEditando(r); }} id="editar">Editar a regra</ItemMenu>}
              {podeMexer && r.situacao === "ATIVA" && <ItemMenu icone={RefreshCw} onClick={() => { f(); acao(r, "GERAR"); }} id="gerar">Gerar as contas que faltam</ItemMenu>}
              {podeMexer && r.situacao === "ATIVA" && <ItemMenu icone={Pause} onClick={() => { f(); acao(r, "PAUSAR"); }} id="pausar">Pausar</ItemMenu>}
              {podeMexer && r.situacao === "PAUSADA" && <ItemMenu icone={Play} onClick={() => { f(); acao(r, "RETOMAR"); }} id="retomar">Retomar</ItemMenu>}
              {podeMexer && !encerrada && (
                <>
                  <SeparadorMenu />
                  <ItemMenu icone={Ban} onClick={() => { f(); encerrar(r); }} perigo id="encerrar">Encerrar</ItemMenu>
                </>
              )}
            </>
          )}
        </MenuAcoes>
      </div>
    );
  };

  const selos = (r: RegraView) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full", CLASSE_SITUACAO[r.situacao as SituacaoRecorrencia] ?? CLASSE_SITUACAO.ENCERRADA)} data-situacao={r.situacao}>
        {ROTULO_SITUACAO[r.situacao as SituacaoRecorrencia] ?? r.situacao}
      </span>
      {r.valorEstimado && (
        <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-atencao-claro text-atencao-texto" title="O valor é estimado: ajuste cada conta quando o boleto chegar" data-selo-estimado>a confirmar</span>
      )}
    </span>
  );

  const barra = (
    <p className="text-sm text-ink-muted" data-barra-recorrentes>
      <strong className="text-ink">{contagem("ATIVA")}</strong> {contagem("ATIVA") === 1 ? "ativa" : "ativas"}
      {contagem("PAUSADA") > 0 && <> · {contagem("PAUSADA")} {contagem("PAUSADA") === 1 ? "pausada" : "pausadas"}</>}
      {contagem("ENCERRADA") > 0 && <> · {contagem("ENCERRADA")} {contagem("ENCERRADA") === 1 ? "encerrada" : "encerradas"}</>}
      <span className="mx-1 text-ink-subtle">·</span>
      Em aberto já gerado: <strong className="text-ink" data-em-aberto>{formatarMoeda(emAberto.v)}</strong>
      <span className="text-ink-subtle"> ({emAberto.q} {emAberto.q === 1 ? "conta" : "contas"})</span>
    </p>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><Repeat className="w-5 h-5 text-ink-muted" /></div>
          <h1 className="page-title flex items-center gap-1.5">
            Despesas recorrentes <Dica texto={AJUDA} rotulo="Despesas recorrentes" lado="direita" />
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/financeiro/contas-pagar" className="inline-flex items-center gap-2 bg-white border border-surface-border hover:border-primary-300 hover:bg-primary-50/40 text-ink px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm" data-ver-contas>
            Contas a pagar
          </Link>
          {/* Criar regra mexe em dinheiro: só quem tem Financeiro › fluxo de caixa */}
          {podeMexer && (
            <Link href="/financeiro/contas-pagar/nova" data-nova-recorrente className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" /> Nova despesa recorrente
            </Link>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Celular: um cartão por regra (a barra da tabela é só do desktop, então os números vêm aqui) */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes-recorrentes>
          <li className="px-4 py-2.5 bg-surface-alt/40">{barra}</li>
          {regras.length === 0 ? <li><Vazio /></li> : regras.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3" data-cartao-regra={r.id}>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink truncate">{r.descricao}</p>
                  <p className="font-bold text-ink shrink-0 tabular-nums">{formatarMoeda(r.valor)}</p>
                </div>
                <p className="text-xs text-ink-muted truncate">{r.favorecido.nome} · {textoFrequencia(r.passoMeses)}, dia {r.diaVencimento}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                  {selos(r)}
                  <span className="text-xs text-ink-subtle">
                    {r.proximoVencimento ? `Próxima ${formatarData(r.proximoVencimento)}` : "Nenhuma em aberto"}
                  </span>
                </div>
              </div>
              <div className="shrink-0 -mr-1">{menu(r)}</div>
            </li>
          ))}
        </ul>

        <div data-tabela-recorrentes>
          {regras.length === 0 ? <div className="hidden md:block"><Vazio /></div> : (
            <TabelaPro
              tela="contas-pagar-recorrentes"
              barra={barra}
              colunas={[
                { id: "descricao", titulo: "Despesa", obrigatoria: true },
                { id: "favorecido", titulo: "Favorecido", largura: 200, classe: "truncate" },
                { id: "frequencia", titulo: "Repetição", largura: 170 },
                { id: "proxima", titulo: "Próxima", largura: 104 },
                { id: "termino", titulo: "Termina", largura: 150, classe: "truncate" },
                { id: "categoria", titulo: "Categoria", largura: 144 },
                { id: "centro", titulo: "Centro de custo", largura: 128, classe: "truncate", oculta: true },
                { id: "contas", titulo: "Contas", alinhar: "direita", largura: 76 },
                { id: "situacao", titulo: "Situação", largura: 148 },
                { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, obrigatoria: true },
                { id: "acoes", titulo: "Ações", fixa: true, largura: 40, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
              ]}
              linhas={regras.map((r) => ({
                id: r.id,
                atributos: { "data-linha-regra": r.id },
                celulas: {
                  descricao: (
                    <button type="button" onClick={() => setVendo(r)} className={cn(PLANILHA.nome, "text-left text-primary-600 hover:underline truncate w-full")} title={r.descricao} data-abrir-regra={r.id}>
                      {r.descricao}
                    </button>
                  ),
                  favorecido: (
                    <p className={cn(PLANILHA.nome, "truncate")} title={r.favorecido.nome} data-favorecido={r.favorecido.tipo}>
                      {r.favorecido.nome}
                      {!r.favorecido.ativo && <span className="ml-1 text-[10px] font-semibold text-ink-muted">(inativo)</span>}
                    </p>
                  ),
                  frequencia: <span className={PLANILHA.apagado} data-frequencia>{textoFrequencia(r.passoMeses)}, dia {r.diaVencimento}</span>,
                  proxima: <span className={cn(PLANILHA.data, PLANILHA.apagado)} data-proxima>{r.proximoVencimento ? formatarData(r.proximoVencimento) : "—"}</span>,
                  termino: (
                    <span className={PLANILHA.apagado} data-termino>
                      {r.fimAno && r.fimMes ? rotuloCompetencia(r.fimAno, r.fimMes)
                        : r.ocorrencias ? `${r.ocorrencias} ${r.ocorrencias === 1 ? "ocorrência" : "ocorrências"}`
                        : "sem data"}
                    </span>
                  ),
                  categoria: <CategoriaBadge conta={r} categorias={categorias} linhaUnica />,
                  centro: r.centroCusto
                    ? <span className={PLANILHA.apagado} title={r.centroCusto.nome}>{r.centroCusto.nome}{!r.centroCusto.ativo && " (inativo)"}</span>
                    : <span className="text-ink-subtle">—</span>,
                  contas: <span className={cn(PLANILHA.numero, PLANILHA.apagado)} data-contas>{r.contas}</span>,
                  situacao: selos(r),
                  valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")} data-valor>{valorSemMoeda(r.valor)}</span>,
                  acoes: menu(r),
                },
              }))}
            />
          )}
        </div>
      </div>

      <Modal aberto={!!editando} onFechar={() => setEditando(null)} titulo={editando ? `Editar — ${editando.descricao}` : ""} tamanho="lg">
        {editando && (
          <RegraRecorrenteForm regra={editando}
            onPronto={() => { setEditando(null); router.refresh(); }} onCancelar={() => setEditando(null)} />
        )}
      </Modal>

      <Modal aberto={!!vendo} onFechar={() => setVendo(null)} titulo={vendo ? `Ocorrências — ${vendo.descricao}` : ""} tamanho="lg">
        {vendo && <Ocorrencias regra={vendo} podeMexer={podeMexer} onMudou={() => router.refresh()} />}
      </Modal>
    </div>
  );
}

/** As contas que a regra já abriu: é a prova do que a regra fez, e onde se pula um mês. */
function Ocorrencias({ regra, podeMexer, onMudou }: { regra: RegraView; podeMexer: boolean; onMudou: () => void }) {
  const [contas, setContas] = useState<any[] | null>(null);
  const [erro, setErro] = useState("");

  if (contas === null) {
    fetch(`/api/contas-pagar/recorrencias/${regra.id}`)
      .then((r) => r.json())
      .then((d) => setContas(Array.isArray(d?.contas) ? d.contas : []))
      .catch(() => setContas([]));
    return <p className="text-sm text-ink-subtle text-center py-6">Carregando…</p>;
  }

  async function pular(conta: any) {
    setErro("");
    const mensagem = [
      `Pular a ocorrência de ${rotuloCompetencia(conta.refAno, conta.refMes)}?`,
      `A conta ${conta.numero} fica no histórico como cancelada.`,
      "A despesa recorrente continua valendo: o mês seguinte nasce normalmente.",
    ].join(" ");
    if (!(await confirmar({ mensagem, perigo: true, confirmarTexto: "Pular esta ocorrência", cancelarTexto: "Voltar" }))) return;
    try {
      const res = await fetch(`/api/contas-pagar/${conta.id}/pular`, { method: "POST" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErro(d.erro ?? "Não foi possível pular a ocorrência."); return; }
      toast(`Ocorrência de ${rotuloCompetencia(conta.refAno, conta.refMes)} cancelada.`);
      setContas(null); onMudou();
    } catch { setErro("Erro de conexão."); }
  }

  return (
    <div className="space-y-3">
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{erro}</div>}
      <p className="text-sm text-ink-muted" data-resumo-regra>
        {resumoDaRegra(regra, formatarMoeda)}
        {regra.situacao === "ENCERRADA" && regra.encerramentoMotivo && <span className="block text-xs mt-1">Encerrada: {regra.encerramentoMotivo}</span>}
      </p>
      {contas.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-6" data-sem-ocorrencias>Nenhuma conta gerada ainda.</p>
      ) : (
        <ul className="divide-y divide-surface-border" data-lista-ocorrencias>
          {contas.map((c) => {
            const sv = statusVisualPagar(c.status, c.dataVencimento);
            const paga = Number(c.valorPago ?? 0) > 0 || c.status === "PAGO_TOTAL" || c.status === "PAGO_PARCIAL";
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5" data-ocorrencia={c.id}>
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <Link href={`/financeiro/contas-pagar/${c.id}`} className="font-semibold text-primary-600 hover:underline">{c.numero}</Link>
                    <span className="text-ink-muted"> · {rotuloCompetencia(c.refAno, c.refMes)}</span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {c.dataVencimento ? `Vence ${formatarData(c.dataVencimento)}` : "Sem vencimento"} · {formatarMoeda(Number(c.valorTotal))}
                    {c.valorEstimado && <span className="text-atencao-texto"> · a confirmar</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full", sv.classe)}>{sv.label}</span>
                  {podeMexer && !paga && c.status !== "CANCELADO" && (
                    <button type="button" onClick={() => pular(c)} title="Pular esta ocorrência" aria-label={`Pular a ocorrência ${c.numero}`}
                      className="p-1.5 rounded text-ink-muted hover:bg-surface-alt" data-pular={c.id}>
                      <SkipForward className="w-4 h-4" />
                    </button>
                  )}
                  {paga && <span className="text-[11px] text-ink-subtle max-w-[160px]" title={MSG_CONTA_PAGA}>não muda</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-ink-subtle flex items-start gap-1.5">
        <Sigma className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Cada conta é independente: pagar, ajustar o valor ou cancelar uma não mexe na regra nem nas outras.
      </p>
    </div>
  );
}
