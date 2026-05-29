import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MedicaoDocumento } from "@/components/medicao/medicao-documento";
import { RelatorioGeralDocumento } from "@/components/relatorio/relatorio-geral-documento";
import { carregarRelatorioPorToken } from "@/lib/relatorio-server";
import { AutoPrint } from "@/components/orcamento/auto-print";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imprimir Medição", robots: { index: false, follow: false } };

export default async function ImprimirMedicaoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const medicao = await prisma.medicao.findUnique({
    where: { tokenPublico: token },
    include: { empresa: true, cliente: true, itens: { orderBy: { ordem: "asc" } } },
  });
  if (!medicao) notFound();

  const relVinculado = await prisma.relatorioOs.findFirst({
    where: { medicaoId: medicao.id, escopo: "MEDICAO_COMPLETA" },
    select: { tokenPublico: true },
  });
  const consolidado = relVinculado ? await carregarRelatorioPorToken(relVinculado.tokenPublico) : null;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-6 print:bg-white print:py-0 space-y-6">
        <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          <MedicaoDocumento medicao={medicao} empresa={medicao.empresa} cliente={medicao.cliente} />
        </div>
        {consolidado && (
          <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0" style={{ breakBefore: "page" }}>
            <RelatorioGeralDocumento relatorio={consolidado.relatorio} empresa={consolidado.empresa} os={consolidado.os} equipamentos={consolidado.equipamentos} />
          </div>
        )}
        <AutoPrint />
      </div>
    </>
  );
}
