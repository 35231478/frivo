import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Apoio à seção "Dados fiscais (NFS-e)" do cadastro de serviço: o CNAE principal e o ISS da empresa
 * (o que o serviço herda quando fica vazio) e os códigos municipais já usados nos serviços (para a
 * busca). Só leitura, só a empresa da sessão; quem vê o cadastro de serviços (basta estar logado) vê.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user.empresaId;
  const [empresa, config, servicos] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { cnaePrincipal: true } }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
    prisma.servico.findMany({
      where: { empresaId, codigoMunicipal: { not: null } }, select: { codigoMunicipal: true, nome: true }, orderBy: { nome: "asc" }, take: 2000,
    }),
  ]);
  return NextResponse.json({
    cnaeEmpresa: empresa?.cnaePrincipal ?? null,
    issEmpresa: config?.issAliquota != null ? Number(config.issAliquota) : null,
    servicos,
  });
}
