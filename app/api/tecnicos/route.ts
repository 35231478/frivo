import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validarFoto } from "@/lib/anexos-server";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { tecnicoSchema } from "@/lib/validations";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import type { Acao } from "@/lib/permissoes";

/**
 * Quem pode LISTAR os colaboradores (nome, telefone, CREA): as telas que têm um seletor de colaborador.
 * Cada par é um chamador conferido — Equipes (cadastro de equipe), Ordens (seletor de execução da OS,
 * Gerar OS do orçamento), Calendário (agenda), PMOC e Contratos (responsável técnico, técnico da
 * recorrência), Veículos (responsável) e Financeiro (conta a pagar de um colaborador). Sem nenhuma
 * delas, a lista não sai (antes bastava estar logado).
 */
const PERMISSOES_LISTAR_COLABORADORES: [string, Acao][] = [
  ["equipes", "visualizar"], ["ordens", "visualizar"], ["calendario", "visualizar"], ["pmoc", "visualizar"],
  ["contratos", "visualizar"], ["veiculos", "visualizar"], ["financeiro", "visualizar"], ["orcamentos", "visualizar"],
];

export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao(PERMISSOES_LISTAR_COLABORADORES);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo");
  const tipoOsId = searchParams.get("tipoOsId");

  const tecnicos = await prisma.tecnico.findMany({
    where: {
      empresaId,
      ativo: true,
      ...(tipo && { tipo: tipo as any }),
      ...(tipoOsId && { competencias: { some: { id: tipoOsId } } }),
    },
    orderBy: { nome: "asc" },
    select: {
      id: true, nome: true, telefone: true, especialidades: true, tipo: true, crea: true, avatar: true,
      competencias: { select: { id: true } },
      veiculoId: true,
    },
  });

  return NextResponse.json(tecnicos);
}

export async function POST(req: NextRequest) {
  // Cadastrar colaborador (inclusive pelo cadastro rápido) exige "Equipes / Colaboradores › gerenciar"
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = tecnicoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const existente = await prisma.tecnico.findUnique({
    where: { cpf_empresaId: { cpf: parsed.data.cpf, empresaId } },
  });
  if (existente) return NextResponse.json({ erro: "CPF já cadastrado" }, { status: 409 });

  const { competenciaIds, dataNascimento, dataAdmissao, cargoId, perfilAcessoId, email, veiculoId, ...rest } = parsed.data;
  // Veículo padrão (opcional) precisa ser da mesma empresa
  if (veiculoId && !(await prisma.veiculo.findFirst({ where: { id: veiculoId, empresaId }, select: { id: true } })))
    return NextResponse.json({ erro: "Veículo inválido." }, { status: 400 });
  // Cargo, perfil de acesso e competências (tipos de OS) precisam ser da mesma empresa
  try {
    await Promise.all([
      validarRefEmpresa("cargo", cargoId, empresaId, "Cargo", { novoAtivo: true }),
      validarRefEmpresa("perfilAcesso", perfilAcessoId, empresaId, "Perfil de acesso", { novoAtivo: true }),
      validarRefsEmpresa("tipoOs", competenciaIds, empresaId, "Competência"),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  // Avatar: tipo decidido pelos BYTES; grava o data URL normalizado
  if (rest.avatar) {
    const r = validarFoto(rest.avatar);
    if (!r.ok) return NextResponse.json({ erro: `Foto do colaborador: ${r.erro}` }, { status: 400 });
    rest.avatar = r.arquivo.conteudo;
  }
  const tecnico = await prisma.tecnico.create({
    data: {
      ...rest,
      empresaId,
      email: email || null,
      cargoId: cargoId || null,
      perfilAcessoId: perfilAcessoId || null,
      veiculoId: veiculoId || null,
      dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
      dataAdmissao: dataAdmissao ? new Date(dataAdmissao) : null,
      competencias: { connect: competenciaIds.map((id) => ({ id })) },
      // Documentos: só depois de o colaborador existir, pela rota própria — é lá que fica o
      // registro de quem anexou.
    },
  });

  // Salário só pela seção de folha (financeiro.folha): não volta na resposta do cadastro geral
  const { salario: _, ...resposta } = tecnico;
  return NextResponse.json(resposta, { status: 201 });
}
