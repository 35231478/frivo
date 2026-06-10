import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import crypto from "crypto";
import { exigirPermissao } from "@/lib/permissoes-server";
import { criptografar } from "@/lib/crypto";
import { testarConexaoInter } from "@/lib/inter-api";

const schema = z.object({
  ativo: z.boolean().optional(),
  ambiente: z.enum(["SANDBOX", "PRODUCAO"]).optional(),
  clientId: z.string().optional().nullable(),
  contaCorrente: z.string().optional().nullable(),
  pixChave: z.string().optional().nullable(),
  // Segredos: só atualizam quando enviados (não vazios)
  clientSecret: z.string().optional().nullable(),
  certificado: z.string().optional().nullable(),
  chavePrivada: z.string().optional().nullable(),
});

/** Retorna a config mascarada (sem segredos). */
export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const reg = await prisma.integracaoInter.findUnique({ where: { empresaId } });
  return NextResponse.json({
    ativo: reg?.ativo ?? false,
    ambiente: reg?.ambiente ?? "SANDBOX",
    clientId: reg?.clientId ?? "",
    contaCorrente: reg?.contaCorrente ?? "",
    pixChave: reg?.pixChave ?? "",
    temClientSecret: !!reg?.clientSecret,
    temCertificado: !!reg?.certificado,
    temChavePrivada: !!reg?.chavePrivada,
    webhookSecret: reg?.webhookSecret ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  const atual = await prisma.integracaoInter.findUnique({ where: { empresaId } });

  const data: any = {
    ativo: d.ativo ?? atual?.ativo ?? false,
    ambiente: d.ambiente ?? atual?.ambiente ?? "SANDBOX",
    clientId: d.clientId ?? atual?.clientId ?? null,
    contaCorrente: d.contaCorrente ?? atual?.contaCorrente ?? null,
    pixChave: d.pixChave ?? atual?.pixChave ?? null,
    webhookSecret: atual?.webhookSecret ?? crypto.randomBytes(16).toString("hex"),
  };
  // Segredos: criptografa apenas quando um novo valor é enviado
  if (d.clientSecret) data.clientSecret = criptografar(d.clientSecret);
  if (d.certificado) data.certificado = criptografar(d.certificado);
  if (d.chavePrivada) data.chavePrivada = criptografar(d.chavePrivada);

  await prisma.integracaoInter.upsert({
    where: { empresaId },
    create: { empresaId, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
}

/** Testa a conexão com as credenciais salvas. */
export async function POST() {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const resultado = await testarConexaoInter(guard.session.user.empresaId);
  return NextResponse.json(resultado);
}
