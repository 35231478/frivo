import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { ContratoForm } from "@/components/forms/contrato-form";
import { prisma } from "@/lib/prisma";
import { rotuloDaJornada } from "@/lib/atendimento/prazo";
import { jornadaDaEmpresa } from "@/lib/atendimento/prazo-server";

export const metadata: Metadata = { title: "Novo contrato" };

/**
 * Quem abre o formulário é quem pode criar contrato ("Contratos › criar") — a mesma permissão que
 * o POST /api/contratos exige. Sem ela, a pessoa preenchia as cinco abas e só descobria no 403.
 */
export default async function NovoContratoPage() {
  const session = await auth();
  if (!pode(session!.user!.permissoes, "contratos", "criar", session!.user!.role)) redirect("/sem-permissao");
  const horarioComercial = rotuloDaJornada(await jornadaDaEmpresa(prisma, session!.user!.empresaId));
  return (
    <Suspense>
      <ContratoForm horarioComercial={horarioComercial} />
    </Suspense>
  );
}
