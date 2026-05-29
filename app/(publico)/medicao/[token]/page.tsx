import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MedicaoDocumento } from "@/components/medicao/medicao-documento";
import { MedicaoEnvio } from "@/components/medicao/medicao-envio";
import { AprovacaoMedicao } from "@/components/medicao/aprovacao-medicao";
import { RelatorioGeralDocumento } from "@/components/relatorio/relatorio-geral-documento";
import { carregarRelatorioPorToken } from "@/lib/relatorio-server";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { LABELS_STATUS_MEDICAO, CLASSE_STATUS_MEDICAO, formatarData, cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Medição",
  robots: { index: false, follow: false },
};

export default async function MedicaoPublicaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const medicao = await prisma.medicao.findUnique({
    where: { tokenPublico: token },
    include: {
      empresa: true,
      cliente: true,
      itens: { orderBy: { ordem: "asc" } },
    },
  });

  if (!medicao) notFound();

  const cancelada = medicao.status === "CANCELADA";
  const aguardando = medicao.status === "AGUARDANDO_APROVACAO";
  const jaAprovada = !!medicao.assinaturaUrl;

  // Documento integrado: anexa o relatório consolidado quando há um relatório vinculado
  const relVinculado = await prisma.relatorioOs.findFirst({
    where: { medicaoId: medicao.id, escopo: "MEDICAO_COMPLETA" },
    select: { tokenPublico: true },
  });
  const consolidado = relVinculado ? await carregarRelatorioPorToken(relVinculado.tokenPublico) : null;

  const emailDestino = medicao.cliente.emailsFaturamento?.[0] ?? medicao.cliente.email ?? null;
  const whatsappDestino = medicao.cliente.whatsappFaturamento ?? medicao.cliente.celular ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-sidebar text-white py-4 px-6 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <FrivoLogo size="sm" showSubtitle={false} />
          <MedicaoEnvio token={token} numero={medicao.numero} empresaNome={medicao.empresa.nomeFantasia ?? medicao.empresa.nome} emailDestino={emailDestino} whatsappDestino={whatsappDestino} />
        </div>
      </header>

      <main className="flex-1 py-8 px-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {cancelada && (
            <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-xl px-5 py-4 flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <div>
                <p className="font-bold">Medição cancelada</p>
                <p className="text-sm">Esta medição foi cancelada pela empresa.</p>
              </div>
            </div>
          )}
          {jaAprovada && (
            <div className="bg-success-50 border-2 border-success-500 text-success-700 rounded-xl px-5 py-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <p className="font-bold">Medição aprovada!</p>
                <p className="text-sm">
                  Aprovada por {medicao.assinadoPor} em {formatarData(medicao.dataAprovacao, "dd/MM/yyyy 'às' HH:mm")}.
                </p>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-card p-6 md:p-10">
            <MedicaoDocumento medicao={medicao} empresa={medicao.empresa} cliente={medicao.cliente} />
          </div>

          {consolidado && (
            <div className="bg-white rounded-2xl shadow-card p-6 md:p-10">
              <p className="text-xs uppercase tracking-wider text-ink-muted mb-4 pb-2 border-b border-surface-border">Relatório técnico completo</p>
              <RelatorioGeralDocumento
                relatorio={consolidado.relatorio}
                empresa={consolidado.empresa}
                os={consolidado.os}
                equipamentos={consolidado.equipamentos}
              />
            </div>
          )}

          {aguardando && !jaAprovada && <AprovacaoMedicao token={token} />}
          {medicao.status === "RASCUNHO" && (
            <div className="bg-white border border-surface-border rounded-xl px-5 py-4 text-center">
              <span className={cn("inline-flex mb-2", CLASSE_STATUS_MEDICAO[medicao.status])}>
                {LABELS_STATUS_MEDICAO[medicao.status]}
              </span>
              <p className="text-sm text-ink-muted">Esta medição ainda não foi formalmente enviada pela empresa.</p>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-surface-border py-6 text-center text-xs text-ink-subtle">
        <p>
          {medicao.empresa.nomeFantasia ?? medicao.empresa.nome}
          {medicao.empresa.email && ` · ${medicao.empresa.email}`}
        </p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </footer>
    </div>
  );
}
