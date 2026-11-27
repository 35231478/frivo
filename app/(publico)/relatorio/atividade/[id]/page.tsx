import { notFound } from "next/navigation";
import { carregarAtividade } from "@/lib/relatorio-server";
import { AtividadeDocumento } from "@/components/relatorio/atividade-documento";
import { AutoPrint } from "@/components/orcamento/auto-print";
import { AcoesRelatorioAtividade } from "@/components/relatorio/acoes-relatorio-atividade";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatório de atividade", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** Link público: /relatorio/atividade/<id>?t=<token>. Sem o token certo, 404 (a mesma do id inexistente). */
export default async function RelatorioAtividadePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[]; imprimir?: string }> }) {
  const { id } = await params;
  const { t, imprimir } = await searchParams;
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
          <AtividadeDocumento empresa={empresa} os={os} atividade={atividade} equipamentos={equipamentos} adicionais={dados.adicionais} fotosServico={dados.fotosServico} numero={numero}
            materiais={dados.materiais} aceite={dados.aceite} />
        </div>
        {/* Quem abre pelo WhatsApp não quer a janela de impressão: ela só abre sozinha com ?imprimir=1 */}
        {imprimir === "1" ? <AutoPrint /> : <AcoesRelatorioAtividade pdf={`/relatorio/atividade/${encodeURIComponent(id)}/pdf?t=${encodeURIComponent(String(t))}`} />}
      </div>
    </>
  );
}
