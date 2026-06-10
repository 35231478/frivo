import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { criptografar } from "@/lib/crypto";
import { enviarEmailTeste } from "@/lib/email";

const bool = z.boolean().optional();
const int = z.number().int().positive().optional();
const schema = z.object({
  ativo: bool, apiKey: z.string().optional().nullable(),
  remetente: z.string().optional().nullable(), nomeRemetente: z.string().optional().nullable(), replyTo: z.string().optional().nullable(),
  notifBoletoEmitido: bool, notifMedicaoGerada: bool, notifLembreteVencimento: bool, notifConfirmacaoPagamento: bool,
  notifCobrancaVencida: bool, notifOsAberta: bool, notifOsConcluida: bool, notifOrcamentoEnviado: bool, notifContratoAssinatura: bool,
  lembreteOrcNaoRespondido: bool, lembreteOrcVencendo: bool, lembreteOrcVencido: bool, lembreteOrcAprovadoSemOs: bool, pararSeVisualizado: bool,
  diasLembreteVencimento: int, diasLembreteOrcamento: int, diasLembreteOrcamentoVencendo: int, diasAposAprovacaoSemOs: int, maxLembretesOrcamento: int,
});

export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const cfg = await prisma.emailConfig.findUnique({ where: { empresaId: guard.session.user.empresaId } });
  if (!cfg) return NextResponse.json({ ativo: false, temApiKey: false });
  const { apiKey, ...resto } = cfg;
  return NextResponse.json({ ...resto, apiKey: undefined, temApiKey: !!apiKey });
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const { apiKey, ...resto } = parsed.data;

  const data: any = { ...resto };
  if (apiKey) data.apiKey = criptografar(apiKey);

  await prisma.emailConfig.upsert({ where: { empresaId }, create: { empresaId, ...data }, update: data });
  return NextResponse.json({ ok: true });
}

/** Envia e-mail de teste para o e-mail informado (ou do admin logado). */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const body = await req.json().catch(() => ({}));
  const para = body.para || guard.session.user.email;
  if (!para) return NextResponse.json({ ok: false, erro: "Informe um e-mail de destino." });
  const r = await enviarEmailTeste(guard.session.user.empresaId, para);
  return NextResponse.json(r);
}
