"use client";

import { ContasReceberVinculadas, type ContaVinculada } from "@/components/financeiro/contas-receber-vinculadas";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatarMoeda, formatarData, LABELS_STATUS_MEDICAO } from "@/lib/utils";
import { Receipt, ExternalLink } from "lucide-react";
import { NotasFiscais } from "@/components/fiscal/nfse-notas";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { BotaoFaturar, type FaturaExistente } from "@/components/faturamento/botao-faturar";
import { rotuloMedicao } from "@/lib/faturamento/fatura";

const COR_MEDICAO: Record<string, string> = {
  RASCUNHO: "bg-surface-linha text-ink-muted",
  AGUARDANDO_APROVACAO: "bg-acento-claro text-acento",
  AGUARDANDO_PC: "bg-atencao-claro text-atencao-texto",
  PC_RECEBIDO: "bg-ok-claro text-ok-texto",
  NF_EMITIDA: "bg-acento-claro text-acento",
  PAGO: "bg-ok-claro text-ok-texto",
  CANCELADA: "bg-atrasado-claro text-atrasado-texto",
};

interface MedicaoResumo { id: string; numero: string; status: string; valorTotal: unknown; criadoEm: string | Date; avulsa?: boolean | null }

/**
 * Aba Financeiro da OS. OS avulsa (sem contrato): "Faturar" — vira a fatura (medição avulsa já
 * liberada) e abre a emissão da NFS-e. OS de contrato: entra numa medição oficial ("Gerar medição").
 * A antiga "medição interna" (OsMedicao) saiu: nunca virava conta a receber.
 */
export function OsFinanceiro({ osId, temContrato, concluida, fatura, medicoes: iniciais, itensOrcamento, contasReceber = [], abrirNfse, onAbriuNfse }: {
  osId: string; temContrato?: boolean; medicoes: MedicaoResumo[]; itensOrcamento: any[];
  /** Faturar só com a OS concluída */
  concluida?: boolean;
  /** A fatura/medição viva que já cobre esta OS (nunca fatura de novo) */
  fatura?: FaturaExistente | null;
  /** Contas a receber da OS (medição ou orçamento ligado) — o outro lado do vínculo da conta */
  contasReceber?: ContaVinculada[];
  /** Botão "Emitir NFS-e" do cabeçalho: abre a emissão ao chegar na aba */
  abrirNfse?: boolean; onAbriuNfse?: () => void;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [medicoes] = useState(iniciais);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  const totalOrcamento = itensOrcamento.reduce((acc: number, i: any) => acc + Number(i.valorTotal), 0);
  const totalExecutado = itensOrcamento.filter((i: any) => i.executado).reduce((acc: number, i: any) => acc + Number(i.valorTotal), 0);
  const totalMedido = medicoes.filter((m) => m.status !== "CANCELADA").reduce((acc, m) => acc + Number(m.valorTotal), 0);

  async function gerarMedicao() {
    setErro(""); setGerando(true);
    try {
      const res = await fetch(`/api/ordens/${osId}/gerar-medicao`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data.erro ?? "Erro ao gerar a medição."); return; }
      router.push(`/financeiro/medicoes/${data.id}`);
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setGerando(false); }
  }

  return (
    <div className="space-y-6">
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{erro}</div>}

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-page rounded-lg p-3 text-center">
          <p className="text-xs text-ink-muted">Orçamento total</p>
          <p className="text-lg font-bold text-ink">{formatarMoeda(totalOrcamento)}</p>
        </div>
        <div className="bg-ok-claro rounded-lg p-3 text-center">
          <p className="text-xs text-ok">Executado</p>
          <p className="text-lg font-bold text-ok-texto">{formatarMoeda(totalExecutado)}</p>
        </div>
        <div className="bg-acento-claro rounded-lg p-3 text-center">
          <p className="text-xs text-acento">{temContrato ? "Medido" : "Faturado"}</p>
          <p className="text-lg font-bold text-acento">{formatarMoeda(totalMedido)}</p>
        </div>
      </div>

      {temContrato && (
        <p className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2">
          OS de contrato: a <strong>mensalidade</strong> é faturada pelo faturamento mensal do contrato
          (Medições &rsaquo; Gerar mês). Aqui saem só os itens executados e os adicionais marcados &ldquo;Cobrar&rdquo;.
        </p>
      )}

      {/* Medições oficiais em que a OS entrou */}
      {medicoes.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-6">{temContrato ? "Esta OS ainda não entrou em nenhuma medição." : "Esta OS ainda não foi faturada."}</p>
      ) : (
        <div className="space-y-3">
          {medicoes.map((m) => (
            <a key={m.id} href={m.avulsa ? `/financeiro/faturas/${m.id}` : `/financeiro/medicoes/${m.id}`} className="flex items-center justify-between border border-surface-border rounded-lg p-4 hover:border-primary-300 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <Receipt className="w-4 h-4 text-ink-muted shrink-0" />
                <span className="font-medium text-ink truncate">{rotuloMedicao(m)}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${COR_MEDICAO[m.status] ?? "bg-surface-linha text-ink-muted"}`}>
                  {LABELS_STATUS_MEDICAO?.[m.status as never] ?? m.status}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold text-ink">{formatarMoeda(Number(m.valorTotal))}</span>
                <ExternalLink className="w-3.5 h-3.5 text-ink-muted" />
              </div>
            </a>
          ))}
        </div>
      )}

      {contasReceber.length > 0 && (
        <div className="border-t border-surface-linha pt-5">
          <ContasReceberVinculadas contas={contasReceber} podeAbrir={pode("financeiro", "contasReceber")} />
        </div>
      )}

      {/* NFS-e: sai da medição da OS (a mesma trava de faturamento: uma medição viva por OS).
          Quem não vê medições nem o fiscal não vê as notas */}
      {(pode("financeiro", "fiscal") || pode("financeiro", "medicoes")) && (
        <div className="border-t border-surface-linha pt-5">
          <NotasFiscais osId={osId} origem="OS" avulsa={!temContrato} abrirEmissao={abrirNfse} onAbriu={onAbriuNfse} />
        </div>
      )}

      {/* Ação única: itens executados + adicionais "Cobrar" viram UMA fatura/medição (trava no servidor) */}
      {temContrato ? (
        <Button type="button" onClick={gerarMedicao} loading={gerando}>
          <Receipt className="w-4 h-4" /> Gerar medição (itens executados + adicionais)
        </Button>
      ) : fatura || (concluida && pode("financeiro", "medicoes")) ? (
        <div className="border-t border-surface-linha pt-5">
          <BotaoFaturar url={`/api/ordens/${osId}/faturar`} origem="OS" fatura={fatura ?? null}
            podeFaturar={!!concluida && pode("financeiro", "medicoes")} podeVer={pode("financeiro", "visualizar")} />
        </div>
      ) : pode("financeiro", "medicoes") && (
        <p className="text-xs text-ink-muted" data-faturar-depois>Conclua a OS para faturar.</p>
      )}
    </div>
  );
}
