import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prepararExecucao } from "@/lib/os/abertura";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { gerarOsDoOrcamento, osDoOrcamento } from "@/lib/orcamentos/gerar-os-server";

/**
 * "Gerar OS" a partir do orçamento aprovado. Permissão: criar OS. Empresa da sessão.
 * GET: a OS do orçamento (gerada ou vinculada), se houver.
 * POST { execucao }: cria a OS com cliente, endereço e itens do orçamento — ou devolve a que já
 * existe (jaExistia), nunca uma segunda.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  return NextResponse.json({ os: await osDoOrcamento(guard.session.user!.empresaId, id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("ordens", "criar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;
  const usuarioId = guard.session.user!.id;
  const body = await req.json().catch(() => ({}));

  // Já tem OS: leva até ela antes de qualquer outra validação (clique repetido, outra aba)
  const ja = await osDoOrcamento(empresaId, id);
  if (ja) return NextResponse.json({ os: { id: ja.id, numero: ja.numero }, jaExistia: true });

  const prep = await prepararExecucao(empresaId, body?.execucao);
  if ("erro" in prep) return NextResponse.json({ erro: prep.erro }, { status: 400 });

  const r = await gerarOsDoOrcamento({ empresaId, usuarioId, orcamentoId: id, execucao: prep.execucao });
  if (r.tipo === "nao-encontrado") return NextResponse.json({ erro: "Orçamento não encontrado." }, { status: 404 });
  if (r.tipo === "bloqueado") return NextResponse.json({ erro: r.erro }, { status: 409 });
  if (r.tipo === "existente") return NextResponse.json({ os: r.os, jaExistia: true });
  // A 1ª atividade com data já põe a OS em "Agendada" (central da OS)
  await sincronizarStatusOs(r.os.id, empresaId, usuarioId);
  return NextResponse.json({ os: r.os, jaExistia: false }, { status: 201 });
}
