import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { ColaboradorForm } from "@/components/forms/colaborador-form";

export const metadata: Metadata = { title: "Editar Colaborador" };

export default async function EditarColaboradorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const colaborador = await prisma.tecnico.findFirst({
    where: { id, empresaId },
    include: { competencias: { select: { id: true } }, documentos: { orderBy: { criadoEm: "asc" } } },
  });
  if (!colaborador) notFound();

  const user = session!.user!;
  const podeFolha = pode(user.permissoes, "financeiro", "folha", user.role);

  // Serializa para o client (Decimal/Date → tipos simples). O salário NÃO vai para o navegador:
  // quem tem a permissão de folha vê/edita na aba "Dados financeiros / Folha" (API própria).
  const { salario: _salario, ...semSalario } = colaborador;
  const initialData = {
    ...semSalario,
    dataNascimento: colaborador.dataNascimento ? colaborador.dataNascimento.toISOString() : null,
    dataAdmissao: colaborador.dataAdmissao ? colaborador.dataAdmissao.toISOString() : null,
    documentos: colaborador.documentos.map((d) => ({
      tipo: d.tipo, nome: d.nome, arquivoUrl: d.arquivoUrl,
      dataVencimento: d.dataVencimento ? d.dataVencimento.toISOString() : null,
    })),
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Editar Colaborador" description={colaborador.nome} backHref="/colaboradores"
        actions={<InativarRegistro url={`/api/tecnicos/${colaborador.id}`} modulo="equipes" acaoReativar="gerenciar" variante="botao" ativo={colaborador.ativo} nome={colaborador.nome} entidade="colaborador" />}
      />
      {!colaborador.ativo && (
        <div data-aviso-inativo className="mb-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-4 py-3 text-sm">
          Este colaborador está <strong>inativo</strong>: não aparece nas listas nem nos seletores de técnico. Use “Reativar” para voltar a usá-lo.
        </div>
      )}
      <ColaboradorForm
        key={`${colaborador.ativo}-${colaborador.statusColaborador}`} initialData={initialData}
        somenteLeitura={!pode(user.permissoes, "equipes", "gerenciar", user.role)}
        podeFolha={podeFolha}
      />
    </div>
  );
}
