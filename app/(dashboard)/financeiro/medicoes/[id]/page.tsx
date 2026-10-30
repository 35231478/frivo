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
import { Receipt } from "lucide-react";

export const metadata: Metadata = { title: "Medição" };

export default async function MedicaoDetalhePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  // ?nfse=emitir: "Corrigir e reemitir" da central de notas abre a emissão (com o que falta corrigir)
  const abrirEmissao = (await searchParams).nfse === "emitir";
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const [medicao, empresa] = await Promise.all([
    prisma.medicao.findFirst({
      where: { id, empresaId },
      include: {
        cliente: true,
        contrato: { select: { id: true, numero: true } },
        itens: { orderBy: { ordem: "asc" } },
        contasReceber: { where: { excluidaEm: null }, orderBy: { criadoEm: "asc" } },
      },
    }),
    prisma.empresa.findUnique({ where: { id: empresaId } }),
  ]);

  if (!medicao || !empresa) notFound();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title={`Medição ${medicao.numero}`}
        description={medicao.descricao ?? undefined}
        backHref="/financeiro/medicoes"
      />

      <div className="card-padded">
        <MedicaoAcoes
          medicaoId={medicao.id}
          numero={medicao.numero}
          tokenPublico={medicao.tokenPublico}
          status={medicao.status}
        />
      </div>

      {/* NFS-e: emitida pelo PlugNotas a partir desta medição (uma nota por código de serviço) */}
      <div className="card-padded" id="nfse">
        <NotasFiscais medicaoId={medicao.id} origem="MEDICAO" abrirEmissao={abrirEmissao} />
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
