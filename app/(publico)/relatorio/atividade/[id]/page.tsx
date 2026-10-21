import { notFound } from "next/navigation";
import { carregarAtividade } from "@/lib/relatorio-server";
import { AtividadeDocumento } from "@/components/relatorio/atividade-documento";
import { AutoPrint } from "@/components/orcamento/auto-print";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatório de Atividade", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** Link público: /relatorio/atividade/<id>?t=<token>. Sem o token certo, 404 (a mesma do id inexistente). */
export default async function RelatorioAtividadePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[] }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const dados = await carregarAtividade(id, t);
  if (!dados) notFound();
  const { empresa, os, atividade, equipamentos, numero } = dados;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-6 print:bg-white print:py-0">
        <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          <AtividadeDocumento empresa={empresa} os={os} atividade={atividade} equipamentos={equipamentos} numero={numero} />
        </div>
        <AutoPrint />
      </div>
    </>
  );
}
