"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatarMoeda, formatarData } from "@/lib/utils";
import { Receipt, FileCheck } from "lucide-react";

const STATUS_MEDICAO: Record<string, string> = { RASCUNHO: "Rascunho", ENVIADA: "Enviada", APROVADA: "Aprovada" };
const COR_MEDICAO: Record<string, string> = { RASCUNHO: "bg-gray-100 text-gray-600", ENVIADA: "bg-blue-100 text-blue-700", APROVADA: "bg-green-100 text-green-700" };

export function OsFinanceiro({ osId, medicoes: iniciais, itensOrcamento }: { osId: string; medicoes: any[]; itensOrcamento: any[] }) {
  const [medicoes, setMedicoes] = useState(iniciais);
  const [gerando, setGerando] = useState(false);

  const totalOrcamento = itensOrcamento.reduce((acc: number, i: any) => acc + Number(i.valorTotal), 0);
  const totalExecutado = itensOrcamento.filter((i: any) => i.executado).reduce((acc: number, i: any) => acc + Number(i.valorTotal), 0);
  const totalMedido = medicoes.reduce((acc: number, m: any) => acc + Number(m.valorTotal), 0);

  async function gerarMedicao(final: boolean) {
    setGerando(true);
    try {
      const res = await fetch(`/api/ordens/${osId}/medicoes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final }),
      });
      if (res.ok) {
        const nova = await res.json();
        setMedicoes((p) => [...p, nova]);
      }
    } catch {} finally { setGerando(false); }
  }

  return (
    <div className="space-y-6">
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

      {/* Medições */}
      {medicoes.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Nenhuma medição gerada.</p>
      ) : (
        <div className="space-y-3">
          {medicoes.map((m: any) => (
            <div key={m.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-gray-900">Medição #{m.numero}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${COR_MEDICAO[m.status]}`}>
                    {STATUS_MEDICAO[m.status]}
                  </span>
                </div>
                <span className="text-sm font-bold text-gray-900">{formatarMoeda(Number(m.valorTotal))}</span>
              </div>
              <p className="text-xs text-gray-400">Data: {formatarData(m.dataMedicao)} — {m.itensFinanceiro.length} item(ns)</p>
            </div>
          ))}
        </div>
      )}

      {/* Ações */}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => gerarMedicao(false)} loading={gerando}>
          <Receipt className="w-4 h-4" /> Gerar medição parcial
        </Button>
        <Button type="button" onClick={() => gerarMedicao(true)} loading={gerando}>
          <FileCheck className="w-4 h-4" /> Gerar medição final
        </Button>
      </div>
    </div>
  );
}
