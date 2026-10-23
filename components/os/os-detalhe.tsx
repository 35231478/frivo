"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { OsAtividades } from "@/components/os/os-atividades";
import { OsOrcamento } from "@/components/os/os-orcamento";
import { OsFinanceiro } from "@/components/os/os-financeiro";
import { OsOrcamentosVinculados } from "@/components/os/os-orcamentos-vinculados";
import { OsPrazos } from "@/components/os/os-prazos";
import { OsRelatorios } from "@/components/os/os-relatorios";
import { ComprasSecao } from "@/components/compras/compras-secao";
import { OsInativarBotao } from "@/components/os/os-inativar";
import { OsAnexos } from "@/components/os/os-anexos";
import { OsAdicionais } from "@/components/os/os-adicionais";
import { CabecalhoOs } from "@/components/os/central/cabecalho-os";
import { ResumoOs } from "@/components/os/central/resumo-os";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { centralDaOs } from "@/lib/os/central";
import { AlertTriangle, FileBarChart } from "lucide-react";

/** As 6 abas da central (antes 11). As antigas continuam abrindo pelo link: viram a aba que as absorveu. */
export const ABAS_OS = ["resumo", "atividades", "comercial", "materiais", "financeiro", "relatorios"] as const;
export type AbaOs = (typeof ABAS_OS)[number];
const ABA_ANTIGA: Record<string, AbaOs> = {
  geral: "resumo", historico: "resumo",
  prazos: "atividades", formularios: "atividades",
  orcamentos: "comercial", orcamento: "comercial",
  compras: "materiais",
  anexos: "relatorios",
};
export function abaValida(aba: string | null | undefined): AbaOs {
  if (!aba) return "resumo";
  if ((ABAS_OS as readonly string[]).includes(aba)) return aba as AbaOs;
  return ABA_ANTIGA[aba] ?? "resumo";
}

export function OsDetalhe({ os: initialOs, abaInicial }: { os: any; abaInicial?: string }) {
  const router = useRouter();
  const [os, setOs] = useState(initialOs);
  const [aba, setAba] = useState<AbaOs>(abaValida(abaInicial));
  const [gerandoMedicao, setGerandoMedicao] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const { pode } = usePermissoes();
  const central = useMemo(() => centralDaOs(os), [os]);

  function irPara(id: string) {
    const nova = abaValida(id);
    setAba(nova);
    // A aba fica no link (dá para mandar "?aba=financeiro" para alguém) sem recarregar a página
    try { window.history.replaceState(null, "", nova === "resumo" ? window.location.pathname : `?aba=${nova}`); } catch { /* sem history */ }
  }

  async function gerarMedicao() {
    setGerandoMedicao(true); setErroAcao("");
    try {
      const res = await fetch(`/api/ordens/${os.id}/gerar-medicao`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) router.push(`/financeiro/medicoes/${data.id}`);
      else setErroAcao(data.erro ?? "Não foi possível gerar a medição.");
    } catch { setErroAcao("Erro de conexão."); } finally { setGerandoMedicao(false); }
  }

  const tabs = [
    { id: "resumo", label: "Resumo", badge: central.falta.length },
    { id: "atividades", label: "Atividades", badge: central.atividades.total },
    { id: "comercial", label: "Comercial", badge: (os.orcamentos?.length ?? 0) + os.itensOrcamento.length },
    { id: "materiais", label: "Materiais & Compras" },
    { id: "financeiro", label: "Financeiro", badge: os.medicoes.length },
    { id: "relatorios", label: "Relatórios & Anexos", badge: os.anexos.length },
  ];

  const acoes = (
    <>
      {os.status === "CONCLUIDA" && pode("financeiro", "medicoes") && (
        <Button variant="outline" onClick={gerarMedicao} loading={gerandoMedicao}>
          <FileBarChart className="w-4 h-4" /> Gerar medição
        </Button>
      )}
      <OsInativarBotao
        osId={os.id} numero={os.chamadoNumero ?? os.numero} status={os.status}
        onAlterado={(novo) => setOs((prev: any) => ({ ...prev, status: novo, statusManual: false }))}
      />
    </>
  );

  return (
    <div className="space-y-4" data-os-central>
      <CabecalhoOs
        os={os} central={central} acoes={acoes} onAba={irPara}
        onAtualizado={(d) => setOs((prev: any) => ({ ...prev, ...d }))}
      />

      {erroAcao && (
        <div role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {erroAcao}
        </div>
      )}

      {/* Serviços adicionais pedidos na visita: decisão de cobrança à vista em qualquer aba */}
      <OsAdicionais osId={os.id} adicionais={os.servicosAdicionais ?? []} />

      <div className="bg-white rounded-xl border border-surface-border">
        <Tabs tabs={tabs} active={aba} onChange={irPara}>
          {(ativa) => (
            <div className="p-4 sm:p-5 pt-0">
              {ativa === "resumo" && <ResumoOs os={os} central={central} onAba={irPara} />}

              {ativa === "atividades" && (
                <div className="space-y-6">
                  {/* Atividades + execução/equipamentos (Etapa 1) + formulário respondido de cada uma */}
                  <OsAtividades osId={os.id} atividades={os.atividades} clienteId={os.cliente.id} unidadeId={os.unidadeId} />
                  {/* Antiga aba "Prazos": os prazos/SLA por modelo continuam aqui, junto das atividades */}
                  <div className="border-t border-surface-border pt-5" data-secao-sla>
                    <OsPrazos osId={os.id} />
                  </div>
                </div>
              )}

              {ativa === "comercial" && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <section data-secao-orcamentos>
                    <h3 className="section-title mb-3">Orçamentos do comercial</h3>
                    <OsOrcamentosVinculados osId={os.id} clienteId={os.cliente.id} vinculados={os.orcamentos ?? []} />
                  </section>
                  <section data-secao-itens>
                    <h3 className="section-title mb-3">Itens da OS</h3>
                    <OsOrcamento osId={os.id} itens={os.itensOrcamento} />
                  </section>
                </div>
              )}

              {ativa === "materiais" && <ComprasSecao ordemServicoId={os.id} />}

              {ativa === "financeiro" && (
                <OsFinanceiro osId={os.id} temContrato={!!os.contrato} medicoes={os.medicoes} itensOrcamento={os.itensOrcamento} />
              )}

              {ativa === "relatorios" && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <section data-secao-relatorios><OsRelatorios osId={os.id} /></section>
                  <section data-secao-anexos>
                    <h3 className="section-title mb-3">Anexos</h3>
                    <OsAnexos osId={os.id} anexos={os.anexos} />
                  </section>
                </div>
              )}
            </div>
          )}
        </Tabs>
      </div>
    </div>
  );
}
