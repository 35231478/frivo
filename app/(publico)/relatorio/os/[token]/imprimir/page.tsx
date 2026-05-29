import { notFound } from "next/navigation";
import { carregarRelatorioPorToken } from "@/lib/relatorio-server";
import { RelatorioGeralDocumento } from "@/components/relatorio/relatorio-geral-documento";
import { AutoPrint } from "@/components/orcamento/auto-print";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imprimir Relatório da OS", robots: { index: false, follow: false } };

export default async function ImprimirRelatorioOsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dados = await carregarRelatorioPorToken(token);
  if (!dados) notFound();
  const { relatorio, empresa, os, equipamentos } = dados;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-6 print:bg-white print:py-0">
        <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          <RelatorioGeralDocumento relatorio={relatorio} empresa={empresa} os={os} equipamentos={equipamentos} />
        </div>
        <AutoPrint />
      </div>
    </>
  );
}
