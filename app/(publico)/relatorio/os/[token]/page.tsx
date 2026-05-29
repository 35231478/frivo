import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { carregarRelatorioPorToken } from "@/lib/relatorio-server";
import { RelatorioGeralDocumento } from "@/components/relatorio/relatorio-geral-documento";
import { RelatorioEnvio } from "@/components/relatorio/relatorio-envio";
import { FrivoLogo } from "@/components/layout/frivo-logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório da OS", robots: { index: false, follow: false } };

export default async function RelatorioOsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dados = await carregarRelatorioPorToken(token);
  if (!dados) notFound();
  const { relatorio, empresa, os, equipamentos } = dados;

  const emailDestino = os.cliente.emailsFaturamento?.[0] ?? os.cliente.email ?? null;
  const whatsappDestino = os.cliente.whatsappFaturamento ?? os.cliente.celular ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-sidebar text-white py-4 px-6 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <FrivoLogo size="sm" showSubtitle={false} />
          <RelatorioEnvio token={token} numero={relatorio.numero} empresaNome={empresa.nomeFantasia ?? empresa.nome} emailDestino={emailDestino} whatsappDestino={whatsappDestino} publicPath={`/relatorio/os/${token}`} />
        </div>
      </header>

      <main className="flex-1 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-card p-6 md:p-10">
            <RelatorioGeralDocumento relatorio={relatorio} empresa={empresa} os={os} equipamentos={equipamentos} />
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-surface-border py-6 text-center text-xs text-ink-subtle">
        <p>{empresa.nomeFantasia ?? empresa.nome}{empresa.email && ` · ${empresa.email}`}</p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </footer>
    </div>
  );
}
