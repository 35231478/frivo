import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { normalizarCnae } from "@/lib/nfse/servico";

const textoBanco = (max: number) =>
  z.string().trim().max(max).transform((v) => v || null).optional().nullable();

const empresaUpdateSchema = z.object({
  nome: z.string().min(2).optional(),
  nomeFantasia: z.string().optional(),
  cnpj: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  celular: z.string().optional(),
  site: z.string().optional(),
  logo: z.string().optional().nullable(),
  endereco: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  cep: z.string().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  // Dados bancários (saem no orçamento do cliente). Vazio = sem o campo.
  bancoNome: textoBanco(80),
  bancoAgencia: textoBanco(20),
  bancoConta: textoBanco(30),
  bancoTipoConta: textoBanco(30),
  bancoTitular: textoBanco(120),
  pixChave: textoBanco(120),
  // Timbre do orçamento: inscrições e responsável técnico padrão (vazio = sem)
  inscricaoEstadual: textoBanco(30),
  inscricaoMunicipal: textoBanco(30),
  // CNAE principal: aceita "4321-5/00", grava os 7 dígitos (vazio = sem). Alterar exige Financeiro › Fiscal.
  cnaePrincipal: z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
    if (v === undefined) return undefined;
    const r = normalizarCnae(v);
    if (r.erro) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.erro }); return z.NEVER; }
    return r.cnae;
  }),
  responsavelTecnicoId: z.string().trim().transform((v) => v || null).optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresa = await prisma.empresa.findUnique({
    where: { id: session.user!.empresaId },
    select: {
      id: true, nome: true, nomeFantasia: true, cnpj: true, email: true,
      telefone: true, celular: true, site: true, logo: true,
      endereco: true, numero: true, complemento: true, bairro: true,
      cidade: true, estado: true, cep: true, latitude: true, longitude: true,
      bancoNome: true, bancoAgencia: true, bancoConta: true, bancoTipoConta: true, bancoTitular: true, pixChave: true,
      inscricaoEstadual: true, inscricaoMunicipal: true, cnaePrincipal: true, responsavelTecnicoId: true,
      plano: true,
    },
  });

  return NextResponse.json(empresa);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Permissão, não role: quem tem "Configurações > Gerenciar" no perfil também pode (I5)
  if (!pode(session.user!.permissoes, "configuracoes", "gerenciar", session.user!.role)) {
    return NextResponse.json({ erro: "Sem permissão para alterar configurações." }, { status: 403 });
  }

  const body = await req.json();
  const parsed = empresaUpdateSchema.safeParse(body);
  if (!parsed.success) {
    const cnae = parsed.error.flatten().fieldErrors.cnaePrincipal?.[0];
    return NextResponse.json({ erro: cnae ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // CNAE principal é dado fiscal (vai nas notas de todos os serviços sem CNAE próprio): mudar exige o Fiscal
  if (parsed.data.cnaePrincipal !== undefined && !pode(session.user!.permissoes, "financeiro", "fiscal", session.user!.role)) {
    const atual = await prisma.empresa.findUnique({ where: { id: session.user!.empresaId }, select: { cnaePrincipal: true } });
    if ((atual?.cnaePrincipal ?? null) !== parsed.data.cnaePrincipal) {
      return NextResponse.json({ erro: "Sem permissão para alterar o CNAE principal. Exige a permissão Financeiro › Fiscal (NFS-e)." }, { status: 403 });
    }
  }

  // RT padrão: um responsável técnico (com CREA) DESTA empresa; trocar exige que esteja ativo
  const rt = parsed.data.responsavelTecnicoId;
  if (rt) {
    const ok = await prisma.tecnico.count({
      where: { id: rt, empresaId: session.user!.empresaId, tipo: "RESPONSAVEL_TECNICO", ativo: true },
    });
    const atual = await prisma.empresa.findUnique({ where: { id: session.user!.empresaId }, select: { responsavelTecnicoId: true } });
    if (!ok && atual?.responsavelTecnicoId !== rt) {
      return NextResponse.json({ erro: "Responsável técnico inválido: escolha um responsável técnico ativo da empresa." }, { status: 400 });
    }
  }

  const empresa = await prisma.empresa.update({
    where: { id: session.user!.empresaId },
    data: parsed.data,
  });

  return NextResponse.json(empresa);
}
