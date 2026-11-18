import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { horarioDe } from "@/lib/atendimento/prazo";
import { jornadaDaEmpresa } from "@/lib/atendimento/prazo-server";
import { PageHeader } from "@/components/ui/page-header";
import { HorarioComercialClient } from "@/components/config/horario-comercial-client";

/** Configurações › Operacionais › Horário comercial (rota protegida por Configurações › visualizar). */
export async function TelaHorarioComercial() {
  const session = await auth();
  const u = session!.user!;
  const inicial = horarioDe(await jornadaDaEmpresa(prisma, u.empresaId));
  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Horário comercial"
        description="Dias e horas de expediente da empresa"
        dica="Usado no prazo de atendimento dos contratos marcados como “contar só em horário comercial”: fora do expediente o relógio do prazo para. Feriados não entram aqui."
        backHref="/configuracoes/operacionais"
      />
      <HorarioComercialClient inicial={inicial} podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)} />
    </div>
  );
}
