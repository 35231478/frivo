import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { OrcamentoDocumento } from "@/components/orcamento/orcamento-documento";
import { PropostaDocumento } from "@/components/orcamento/proposta-documento";
import { AutoPrint } from "@/components/orcamento/auto-print";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Imprimir Orçamento",
  robots: { index: false, follow: false },
};

export default async function ImprimirOrcamentoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const orcamento = await prisma.orcamento.findUnique({
    where: { tokenPublico: token },
    include: {
      empresa: true,
      cliente: true,
      responsavelTecnico: { select: { nome: true, crea: true } },
      servicos: { orderBy: { ordem: "asc" } },
      produtos: { orderBy: { ordem: "asc" } },
    },
  });

  if (!orcamento) notFound();

  const proposta = orcamento.tipo === "PROPOSTA_CONTRATO";
  const equipamentos = proposta && orcamento.equipamentosCobertos.length
    ? (await prisma.equipamento.findMany({
        where: { id: { in: orcamento.equipamentosCobertos }, empresaId: orcamento.empresaId },
        select: { id: true, marca: true, modelo: true, numeroSerie: true, unidade: { select: { nome: true } } },
      })).map((e) => ({ id: e.id, rotulo: [e.marca, e.modelo, e.numeroSerie ? `(${e.numeroSerie})` : "", e.unidade?.nome ? `— ${e.unidade.nome}` : ""].filter(Boolean).join(" ") }))
    : [];

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print {
          body { background: white !important; }
          .print-hide { display: none !important; }
        }
      `}</style>
      <div className="min-h-screen bg-surface-page py-6 print:bg-white print:py-0">
        <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          {proposta ? (
            <PropostaDocumento
              orcamento={orcamento}
              empresa={orcamento.empresa}
              cliente={orcamento.cliente}
              responsavelTecnico={orcamento.responsavelTecnico}
              equipamentos={equipamentos}
            />
          ) : (
            <OrcamentoDocumento
              orcamento={orcamento}
              empresa={orcamento.empresa}
              cliente={orcamento.cliente}
            />
          )}
        </div>
        <AutoPrint />
      </div>
    </>
  );
}
