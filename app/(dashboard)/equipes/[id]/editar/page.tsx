import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pode } from "@/lib/permissoes";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { EquipeForm } from "@/components/forms/equipe-form";

export const metadata: Metadata = { title: "Editar Equipe" };

export default async function EditarEquipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  // Editar exige "gerenciar"; quem só visualiza vê as equipes no montador (somente leitura)
  if (!pode(session!.user!.permissoes, "equipes", "gerenciar", session!.user!.role)) redirect("/equipes/montador");

  const equipe = await prisma.equipe.findFirst({
    where: { id, empresaId },
    include: { membros: { select: { id: true, nome: true } }, veiculos: { select: { id: true, placa: true } } },
  });
  if (!equipe) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Editar Equipe" description={equipe.nome} backHref="/equipes"
        actions={<InativarRegistro url={`/api/equipes/${equipe.id}`} modulo="equipes" acaoReativar="gerenciar" variante="botao" ativo={equipe.status === "ATIVA"} nome={equipe.nome} entidade="equipe" feminino />}
      />
      {equipe.status !== "ATIVA" && (
        <div data-aviso-inativo className="mb-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-4 py-3 text-sm">
          Esta equipe está <strong>inativa</strong> e não aparece na lista padrão. Use “Reativar” para voltar a usá-la.
        </div>
      )}
      <EquipeForm key={equipe.status} initialData={equipe} />
    </div>
  );
}
