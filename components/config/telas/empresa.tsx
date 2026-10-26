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

  const tecnicosRt = parte === "empresa"
    ? await prisma.tecnico.findMany({
        where: { empresaId, tipo: "RESPONSAVEL_TECNICO" },
        select: { id: true, nome: true, crea: true, ativo: true },
        orderBy: { nome: "asc" },
      })
    : [];

  // Decimal não atravessa para o cliente: vai como número
  return <ConfiguracoesClient empresa={empresa!} config={{ ...config, issAliquota: Number(config.issAliquota) }} parte={parte} tecnicosRt={tecnicosRt} />;
}
