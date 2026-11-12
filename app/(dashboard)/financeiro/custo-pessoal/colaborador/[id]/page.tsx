import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { LABELS_FUNCAO } from "@/lib/colaborador-listagem";
import { PageHeader } from "@/components/ui/page-header";
import { FolhaColaborador } from "@/components/folha/folha-colaborador";

export const metadata: Metadata = { title: "Dados financeiros do colaborador" };

/**
 * Dados financeiros / Folha de um colaborador, pelo Financeiro — para quem tem "Custo de pessoal"
 * mas não acessa Equipes → Colaboradores. Mesmo cadastro e mesma API da aba do colaborador.
 */
export default async function FolhaDoColaboradorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const user = session!.user!;
  if (!pode(user.permissoes, "financeiro", "folha", user.role)) redirect("/sem-permissao");

  const c = await prisma.tecnico.findFirst({
    where: { id, empresaId: user.empresaId },
    select: { id: true, nome: true, tipo: true, ativo: true, cargo: { select: { nome: true } } },
  });
  if (!c) notFound();
  const podeCadastro = pode(user.permissoes, "equipes", "visualizar", user.role);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={c.nome}
        description={`${c.cargo?.nome ?? LABELS_FUNCAO[c.tipo] ?? c.tipo} · dados financeiros / folha${c.ativo ? "" : " · inativo"}`}
        backHref="/financeiro/custo-pessoal"
        actions={podeCadastro ? <Link href={`/colaboradores/${c.id}/editar`} className="btn-secondary text-sm">Cadastro completo</Link> : undefined}
      />
      <div className="bg-white rounded-2xl shadow-card border border-surface-border p-5 sm:p-6 lg:p-8">
        <FolhaColaborador colaboradorId={c.id} />
      </div>
    </div>
  );
}
