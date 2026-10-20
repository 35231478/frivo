import { notFound } from "next/navigation";
import { relatorioPorToken } from "@/lib/relatorio-os/dados";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";
import { RelatorioOsDocumento } from "@/components/relatorio/relatorio-os-documento";
import { AutoPrint } from "@/components/orcamento/auto-print";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imprimir Relatório da OS", robots: { index: false, follow: false } };

/** PDF/impressão do link público = VERSÃO DO CLIENTE. */
export default async function ImprimirRelatorioOsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await relatorioPorToken(token);
  if (!r) notFound();
  const config = await getConfigRelatorio(r.empresaId);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-6 print:bg-white print:py-0">
        <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          <RelatorioOsDocumento dados={r.dados} config={config} versao="cliente" />
        </div>
        <AutoPrint />
      </div>
    </>
  );
}
