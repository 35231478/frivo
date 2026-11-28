import type { Metadata } from "next";
import { ProtegerSaida } from "@/components/ui/proteger-saida";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { ContratoForm } from "@/components/forms/contrato-form";
import { rotuloDaJornada } from "@/lib/atendimento/prazo";
import { jornadaDaEmpresa } from "@/lib/atendimento/prazo-server";

export const metadata: Metadata = { title: "Editar contrato" };

/**
 * Quem só tem "Contratos › visualizar" abre a ficha em somente leitura: lê as cinco abas e não
 * encontra Salvar nem o menu de status — o PUT e o PATCH exigem "Contratos › editar" e recusariam.
 * Antes, a tela oferecia tudo a todo mundo e a pessoa só descobria no 403, com o preenchimento perdido.
 */
export default async function EditarContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const podeEditar = pode(session!.user!.permissoes, "contratos", "editar", session!.user!.role);
  const podeVer = podeEditar || pode(session!.user!.permissoes, "contratos", "visualizar", session!.user!.role);
  if (!podeVer) redirect("/sem-permissao");
  const empresaId = session!.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: { include: { unidade: true } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      reajustes: { orderBy: { data: "desc" }, include: { usuario: { select: { nome: true } } } },
      historicoStatus: { include: { usuario: { select: { id: true, nome: true } } }, orderBy: { createdAt: "desc" } },
      recorrenciasLocais: true,
      prazosAtendimento: { select: { prioridade: true, comparecerHoras: true, resolverHoras: true, soHorarioComercial: true } },
    },
  });
  if (!contrato) notFound();
  const horarioComercial = rotuloDaJornada(await jornadaDaEmpresa(prisma, empresaId));

  return <ProtegerSaida><ContratoForm initialData={contrato} somenteLeitura={!podeEditar} horarioComercial={horarioComercial} /></ProtegerSaida>;
}
