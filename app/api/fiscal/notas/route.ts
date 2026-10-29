import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { osJaFaturada } from "@/lib/faturamento-os";
import { emitirNotas, ErroEmissao, listarNotas, previaEmissao } from "@/lib/nfse/emissao-server";

/**
 * NFS-e da medição (ou da OS concluída, pela medição dela).
 *   GET  ?medicaoId=… | ?osId=…  [&previa=1]  as notas (e, com previa, o que falta e as notas que vão sair)
 *   POST { medicaoId, origem, ordemServicoId?, discriminacoes? }  emite (Financeiro › Fiscal)
 * Ver: Fiscal ou Medições. Empresa sempre a da sessão; id de outra empresa = 404.
 */
const VER: [string, "fiscal" | "medicoes"][] = [["financeiro", "fiscal"], ["financeiro", "medicoes"]];

function erro(e: unknown) {
  if (e instanceof ErroEmissao) return NextResponse.json({ erro: e.message, ...(e.pendencias ? { pendencias: e.pendencias } : {}) }, { status: e.status });
  throw e;
}

export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao(VER);
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const empresaId = user.empresaId;
  const sp = req.nextUrl.searchParams;
  const osId = sp.get("osId");
  let medicaoId = sp.get("medicaoId");
  if (!medicaoId && !osId) return NextResponse.json({ erro: "Informe a medição ou a OS." }, { status: 400 });

  if (osId) {
    const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, status: true } });
    if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
    medicaoId = (await osJaFaturada(os.id))?.id ?? null;
  } else {
    const existe = await prisma.medicao.count({ where: { id: medicaoId!, empresaId } });
    if (!existe) return NextResponse.json({ erro: "Medição não encontrada" }, { status: 404 });
  }
  const podeEmitir = pode(user.permissoes as Permissoes, "financeiro", "fiscal", user.role);
  try {
    const notas = await listarNotas(empresaId, osId ? { ordemServicoId: osId } : { medicaoId: medicaoId! });
    const previa = sp.get("previa") === "1" && medicaoId ? await previaEmissao(empresaId, medicaoId) : null;
    return NextResponse.json({ medicaoId, podeEmitir, notas, previa });
  } catch (e) { return erro(e); }
}

const schema = z.object({
  medicaoId: z.string().min(1).max(40),
  origem: z.enum(["OS", "MEDICAO"]),
  ordemServicoId: z.string().max(40).nullish(),
  discriminacoes: z.record(z.string().max(500), z.string().max(4000)).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Requisição inválida" }, { status: 400 });
  const { medicaoId, ...opcoes } = parsed.data;
  try {
    const resultado = await emitirNotas({ id: user.id, empresaId: user.empresaId }, medicaoId, opcoes);
    return NextResponse.json({ notas: resultado }, { status: 201 });
  } catch (e) { return erro(e); }
}
