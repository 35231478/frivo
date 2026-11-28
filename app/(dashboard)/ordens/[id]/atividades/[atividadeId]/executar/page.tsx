import type { Metadata } from "next";
import { noEscopo } from "@/lib/escopo/proprios-server";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AtividadeExecucao } from "@/components/os/atividade-execucao";

export const metadata: Metadata = { title: "Executar atividade" };

export default async function ExecutarAtividadePage({ params }: { params: Promise<{ id: string; atividadeId: string }> }) {
  const { id, atividadeId } = await params;
  const session = await auth();
  // COM-1: "Ver só os próprios" — o registro de outro vendedor não existe para esta pessoa
  if (session?.user && !(await noEscopo(session.user, "ordem", id))) notFound();
  const empresaId = session!.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: {
      id: true,
      titulo: true,
      status: true,
      tipoOs: { select: { id: true, nome: true, cor: true } },
      ordemServico: { select: { id: true, numero: true } },
    },
  });
  if (!atividade) notFound();

  return (
    <AtividadeExecucao
      osId={id}
      atividadeId={atividadeId}
      titulo={atividade.titulo}
      osNumero={atividade.ordemServico.numero}
      tipoOs={atividade.tipoOs}
    />
  );
}
