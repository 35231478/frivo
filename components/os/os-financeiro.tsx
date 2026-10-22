"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatarMoeda, formatarData, LABELS_STATUS_MEDICAO } from "@/lib/utils";
import { Receipt, ExternalLink } from "lucide-react";

const COR_MEDICAO: Record<string, string> = {
  RASCUNHO: "bg-gray-100 text-gray-600",
  AGUARDANDO_APROVACAO: "bg-blue-100 text-blue-700",
  AGUARDANDO_PC: "bg-amber-100 text-amber-700",
  PC_RECEBIDO: "bg-violet-100 text-violet-700",
  NF_EMITIDA: "bg-cyan-100 text-cyan-700",
  PAGO: "bg-green-100 text-green-700",
  CANCELADA: "bg-red-100 text-red-600",
};

interface MedicaoResumo { id: string; numero: string; status: string; valorTotal: unknown; criadoEm: string | Date }

/**
 * Aba Financeiro da OS — fluxo ÚNICO: a OS entra numa medição oficial (que vira conta e boleto)
 * pelo botão abaixo. A antiga "medição interna" (OsMedicao) saiu: nunca virava conta a receber.
 */
export function OsFinanceiro({ osId, temContrato, medicoes: iniciais, itensOrcamento }: { osId: string; temContrato?: boolean; medicoes: MedicaoResumo[]; itensOrcamento: any[] }) {
  const router = useRouter();
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
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500">Orçamento total</p>
          <p className="text-lg font-bold text-gray-900">{formatarMoeda(totalOrcamento)}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <p className="text-xs text-green-600">Executado</p>
          <p className="text-lg font-bold text-green-700">{formatarMoeda(totalExecutado)}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <p className="text-xs text-blue-600">Medido</p>
          <p className="text-lg font-bold text-blue-700">{formatarMoeda(totalMedido)}</p>
        </div>
      </div>

      {temContrato && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          OS de contrato: a <strong>mensalidade</strong> é faturada pelo faturamento mensal do contrato
          (Medições &rsaquo; Gerar mês). Aqui saem só os itens executados e os adicionais marcados &ldquo;Cobrar&rdquo;.
        </p>
      )}

      {/* Medições oficiais em que a OS entrou */}
      {medicoes.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Esta OS ainda não entrou em nenhuma medição.</p>
      ) : (
        <div className="space-y-3">
          {medicoes.map((m) => (
            <a key={m.id} href={`/financeiro/medicoes/${m.id}`} className="flex items-center justify-between border border-gray-200 rounded-lg p-4 hover:border-primary-300 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <Receipt className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="font-medium text-gray-900 truncate">Medição {m.numero}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${COR_MEDICAO[m.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {LABELS_STATUS_MEDICAO?.[m.status as never] ?? m.status}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold text-gray-900">{formatarMoeda(Number(m.valorTotal))}</span>
                <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Ação única: itens executados + adicionais "Cobrar" viram UMA medição (trava no servidor) */}
      <Button type="button" onClick={gerarMedicao} loading={gerando}>
        <Receipt className="w-4 h-4" /> Gerar medição (itens executados + adicionais)
      </Button>
    </div>
  );
}
