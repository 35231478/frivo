import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SELECT_PMOC } from "@/lib/pmoc-server";
import { PmocEditor, type PmocDados } from "@/components/pmoc/pmoc-editor";
import { serializarPmoc } from "@/lib/pmoc";
import { avisoDoPlano } from "@/lib/pmoc-avisos";
import { configPmoc, destinoDoCliente } from "@/lib/pmoc-documento-server";

export const metadata: Metadata = { title: "PMOC" };

export default async function PmocPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string; copia?: string; criado?: string }>;
}) {
  const { id } = await params;
  const { aba, copia, criado } = await searchParams;
  const session = await auth();
  // O middleware já exige pmoc.visualizar para /pmoc/*; editar/criar são checados na tela e no servidor
  const empresaId = session!.user!.empresaId;
  const [pmoc, config] = await Promise.all([prisma.pmoc.findFirst({ where: { id, empresaId }, select: SELECT_PMOC }), configPmoc(empresaId)]);
  if (!pmoc) notFound();
  const dados = serializarPmoc<PmocDados>(JSON.parse(JSON.stringify(pmoc)));
  const destino = await destinoDoCliente(pmoc.clienteId, empresaId);
  // O aviso de vencimento de hoje já teve ciência? (aí não aparece mais no cabeçalho do plano)
  const aviso = avisoDoPlano(pmoc, config.diasAviso);
  const ciente = aviso ? await prisma.pmocAviso.findFirst({ where: { pmocId: pmoc.id, tipo: aviso.tipo, dataExpiracao: pmoc.dataExpiracao, vistoEm: { not: null } }, select: { id: true } }) : null;
  return (
    <div className="max-w-5xl mx-auto">
      <PmocEditor key={`${pmoc.id}-${pmoc.ativo}`} inicial={dados} abaInicial={aba} copiaRecente={copia === "1"} criadoRecente={criado === "1"} config={config} avisoCiente={ciente && aviso ? aviso.tipo : null} destino={destino} />
    </div>
  );
}
