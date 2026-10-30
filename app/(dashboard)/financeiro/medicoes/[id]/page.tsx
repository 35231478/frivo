import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MedicaoDocumento } from "@/components/medicao/medicao-documento";
import { MedicaoAcoes } from "@/components/medicao/medicao-acoes";
import { NotasFiscais } from "@/components/fiscal/nfse-notas";
import { PageHeader } from "@/components/ui/page-header";
import { ContasReceberVinculadas } from "@/components/financeiro/contas-receber-vinculadas";
import { pode } from "@/lib/permissoes";
import { ResumoRetencoes } from "@/components/medicao/medicao-retencoes";
import { baseRetencoes, retencoesDaMedicao, retencoesDosServicos, SELECT_RETENCOES_SERVICO } from "@/lib/financeiro/retencoes";
import { Receipt } from "lucide-react";
import { rotuloMedicao } from "@/lib/faturamento/fatura";

export const metadata: Metadata = { title: "Medição" };

export default async function MedicaoDetalhePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  // ?nfse=emitir: "Corrigir e reemitir" da central de notas abre a emissão (com o que falta corrigir)
  const abrirEmissao = (await searchParams).nfse === "emitir";
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [medicao, empresa, config] = await Promise.all([
    prisma.medicao.findFirst({
      where: { id, empresaId },
      include: {
        cliente: true,
        contrato: { select: { id: true, numero: true } },
        itens: { orderBy: { ordem: "asc" }, include: { servico: { select: SELECT_RETENCOES_SERVICO } } },
        contasReceber: { where: { excluidaEm: null }, orderBy: { criadoEm: "asc" } },
      },
    }),
    prisma.empresa.findUnique({ where: { id: empresaId } }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
  ]);

  if (!medicao || !empresa) notFound();
  const vivas = medicao.contasReceber.filter((c) => c.status !== "CANCELADO");
  const bloqueioRetencoes =
    medicao.status === "PAGO" ? `${medicao.avulsa ? "Fatura paga" : "Medição paga"}: as retenções não mudam mais.` :
    medicao.status === "CANCELADA" ? (medicao.avulsa ? "Fatura cancelada." : "Medição cancelada.") :
    vivas.some((c) => c.status === "RECEBIDO") ? "Conta já recebida: as retenções não mudam mais." :
    vivas.some((c) => c.boletoStatus === "EMITIDO") ? "Boleto emitido: cancele o boleto para mudar as retenções." :
    vivas.length > 1 ? "Medição com várias contas (contratos): retenção não disponível aqui." : null;

  // Fatura avulsa: "voltar" leva à origem (a OS ou o orçamento faturado)
  const origem = medicao.avulsa ? medicao.itens.find((i) => i.ordemServicoId || i.orcamentoId) : undefined;
  const voltar = origem?.ordemServicoId ? `/ordens/${origem.ordemServicoId}`
    : origem?.orcamentoId ? `/orcamentos/${origem.orcamentoId}` : "/financeiro/medicoes";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title={rotuloMedicao(medicao)}
        description={medicao.descricao ?? undefined}
        backHref={voltar}
      />

      <div className="card-padded">
        <MedicaoAcoes
          medicaoId={medicao.id}
          numero={medicao.numero}
          tokenPublico={medicao.tokenPublico}
          status={medicao.status}
          avulsa={medicao.avulsa}
        />
      </div>

      {/* NFS-e: emitida pelo PlugNotas a partir desta medição (uma nota por código de serviço) */}
      <div className="card-padded" id="nfse">
        <NotasFiscais medicaoId={medicao.id} origem="MEDICAO" abrirEmissao={abrirEmissao} />
      </div>

      {/* Retenções: uma linha discreta (herdadas dos serviços); "Editar" abre o editor para a exceção */}
      <div className="card-padded py-3">
        <ResumoRetencoes
          medicaoId={medicao.id}
          base={baseRetencoes(medicao)}
          liquido={Number(medicao.valorLiquido)}
          gravadas={retencoesDaMedicao(medicao)}
          sugestao={retencoesDosServicos(
            medicao.itens.map((i) => ({ tipo: i.tipo, valorTotal: Number(i.valorTotal), servico: i.servico })),
            config?.issAliquota != null ? Number(config.issAliquota) : null,
          )}
          podeEditar={pode(session!.user!.permissoes, "financeiro", "medicoes", session!.user!.role)}
          bloqueio={bloqueioRetencoes}
        />
      </div>

      <div className="card-padded">
        <MedicaoDocumento medicao={medicao} empresa={empresa} cliente={medicao.cliente} />
      </div>

      {medicao.contasReceber.length > 0 && (
        <div className="card-padded">
          <h2 className="card-title mb-3 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary-600" /> Contas a receber
          </h2>
          <ContasReceberVinculadas
            contas={medicao.contasReceber.map((c) => ({ id: c.id, numero: c.numero, valor: Number(c.valor), status: c.status, dataVencimento: c.dataVencimento }))}
            podeAbrir={pode(session!.user!.permissoes, "financeiro", "contasReceber", session!.user!.role)}
          />
        </div>
      )}
    </div>
  );
}
