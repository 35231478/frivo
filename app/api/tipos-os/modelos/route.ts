import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { TIPOS_OS_PADRAO, faltando } from "@/lib/empresa/padroes";
import { completarPadroesDaEmpresa } from "@/lib/empresa/criar-empresa";

/**
 * "Usar modelos sugeridos" (Configurações › Tipos de OS): os tipos de OS de climatização que a
 * empresa ainda não tem (pelo nome). GET diz quais faltam e quantos tipos a empresa já tem (a tela só
 * oferece quando não tem nenhum); POST cria só os que faltam — os que já existem
 * (mesmo nome, sem olhar acento e caixa) ficam como estão. Mesma permissão de gravar tipos de OS.
 */
export async function GET() {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const existentes = await prisma.tipoOs.findMany({ where: { empresaId: guard.session.user!.empresaId }, select: { nome: true } });
  return NextResponse.json({ total: existentes.length, faltando: faltando(TIPOS_OS_PADRAO, existentes).map((t) => ({ nome: t.nome, exigeEquipamento: t.exigeEquipamento })) });
}

export async function POST() {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { tiposOs } = await completarPadroesDaEmpresa(prisma, guard.session.user!.empresaId, { tiposOs: true });
  return NextResponse.json({ criados: tiposOs });
}
