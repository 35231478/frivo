import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { relatorioInterno } from "@/lib/relatorio-os/dados";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";
import { RelatorioOsDocumento } from "@/components/relatorio/relatorio-os-documento";
import { BarraRelatorioOs } from "@/components/relatorio/barra-relatorio-os";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório da OS", robots: { index: false, follow: false } };

/**
 * Relatório da OS para quem tem login (Ordens › visualizar), da empresa da sessão:
 *  - padrão: VERSÃO INTERNA (todas as seções ligadas, inclusive as "só interno");
 *  - ?versao=cliente: prévia exata do que o cliente vê no link público.
 * Fica fora do layout do painel para imprimir limpo (A4).
 */
export default async function RelatorioOsInternoPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ versao?: string }>;
}) {
  const [{ id }, sp, session] = await Promise.all([params, searchParams, auth()]);
  const u = session?.user;
  if (!u) redirect(`/login?callbackUrl=/ordens/${id}/relatorio`);
  if (!pode(u.permissoes, "ordens", "visualizar", u.role)) redirect("/sem-permissao");
  const r = await relatorioInterno(id, u.empresaId);
  if (!r) notFound();
  const versao = sp.versao === "cliente" ? "cliente" : "interna";
  const [config, geral] = await Promise.all([
    getConfigRelatorio(u.empresaId),
    prisma.relatorioOs.findFirst({ where: { ordemServicoId: id, empresaId: u.empresaId, escopo: "GERAL" }, orderBy: { criadoEm: "desc" }, select: { tokenPublico: true } }),
  ]);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-4 sm:py-6 print:bg-white print:py-0">
        <BarraRelatorioOs osId={id} versao={versao} linkCliente={geral ? `/relatorio/os/${geral.tokenPublico}` : null} />
        <div className="max-w-4xl mx-auto bg-white p-4 sm:p-6 md:p-10 sm:rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          <RelatorioOsDocumento dados={r.dados} config={config} versao={versao} />
        </div>
      </div>
    </>
  );
}
