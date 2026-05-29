import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { carregarRelatorioPorToken } from "@/lib/relatorio-server";
import { RelatorioDocumento } from "@/components/relatorio/relatorio-documento";
import { AprovacaoRelatorio } from "@/components/relatorio/aprovacao-relatorio";
import { RelatorioEnvio } from "@/components/relatorio/relatorio-envio";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { formatarData } from "@/lib/utils";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório", robots: { index: false, follow: false } };

export default async function RelatorioPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dados = await carregarRelatorioPorToken(token);
  if (!dados) notFound();
  const { relatorio, empresa, os, equipamentos } = dados;

  const aprovado = relatorio.status === "APROVADO";
  const reprovado = relatorio.status === "REPROVADO";
  const podeAprovar = !aprovado && !reprovado;

  const emailDestino = os.cliente.emailsFaturamento?.[0] ?? os.cliente.email ?? null;
  const whatsappDestino = os.cliente.whatsappFaturamento ?? os.cliente.celular ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-sidebar text-white py-4 px-6 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <FrivoLogo size="sm" showSubtitle={false} />
          <RelatorioEnvio token={token} numero={relatorio.numero} empresaNome={empresa.nomeFantasia ?? empresa.nome} emailDestino={emailDestino} whatsappDestino={whatsappDestino} />
        </div>
      </header>

      <main className="flex-1 py-8 px-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {aprovado && (
            <div className="bg-success-50 border-2 border-success-500 text-success-700 rounded-xl px-5 py-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <p className="font-bold">Relatório aprovado!</p>
                <p className="text-sm">Aprovado por {relatorio.assinadoPor} em {formatarData(relatorio.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}.</p>
              </div>
            </div>
          )}
          {reprovado && (
            <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-xl px-5 py-4 flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <div><p className="font-bold">Relatório reprovado</p></div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-card p-6 md:p-10">
            <RelatorioDocumento relatorio={relatorio} empresa={empresa} os={os} equipamentos={equipamentos} />
          </div>

          {podeAprovar && <AprovacaoRelatorio token={token} />}
        </div>
      </main>

      <footer className="bg-white border-t border-surface-border py-6 text-center text-xs text-ink-subtle">
        <p>{empresa.nomeFantasia ?? empresa.nome}{empresa.email && ` · ${empresa.email}`}</p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </footer>
    </div>
  );
}
