"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { OsOrcamento } from "@/components/os/os-orcamento";
import { OsFinanceiro } from "@/components/os/os-financeiro";
import { DespesasCampoOs } from "@/components/os/despesas-campo-os";
import { OsOrcamentosVinculados } from "@/components/os/os-orcamentos-vinculados";
import { OsRelatorios } from "@/components/os/os-relatorios";
import { ComprasSecao } from "@/components/compras/compras-secao";
import { OsSeparacao, materiaisDaOs } from "@/components/os/os-separacao";
import { MateriaisCampo } from "@/components/os/materiais-campo";
import { ComentariosOs } from "@/components/os/comentarios-os";
import { resumoSeparacao } from "@/lib/estoque/separacao";
import { useModulos } from "@/components/providers/modulos-provider";
import { OsInativarBotao } from "@/components/os/os-inativar";
import { OsFotosAnexos } from "@/components/os/os-fotos-anexos";
import { OsAdicionais } from "@/components/os/os-adicionais";
import { OsAceite } from "@/components/os/os-aceite";
import { CabecalhoOs } from "@/components/os/central/cabecalho-os";
import { ResumoOs } from "@/components/os/central/resumo-os";
import { PainelAtividades } from "@/components/os/central/painel-atividades";
import { NomeNaTrilha } from "@/components/layout/nome-na-trilha";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { centralDaOs } from "@/lib/os/central";
import { situacaoDaOs } from "@/lib/edicao-contexto";
import { ABAS_OS, abaValida, destinoDaAba, type AbaOs } from "@/lib/os/abas";
import { AlertTriangle, FileBarChart, Send } from "lucide-react";
import { BotaoFaturar } from "@/components/faturamento/botao-faturar";

// As abas e o destino dos links antigos moram em lib/os/abas (regra pura); ficam exportados daqui por compatibilidade
export { ABAS_OS, abaValida };
export type { AbaOs };

/** Quanto tempo o painel fica destacado depois de a tela rolar até ele */
const DESTAQUE_MS = 1600;

export function OsDetalhe({ os: initialOs, abaInicial, verCusto = false }: {
  os: any; abaInicial?: string;
  /** Custo na OS: a pessoa pode ver custo de compra (decidido no servidor; sem ela o custo nem vem nos itens) */
  verCusto?: boolean;
}) {
  const router = useRouter();
  const [os, setOs] = useState(initialOs);
  // router.refresh() traz a OS de novo do servidor (status automático, histórico): a central acompanha
  useEffect(() => { setOs(initialOs); }, [initialOs]);
  const [aba, setAba] = useState<AbaOs>(abaValida(abaInicial));
  const [gerandoMedicao, setGerandoMedicao] = useState(false);
  const [abrirNfse, setAbrirNfse] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const { pode } = usePermissoes();
  // os.prazos = etapas com prazo, por modelo (só id/status: o Resumo conta as atrasadas)
  // E4.1/E4.2: a separação e o consumo de material (estado por material do snapshot) — o badge da aba conta o que falta
  const materiaisOs = useMemo(() => materiaisDaOs(os.itensOrcamento ?? []), [os.itensOrcamento]);
  const separacao = useMemo(() => resumoSeparacao(materiaisOs, os.status === "CANCELADA"), [materiaisOs, os.status]);
  // Loja de Módulos: a OS é do núcleo e continua inteira; o que é do Estoque (separar, reservar,
  // devolver) some quando a empresa não usa o módulo. O material consumido FICA: é custo da OS.
  const temEstoque = useModulos().tem("estoque");
  const central = useMemo(() => centralDaOs({ ...os, prazosSla: os.prazos ?? [], materiais: materiaisOs, exigirPrestacaoMaterial: !!os.exigirPrestacaoMaterial }), [os, materiaisOs]);

  // O painel de Atividades: a tela rola até ele e o destaca quando algo aponta para lá
  const painelRef = useRef<HTMLElement>(null);
  const [painelDestacado, setPainelDestacado] = useState(false);
  const destaqueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function irAoPainel() {
    painelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    painelRef.current?.focus?.({ preventScroll: true });
    setPainelDestacado(true);
    if (destaqueTimer.current) clearTimeout(destaqueTimer.current);
    destaqueTimer.current = setTimeout(() => setPainelDestacado(false), DESTAQUE_MS);
  }
  useEffect(() => () => { if (destaqueTimer.current) clearTimeout(destaqueTimer.current); }, []);
  // Link antigo (?aba=atividades, ?aba=formularios): abre o Resumo e já rola até o painel
  useEffect(() => { if (destinoDaAba(abaInicial, true).painel) irAoPainel(); }, [abaInicial]);

  function irPara(id: string) {
    const destino = destinoDaAba(id);
    if (destino.painel) { irAoPainel(); return; }
    const nova = destino.aba ?? "resumo";
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
    { id: "comercial", label: "Comercial", badge: (os.orcamentos?.length ?? 0) + os.itensOrcamento.length },
    { id: "materiais", label: "Materiais & Compras", badge: (temEstoque ? separacao.aSeparar + separacao.aDevolver : 0) + separacao.consumoPendente },
    { id: "financeiro", label: "Financeiro", badge: os.medicoes.length },
    { id: "relatorios", label: "Relatórios & Anexos", badge: (os.galeria?.fotos.length ?? 0) + (os.galeria?.documentos.length ?? 0) },
  ];

  const acoes = (
    <>
      {/* OS avulsa: "Faturar" (direto para a nota). OS de contrato: segue pela medição */}
      {!os.contrato ? (
        <BotaoFaturar
          url={`/api/ordens/${os.id}/faturar`} origem="OS" fatura={os.fatura ?? null} faturamento={os.faturamento ?? null} compacto
          podeFaturar={os.status === "CONCLUIDA" && pode("financeiro", "medicoes")} podeVer={pode("financeiro", "visualizar")}
        />
      ) : os.status === "CONCLUIDA" && pode("financeiro", "medicoes") && (
        <Button variant="outline" onClick={gerarMedicao} loading={gerandoMedicao}>
          <FileBarChart className="w-4 h-4" /> Gerar medição
        </Button>
      )}
      {os.status === "CONCLUIDA" && pode("financeiro", "fiscal") && (
        <Button variant="outline" onClick={() => { setAbrirNfse(true); irPara("financeiro"); }} data-acao="emitir-nfse-os">
          <Send className="w-4 h-4" /> Emitir NFS-e
        </Button>
      )}
      <OsInativarBotao
        osId={os.id} numero={os.chamadoNumero ?? os.numero} status={os.status}
        onAlterado={(novo) => setOs((prev: any) => ({ ...prev, status: novo, statusManual: false }))}
      />
    </>
  );

  return (
    <div className="space-y-5" data-os-central>
      <NomeNaTrilha id={os.id} nome={os.chamadoNumero ?? os.numero} />
      <CabecalhoOs
        os={os} central={central} acoes={acoes} onAba={irPara}
        onAtualizado={(d) => setOs((prev: any) => ({ ...prev, ...d }))}
      />

      {erroAcao && (
        <div role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {erroAcao}
        </div>
      )}

      {/* Aceite do cliente: "aguardando confirmação" (enviar o link, colher a assinatura) ou a prova de quem confirmou */}
      <OsAceite osId={os.id} numero={os.numero} cliente={os.cliente?.nomeFantasia ?? os.cliente?.nome ?? ""} statusOs={os.status}
        aoMudar={(aceite) => setOs((prev: any) => (JSON.stringify(prev.aceite ?? null) === JSON.stringify(aceite) ? prev : { ...prev, aceite }))} />

      {/* Serviços adicionais pedidos na visita: decisão de cobrança à vista em qualquer aba */}
      <OsAdicionais osId={os.id} adicionais={os.servicosAdicionais ?? []} />

      {/* DUAS COLUNAS quando há espaço de verdade: as abas à esquerda, o painel de Atividades sempre visível à
          direita. Quem decide é a largura DISPONÍVEL (container query em app/globals.css › .os-central), não a da
          tela: com o menu lateral aberto, 1280–1366 px empilham (abas e, embaixo, o painel); com o menu recolhido
          ou numa tela larga, o painel vai para o lado. Nunca espreme as abas. */}
      <div className="os-central">
      <div className="os-colunas" data-colunas-os>
        <div className="os-abas bg-white rounded-card border border-surface-border shadow-card min-w-0">
          <Tabs tabs={tabs} active={aba} onChange={irPara}>
            {(ativa) => (
              <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                {ativa === "resumo" && <ResumoOs os={os} central={central} onAba={irPara} onAtualizado={(d) => setOs((prev: any) => ({ ...prev, ...d }))} />}
                {/* App do técnico: a conversa interna com o campo (abrir marca como lido) */}
                {ativa === "resumo" && <div className="mt-6 border-t border-surface-linha pt-6"><ComentariosOs osId={os.id} podeResponder={pode("ordens", "editar")} /></div>}

                {ativa === "comercial" && (
                  <div className="space-y-6">
                    <section data-secao-orcamentos>
                      <h3 className="section-title mb-3">Orçamentos do comercial</h3>
                      <OsOrcamentosVinculados osId={os.id} clienteId={os.cliente.id} numeroOs={os.chamadoNumero ?? os.numero} vinculados={os.orcamentos ?? []} />
                    </section>
                    <section data-secao-itens>
                      <h3 className="section-title mb-3">Itens da OS</h3>
                      <OsOrcamento osId={os.id} itens={os.itensOrcamento} clienteId={os.cliente.id} verCusto={verCusto} regraMateriais={os.regraMateriais}
                        situacao={situacaoDaOs({ aceite: os.aceite, faturada: !!os.fatura, notaEmitida: !!os.notaEmitida })} />
                    </section>
                  </div>
                )}

                {ativa === "materiais" && (
                  <div className="space-y-6">
                    {/* E4.1: o que já foi separado (parcial/total), por quem, e o gancho da prestação de contas */}
                    <OsSeparacao
                      osId={os.id} materiais={materiaisOs} resumo={separacao} podeSeparar={pode("estoque", "separar")} temEstoque={temEstoque}
                      podeConsumir={pode("ordens", "editar") || pode("ordens", "concluir")} finalizada={os.status === "CONCLUIDA" || os.status === "CANCELADA" || !!os.fatura}
                      cancelada={os.status === "CANCELADA"} exigirPrestacao={!!os.exigirPrestacaoMaterial} onMudou={() => router.refresh()}
                    />
                    {/* App do técnico: o que foi lançado em campo (o escritório corrige ou estorna, com registro) */}
                    <MateriaisCampo osId={os.id} podeCorrigir={pode("ordens", "editar")} onMudou={() => router.refresh()} />
                    <div className="border-t border-surface-linha pt-6" data-secao-compras>
                      <ComprasSecao ordemServicoId={os.id} />
                    </div>
                  </div>
                )}

                {ativa === "financeiro" && (
                  <OsFinanceiro osId={os.id} temContrato={!!os.contrato} concluida={os.status === "CONCLUIDA"} fatura={os.fatura ?? null} faturamento={os.faturamento ?? null} medicoes={os.medicoes} itensOrcamento={os.itensOrcamento} contasReceber={os.contasReceber ?? []} abrirNfse={abrirNfse} onAbriuNfse={() => setAbrirNfse(false)} onAba={irPara} pedidoCliente={os.pedidoClienteSituacao ?? null} />
                )}
                {ativa === "financeiro" && pode("financeiro", "visualizar") && <div className="mt-6"><DespesasCampoOs osId={os.id} /></div>}

                {ativa === "relatorios" && (
                  <div className="space-y-8">
                    <section data-secao-relatorios><OsRelatorios osId={os.id} /></section>
                    {/* Fotos & anexos em LARGURA TOTAL, embaixo dos relatórios: por equipamento + Geral + Documentos */}
                    <section data-secao-anexos className="border-t border-surface-linha pt-6">
                      <OsFotosAnexos osId={os.id} galeria={os.galeria ?? { equipamentos: [], fotos: [], documentos: [] }}
                        onMudou={(galeria) => setOs((prev: any) => ({ ...prev, galeria }))} />
                    </section>
                  </div>
                )}
              </div>
            )}
          </Tabs>
        </div>

        {/* O painel: a mesma lista de atividades de antes (criar, editar, excluir, status, executar, equipamentos,
            formulário) e o plano de visitas da OS em campanha — agora sempre à vista */}
        <PainelAtividades ref={painelRef} os={os} destacado={painelDestacado} onMudou={() => router.refresh()} />
      </div>
      </div>
    </div>
  );
}
