"use client";

/**
 * Veículos › Checklist › Diário — o histórico do checklist obrigatório no app (o "porteiro"): por dia, cada
 * colaborador obrigado, o veículo, a situação (Feito, Com alertas, Não vai usar, Sem registro, Ainda não fez), a hora
 * do toque, se chegou depois (sem sinal) e o checklist (respostas e fotos) na mesma gaveta dos preenchidos.
 * Abrir o histórico dá ciência dos "não vai usar" (saem do sino).
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { InputData } from "@/components/ui/input-data";
import { Dica } from "@/components/ui/dica";
import { horaBR } from "@/lib/fuso";
import { ROTULO_SITUACAO_HISTORICO, hojeBR, somarDias, type LinhaHistorico, type SituacaoHistorico } from "@/lib/checklist-diario/regras";
import { PainelDoChecklist } from "@/components/veiculos/checklists-preenchidos";

const ESTILO: Record<SituacaoHistorico, { classe: string; Icone: typeof CheckCircle2 }> = {
  FEITO: { classe: "bg-ok-claro text-ok-texto", Icone: CheckCircle2 },
  COM_ALERTAS: { classe: "bg-atencao-claro text-atencao-texto", Icone: AlertTriangle },
  NAO_VAI_USAR: { classe: "bg-surface-alt text-ink-muted", Icone: CircleSlash },
  SEM_REGISTRO: { classe: "bg-atrasado-claro text-atrasado-texto", Icone: AlertTriangle },
  PENDENTE: { classe: "bg-surface-alt text-ink-muted", Icone: Clock },
};

const NAVEGACAO_DIARIO = ["aba"] as const;
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function Selo({ s }: { s: SituacaoHistorico }) {
  const { classe, Icone } = ESTILO[s];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", classe)} data-situacao-diario={s}>
      <Icone className="w-3.5 h-3.5" aria-hidden /> {ROTULO_SITUACAO_HISTORICO[s]}
    </span>
  );
}

/** Detalhe curto da linha: hora, enviado sem sinal, motivo do "não vai usar" e o rastro da troca */
function Detalhes({ l }: { l: LinhaHistorico }) {
  const r = l.registro;
  if (!r) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="flex flex-col gap-0.5 text-xs text-ink-muted">
      <span className="tabular-nums">{horaBR(r.feitoEm)}{r.enviadoOffline && <span className="ml-1.5 inline-flex items-center gap-0.5 text-atencao-texto" data-enviado-offline><WifiOff className="w-3 h-3" aria-hidden /> enviado sem sinal</span>}</span>
      {r.motivo && <span className="italic" data-motivo-diario>“{r.motivo}”</span>}
      {r.situacaoAnterior === "NAO_VAI_USAR" && r.situacao === "FEITO" && (
        <span data-troca-diario>Antes: “não vou usar”{r.trocadoEm ? ` · trocou às ${horaBR(r.trocadoEm)}` : ""}</span>
      )}
    </span>
  );
}

/** A planilha do diário (TabelaPro: largura, mostrar/esconder e ordem por usuário); no celular, cartões */
const COLUNAS_DIARIO: ColunaPro[] = [
  { id: "dia", titulo: "Dia", largura: 72, obrigatoria: true },
  { id: "colaborador", titulo: "Colaborador", minimo: 160, obrigatoria: true, classe: "truncate" },
  { id: "veiculo", titulo: "Veículo", largura: 112 },
  { id: "situacao", titulo: "Situação", largura: 150 },
  { id: "detalhes", titulo: "Detalhes", largura: 260 },
  { id: "acoes", titulo: "Checklist", fixa: true, semTitulo: true, largura: 110, alinhar: "direita", classe: "py-0.5" },
];
const DIA = /^\d{4}-\d{2}-\d{2}$/;
/** O período na URL (`de`/`ate`, filtro lembrado); sem ele, os últimos 7 dias */
export function periodoDiario(sp: { get(k: string): string | null }, hoje = hojeBR()): { de: string; ate: string } {
  const ate = DIA.test(sp.get("ate") ?? "") ? sp.get("ate")! : hoje;
  const de = DIA.test(sp.get("de") ?? "") ? sp.get("de")! : somarDias(ate, -6);
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

export function ChecklistDiario({ colaboradores }: { colaboradores: { id: string; nome: string }[] }) {
  // O período vai para a URL e volta pelos filtros lembrados (a mesma regra das outras listas); a `aba` é da tela
  const sp = useSearchParams();
  const { navegar } = useListagemUrl({ chave: "checklist-diario", qAtual: "", navegacao: NAVEGACAO_DIARIO });
  const { de, ate } = periodoDiario(sp);
  const setDe = (v: string) => navegar({ de: v, aba: "diario" });
  const setAte = (v: string) => navegar({ ate: v, aba: "diario" });
  const [dados, setDados] = useState<{ ativo: boolean; linhas: LinhaHistorico[] } | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<{ id: string; modo: "ver" | "editar" } | null>(null);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const r = await fetch(`/api/checklist-diario?de=${de}&ate=${ate}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErro(d?.erro ?? "Não foi possível carregar o histórico."); return; }
      setDados({ ativo: !!d.ativo, linhas: d.linhas ?? [] });
    } catch { setErro("Sem conexão. Tente de novo."); }
  }, [de, ate]);
  useEffect(() => { void carregar(); }, [carregar]);

  const linhas = dados?.linhas ?? [];
  return (
    <div className="space-y-3" data-checklist-diario>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-medium text-ink-muted">De <InputData value={de} onChange={(v) => v && setDe(v)} aria-label="De" /></label>
        <label className="space-y-1 text-xs font-medium text-ink-muted">Até <InputData value={ate} onChange={(v) => v && setAte(v)} aria-label="Até" /></label>
        <Dica rotulo="Checklist obrigatório no app" texto="Nos dias de checklist, quem tem veículo padrão só usa o app depois do checklist do veículo (ou de “Hoje não vou usar o veículo”). “Sem registro” = dia de checklist que passou sem nada; “enviado sem sinal” = feito no aparelho sem internet e enviado depois. Configure em Configurações › Checklists de veículo." />
      </div>
      {dados && !dados.ativo && (
        <p className="rounded-lg bg-surface-alt px-3 py-2 text-sm text-ink-muted" data-diario-desligado>O checklist obrigatório no app está desligado. Ligue em Configurações › Checklists de veículo.</p>
      )}
      {erro && <p role="alert" className="rounded-lg bg-atrasado-claro px-3 py-2 text-sm text-atrasado-texto">{erro}</p>}
      {dados && !linhas.length && <p className="py-8 text-center text-sm text-ink-muted" data-diario-vazio>Nada no período.</p>}
      {linhas.length > 0 && (
        <div className="rounded-card border border-surface-border bg-white overflow-hidden">
          <TabelaPro
            tela="checklist-diario" colunas={COLUNAS_DIARIO} atributos={{ "data-tabela-diario": true }}
            barra={<span data-contagem-diario>{linhas.length === 1 ? "1 registro" : `${linhas.length} registros`}</span>}
            cartoes={(
              <ul className="divide-y divide-surface-border" data-cartoes-diario>
                {linhas.map((l) => (
                  <li key={l.chave} className="flex items-start justify-between gap-3 px-3 py-2.5" data-linha-diario={l.situacao}>
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm text-ink"><span className="tabular-nums text-ink-muted">{diaCurto(l.dia)}</span> · {l.nome}</p>
                      <p className="font-mono text-xs text-ink-muted">{l.veiculo ?? "—"}</p>
                      <Detalhes l={l} />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Selo s={l.situacao} />
                      {l.registro?.checklistId && <button type="button" className="text-xs font-semibold text-acento" onClick={() => setAberto({ id: l.registro!.checklistId!, modo: "ver" })}>Ver checklist</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            linhas={linhas.map((l) => ({
              id: l.chave, atributos: { "data-linha-diario": l.situacao }, titulos: { colaborador: l.nome },
              celulas: {
                dia: <span className="tabular-nums">{diaCurto(l.dia)}</span>,
                colaborador: <span className="text-ink">{l.nome}</span>,
                veiculo: <span className="font-mono text-ink-muted">{l.veiculo ?? "—"}</span>,
                situacao: <Selo s={l.situacao} />,
                detalhes: <Detalhes l={l} />,
                acoes: l.registro?.checklistId
                  ? <button type="button" className="text-xs font-semibold text-acento hover:underline" onClick={() => setAberto({ id: l.registro!.checklistId!, modo: "ver" })} data-ver-checklist-diario>Ver checklist</button>
                  : null,
              },
            }))}
          />
        </div>
      )}
      <PainelDoChecklist aberto={aberto} colaboradores={colaboradores} podeEditar={false} onFechar={() => setAberto(null)} onEditar={() => {}} onSalvo={() => {}} />
    </div>
  );
}
