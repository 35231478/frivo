import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConfiguracoesClient } from "@/components/forms/configuracoes-client";

/** Configurações › Conta › Dados da empresa / Preferências (a mesma tela, um bloco em cada cartão). */
export async function TelaEmpresa({ parte }: { parte: "empresa" | "preferencias" }) {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  let config = await prisma.configuracao.findUnique({ where: { empresaId } });
  if (!config) {
    config = await prisma.configuracao.create({ data: { empresaId } });
  }

  return <ConfiguracoesClient empresa={empresa!} config={config} parte={parte} />;
}
