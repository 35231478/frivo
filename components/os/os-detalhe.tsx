"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, formatarData, formatarDataHora, formatarMoeda, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { OsAtividades } from "@/components/os/os-atividades";
import { OsOrcamento } from "@/components/os/os-orcamento";
import { OsFinanceiro } from "@/components/os/os-financeiro";
import { OsOrcamentosVinculados } from "@/components/os/os-orcamentos-vinculados";
import { OsPrazos } from "@/components/os/os-prazos";
import { OsRelatorios } from "@/components/os/os-relatorios";
import { ComprasSecao } from "@/components/compras/compras-secao";
import { ChevronLeft, FileText, Clock, User, Building2, MapPin, AlertTriangle, FileBarChart } from "lucide-react";
import Link from "next/link";

const COR_STATUS: Record<string, string> = {
  ABERTA: "bg-blue-100 text-blue-700", AGENDADA: "bg-purple-100 text-purple-700",
  EM_ANDAMENTO: "bg-yellow-100 text-yellow-700", PAUSADA: "bg-orange-100 text-orange-700",
  AGUARDANDO_PECA: "bg-amber-100 text-amber-700", CONCLUIDA: "bg-green-100 text-green-700",
  CANCELADA: "bg-red-100 text-red-700",
};
const COR_PRIORIDADE: Record<string, string> = {
  BAIXA: "bg-gray-100 text-gray-600", NORMAL: "bg-blue-100 text-blue-600",
  ALTA: "bg-orange-100 text-orange-600", URGENTE: "bg-red-100 text-red-700 font-semibold",
};

export function OsDetalhe({ os: initialOs }: { os: any }) {
  const router = useRouter();
  const [os, setOs] = useState(initialOs);
  const [salvando, setSalvando] = useState(false);
  const [gerandoMedicao, setGerandoMedicao] = useState(false);

  async function gerarMedicao() {
    setGerandoMedicao(true);
    try {
      const res = await fetch(`/api/ordens/${os.id}/gerar-medicao`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        router.push(`/financeiro/medicoes/${data.id}`);
      }
    } catch {} finally { setGerandoMedicao(false); }
  }

  async function alterarStatus(novoStatus: string) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/ordens/${os.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novoStatus }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setOs((prev: any) => ({ ...prev, ...atualizado }));
        router.refresh();
      }
    } catch {} finally { setSalvando(false); }
  }

  const tabs = [
    { id: "geral", label: "Geral" },
    { id: "atividades", label: "Atividades", badge: os.atividades.length },
    { id: "orcamentos", label: "Orçamentos", badge: os.orcamentos?.length ?? 0 },
    { id: "orcamento", label: "Itens da OS", badge: os.itensOrcamento.length },
    { id: "prazos", label: "Prazos" },
    { id: "compras", label: "Compras" },
    { id: "relatorios", label: "Relatórios" },
    { id: "financeiro", label: "Financeiro", badge: os.medicoes.length },
    { id: "formularios", label: "Formulários" },
    { id: "anexos", label: "Anexos", badge: os.anexos.length },
    { id: "historico", label: "Histórico", badge: os.historico.length },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/ordens" className="mt-0.5 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">{os.numero}</h1>
              <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium", COR_STATUS[os.status])}>
                {LABELS_STATUS_OS[os.status]}
              </span>
              <span className={cn("px-2 py-0.5 rounded-full text-xs", COR_PRIORIDADE[os.prioridade])}>
                {LABELS_PRIORIDADE[os.prioridade]}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{os.cliente.nomeFantasia ?? os.cliente.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {os.status === "CONCLUIDA" && (
            <Button variant="outline" onClick={gerarMedicao} loading={gerandoMedicao}>
              <FileBarChart className="w-4 h-4" /> Gerar medição
            </Button>
          )}
          <Select value={os.status} onChange={(e) => alterarStatus(e.target.value)} className="text-sm w-auto" disabled={salvando}>
            {Object.entries(LABELS_STATUS_OS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
          </Select>
        </div>
      </div>

      {/* Abas */}
      <div className="bg-white rounded-xl border border-gray-200">
        <Tabs tabs={tabs} defaultTab="geral">
          {(activeTab) => (
            <div className="p-5">
              {activeTab === "geral" && <TabGeral os={os} />}
              {activeTab === "atividades" && <OsAtividades osId={os.id} atividades={os.atividades} />}
              {activeTab === "orcamentos" && (
                <OsOrcamentosVinculados
                  osId={os.id}
                  clienteId={os.cliente.id}
                  vinculados={os.orcamentos ?? []}
                />
              )}
              {activeTab === "orcamento" && <OsOrcamento osId={os.id} itens={os.itensOrcamento} />}
              {activeTab === "prazos" && <OsPrazos osId={os.id} />}
              {activeTab === "compras" && <ComprasSecao ordemServicoId={os.id} />}
              {activeTab === "relatorios" && <OsRelatorios osId={os.id} />}
              {activeTab === "financeiro" && <OsFinanceiro osId={os.id} medicoes={os.medicoes} itensOrcamento={os.itensOrcamento} />}
              {activeTab === "formularios" && <TabFormularios atividades={os.atividades} />}
              {activeTab === "anexos" && <TabAnexos osId={os.id} anexos={os.anexos} />}
              {activeTab === "historico" && <TabHistorico historico={os.historico} />}
            </div>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function TabGeral({ os }: { os: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Informações</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Cliente:</span> <span className="font-medium">{os.cliente.nomeFantasia ?? os.cliente.nome}</span></div>
          {os.unidade && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Endereço:</span> <span>{os.unidade.nome}{os.unidade.cidade ? ` — ${os.unidade.cidade}/${os.unidade.estado}` : ""}</span></div>}
          {os.contrato && <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Contrato:</span> <span className="font-mono">{os.contrato.numero}</span></div>}
          {os.responsavel && <div className="flex items-center gap-2"><User className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Responsável:</span> <span>{os.responsavel.nome}</span></div>}
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Datas</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Abertura:</span> <span>{formatarDataHora(os.criadoEm)}</span></div>
          {os.previsaoConclusao && <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Previsão:</span> <span>{formatarData(os.previsaoConclusao)}</span></div>}
          {os.dataInicio && <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Início:</span> <span>{formatarDataHora(os.dataInicio)}</span></div>}
          {os.dataConclusao && <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /> <span className="text-gray-500">Conclusão:</span> <span>{formatarDataHora(os.dataConclusao)}</span></div>}
        </div>
      </div>
      <div className="col-span-full">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Descrição</h3>
        <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{os.descricao}</p>
      </div>
      {os.observacoes && (
        <div className="col-span-full">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Observações</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{os.observacoes}</p>
        </div>
      )}
    </div>
  );
}

function TabFormularios({ atividades }: { atividades: any[] }) {
  const comResumo = atividades.filter((a) => a.resumo);
  if (comResumo.length === 0) return <p className="text-sm text-gray-400 text-center py-8">Nenhum formulário respondido.</p>;

  return (
    <div className="space-y-4">
      {comResumo.map((a) => (
        <div key={a.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            {a.tipoOs && <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: a.tipoOs.cor }}>{a.tipoOs.nome}</span>}
            <span className="text-sm font-medium text-gray-900">{a.titulo}</span>
          </div>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 font-sans">{a.resumo}</pre>
        </div>
      ))}
    </div>
  );
}

function TabAnexos({ osId, anexos: iniciais }: { osId: string; anexos: any[] }) {
  const [anexos, setAnexos] = useState(iniciais);
  const [uploading, setUploading] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const res = await fetch(`/api/ordens/${osId}/anexos`, { method: "POST", body: fd });
      if (res.ok) { const novo = await res.json(); setAnexos((p) => [novo, ...p]); }
    } catch {} finally { setUploading(false); }
  }

  return (
    <div className="space-y-3">
      {anexos.map((a: any) => (
        <div key={a.id} className="flex items-center gap-3 p-2.5 border border-gray-200 rounded-lg">
          <FileText className="w-4 h-4 text-gray-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800 truncate">{a.nome}</p>
            <p className="text-xs text-gray-400">{(a.tamanho / 1024).toFixed(0)} KB — {formatarData(a.criadoEm)}</p>
          </div>
        </div>
      ))}
      <input type="file" id="os-anexo-input" onChange={upload} className="hidden" />
      <Button variant="secondary" onClick={() => document.getElementById("os-anexo-input")?.click()} loading={uploading} className="w-full justify-center border-dashed">
        Enviar anexo
      </Button>
    </div>
  );
}

function TabHistorico({ historico }: { historico: any[] }) {
  if (historico.length === 0) return <p className="text-sm text-gray-400 text-center py-8">Nenhum registro.</p>;

  return (
    <div className="relative ml-4 border-l-2 border-gray-200 space-y-0">
      {historico.map((h: any) => (
        <div key={h.id} className="relative pl-6 pb-4">
          <div className="absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full bg-gray-300" />
          <div className="text-xs text-gray-400">
            {formatarDataHora(h.criadoEm)} — {h.usuario.nome}
          </div>
          <p className="text-sm text-gray-700 font-medium">{h.acao}</p>
          {h.detalhes && <p className="text-xs text-gray-500">{h.detalhes}</p>}
        </div>
      ))}
    </div>
  );
}
