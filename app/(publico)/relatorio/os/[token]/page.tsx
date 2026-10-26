import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { relatorioPorToken } from "@/lib/relatorio-os/dados";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";
import { RelatorioOsDocumento } from "@/components/relatorio/relatorio-os-documento";
import { RelatorioEnvio } from "@/components/relatorio/relatorio-envio";
import { FrivoLogo } from "@/components/layout/frivo-logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório da OS", robots: { index: false, follow: false } };

/** Link público do relatório da OS = VERSÃO DO CLIENTE (só as seções que o cliente vê). */
export default async function RelatorioOsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await relatorioPorToken(token);
  if (!r) notFound();
  const { dados } = r;
  const config = await getConfigRelatorio(r.empresaId);
  const empresaNome = dados.empresa.nomeFantasia ?? dados.empresa.nome;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-surface-border py-4 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <FrivoLogo size="sm" showSubtitle={false} variant="dark" />
          <RelatorioEnvio token={token} numero={dados.numeroRelatorio ?? dados.numeroOs} empresaNome={empresaNome} emailDestino={dados.envio.email} whatsappDestino={dados.envio.whatsapp} publicPath={`/relatorio/os/${token}`} />
        </div>
      </header>

      <main className="flex-1 py-6 px-3 sm:px-4">
        <div className="max-w-4xl mx-auto bg-white rounded-card shadow-card p-4 sm:p-6 md:p-10">
          <RelatorioOsDocumento dados={dados} config={config} versao="cliente" />
        </div>
      </main>

      <footer className="bg-white border-t border-surface-border py-6 text-center text-xs text-ink-subtle">
        <p>{empresaNome}{dados.empresa.email && ` · ${dados.empresa.email}`}</p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </footer>
    </div>
  );
}
