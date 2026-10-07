import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { clienteSchema } from "@/lib/validations";
import { contatoSeguro } from "@/lib/contato-cliente";
import { definirAtivoCliente } from "@/lib/acoes-massa/regras";

type Params = { params: Promise<{ id: string }> };

async function getClienteTenant(id: string, empresaId: string) {
  return prisma.cliente.findFirst({ where: { id, empresaId } });
}

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "visualizar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      contatosCliente: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      interacoes: { include: { usuario: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "desc" }, take: 50 },
      _count: { select: { contratos: true } },
    },
  });
  if (!cliente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json({ ...cliente, contatosCliente: cliente.contatosCliente.map(contatoSeguro) });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await getClienteTenant(id, empresaId);
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = clienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Inativar pela edição completa exige "excluir", como no DELETE e no PATCH.
  if (existente.ativo && parsed.data.ativo === false
    && !pode(session.user!.permissoes, "clientes", "excluir", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });

  if (parsed.data.cpfCnpj !== existente.cpfCnpj) {
    const dup = await prisma.cliente.findUnique({
      where: { cpfCnpj_empresaId: { cpfCnpj: parsed.data.cpfCnpj, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "CPF/CNPJ já cadastrado" }, { status: 409 });
  }

  const { responsavelTecnicoId, segmento, origem, satisfacao, ...resto } = parsed.data;
  // Tabela de preço e responsável técnico precisam ser da mesma empresa; tabela NOVA precisa estar
  // ativa (manter a que o cliente já usa, mesmo inativa, é aceito)
  try {
    await Promise.all([
      validarRefEmpresa("tabelaPreco", resto.tabelaPrecoId, empresaId, "Tabela de preço", { novoAtivo: true, manter: [existente.tabelaPrecoId] }),
      validarRefEmpresa("tecnico", responsavelTecnicoId, empresaId, "Responsável técnico"),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const atualizado = await prisma.cliente.update({
    where: { id },
    data: {
      ...resto,
      responsavelTecnicoId: responsavelTecnicoId || null,
      segmento: segmento || null,
      origem: origem || null,
      satisfacao: satisfacao ?? null,
    },
  });
  return NextResponse.json(atualizado);
}

// Alteração pontual de status (ativo/inativo) sem mexer no restante do cadastro.
// Inativar é um soft-delete: apenas `ativo` muda; todo o histórico é preservado.
// Reativar exige "editar"; inativar exige também "excluir" (mesma regra do DELETE).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await getClienteTenant(id, empresaId);
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.ativo !== "boolean") {
    return NextResponse.json({ erro: "Campo 'ativo' (boolean) é obrigatório." }, { status: 400 });
  }
  if (body.ativo === false && !pode(session.user!.permissoes, "clientes", "excluir", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });

  await definirAtivoCliente(id, body.ativo, { empresaId, usuarioId: session.user!.id, usuarioNome: session.user!.name ?? "usuário" });
  return NextResponse.json({ ok: true, ativo: body.ativo });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "excluir", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await getClienteTenant(id, empresaId);
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  await definirAtivoCliente(id, false, { empresaId, usuarioId: session.user!.id, usuarioNome: session.user!.name ?? "usuário" });
  return NextResponse.json({ ok: true });
}
