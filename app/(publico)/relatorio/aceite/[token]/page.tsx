import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronDown, ClipboardCheck } from "lucide-react";
import { relatorioInterno } from "@/lib/relatorio-os/dados";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";
import { RelatorioOsDocumento } from "@/components/relatorio/relatorio-os-documento";
import { AceitePublico } from "@/components/os/aceite-publico";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { getPortalSession } from "@/lib/auth-portal";
import { aceitePorToken } from "@/lib/os/aceite-server";
import { provaDoAceite, rotuloDaOs, temRessalva, textoDoAceite } from "@/lib/os/aceite";
import { formatarData } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmação de serviço", robots: { index: false, follow: false } };

/**
 * Link público do ACEITE: o cliente vê de qual OS se trata (número, data, o que foi feito, os
 * equipamentos atendidos — o próprio relatório da OS, versão do cliente) e SÓ ENTÃO confirma.
 * Sem login: quem tem o token confirma. Depois de confirmado, a página mostra quem confirmou e quando.
 */
export default async function AceitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const aceite = await aceitePorToken(token);
  if (!aceite) notFound();
  const os = aceite.ordemServico;
  const r = await relatorioInterno(os.id, aceite.empresaId);
  if (!r) notFound();
  const { dados } = r;
  const config = await getConfigRelatorio(aceite.empresaId);
  const empresaNome = dados.empresa.nomeFantasia ?? dados.empresa.nome;
  // Quem está logado no portal DESTE cliente já vem com o nome e ganha o caminho de volta
  const sessao = await getPortalSession().catch(() => null);
  const noPortal = !!sessao?.user && sessao.user.clienteId === os.clienteId && sessao.user.empresaId === aceite.empresaId;

  const confirmado = aceite.situacao === "CONFIRMADO";
  const comRessalva = temRessalva(aceite);
  const disponivel = !confirmado && os.status === "CONCLUIDA";
  const numero = rotuloDaOs(os.numero);
  const servico = dados.tipos.join(", ") || "Atendimento";
  const atendidos = dados.resultado.atendidos;

  return (
    <div className="min-h-screen flex flex-col" data-pagina-aceite={confirmado ? "CONFIRMADO" : disponivel ? "PENDENTE" : "INDISPONIVEL"}>
      <header className="bg-white border-b border-surface-border py-4 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <FrivoLogo size="sm" showSubtitle={false} variant="dark" />
          {noPortal && <Link href="/portal/dashboard" className="text-sm font-medium text-primary-600 hover:underline" data-voltar-portal>Voltar ao portal</Link>}
        </div>
      </header>

      <main className="flex-1 py-6 px-3 sm:px-4">
        <div className="max-w-4xl mx-auto space-y-5">
          {/* De QUAL serviço se trata, antes de qualquer botão */}
          <section className="bg-white rounded-card shadow-card p-5 sm:p-6 space-y-3" data-aceite-resumo>
            <p className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4" aria-hidden /> Confirmação de serviço · {empresaNome}</p>
            <h1 className="text-2xl font-bold text-ink" data-aceite-os>{numero}</h1>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><dt className="text-xs text-ink-muted">Serviço</dt><dd className="font-medium text-ink" data-aceite-servico>{servico}</dd></div>
              <div><dt className="text-xs text-ink-muted">Concluído em</dt><dd className="font-medium text-ink" data-aceite-data>{os.dataConclusao ? formatarData(os.dataConclusao) : "—"}</dd></div>
              <div><dt className="text-xs text-ink-muted">Equipamentos atendidos</dt><dd className="font-medium text-ink" data-aceite-equipamentos>{atendidos}</dd></div>
            </dl>
            <div>
              <p className="text-xs text-ink-muted">O que foi pedido</p>
              <p className="text-sm text-ink whitespace-pre-wrap break-words">{dados.solicitacao}</p>
            </div>
            {confirmado ? (
              <div className="bg-ok-claro border border-ok/20 rounded-lg px-4 py-3 flex items-start gap-2" data-aceite-confirmado={comRessalva ? "RESSALVA" : "SIMPLES"}>
                <CheckCircle2 className="w-5 h-5 text-ok-texto shrink-0 mt-0.5" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-ok-texto">{comRessalva ? "Serviço confirmado, com ressalva" : "Serviço confirmado"}</p>
                  <p className="text-sm text-ink">{textoDoAceite(aceite)}</p>
                  <p className="text-xs text-ink-muted">{provaDoAceite({ metodo: aceite.metodo, ip: aceite.ip, colhidoPor: aceite.colhidoPor?.nome })}</p>
                  {comRessalva && (
                    <p className="text-sm text-ink mt-2 whitespace-pre-wrap break-words" data-aceite-ressalva-registrada>
                      <strong>Ressalva registrada:</strong> {aceite.ressalva}
                      <span className="block text-xs text-ink-muted mt-1">{empresaNome} foi avisada.</span>
                    </p>
                  )}
                </div>
              </div>
            ) : disponivel ? (
              <a href="#confirmar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline" data-ir-confirmar>
                Leia o relatório abaixo e confirme no fim da página <ChevronDown className="w-4 h-4" aria-hidden />
              </a>
            ) : (
              <p className="bg-surface-alt border border-surface-border rounded-lg px-4 py-3 text-sm text-ink-muted" data-aceite-indisponivel>
                {os.status === "CANCELADA" ? "Esta ordem de serviço foi cancelada." : "Este serviço voltou a ficar em andamento. A confirmação abre de novo quando ele for concluído."}
              </p>
            )}
          </section>

          <div className="bg-white rounded-card shadow-card p-4 sm:p-6 md:p-10" data-aceite-relatorio>
            <RelatorioOsDocumento dados={dados} config={config} versao="cliente" />
          </div>

          {disponivel && (
            <AceitePublico token={token} rotulo={`${numero}${os.dataConclusao ? `, concluída em ${formatarData(os.dataConclusao)}` : ""}`} nomeSugerido={noPortal ? sessao!.user.name : null} />
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-surface-border py-6 text-center text-xs text-ink-subtle">
        <p>{empresaNome}{dados.empresa.email && ` · ${dados.empresa.email}`}</p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </footer>
    </div>
  );
}
