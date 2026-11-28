import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { emailDeLoginEmUso, MSG_EMAIL_LOGIN_EM_USO } from "@/lib/acesso/email-unico";
import { validarFoto } from "@/lib/anexos-server";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { tecnicoSchema } from "@/lib/validations";
import { Prisma } from "@prisma/client";
import { jornadaDoCorpo } from "@/lib/colaborador/jornada";
import { caixaNome } from "@/lib/texto/zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { impactoColaborador, lerMotivo } from "@/lib/inativacao-server";
import { definirAtivoCadastro, inativarColaborador, reativarColaborador, statusHttp, verificarAtivoCadastro } from "@/lib/acoes-massa/regras";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  // Ficha completa (CPF/RG): só quem gerencia colaboradores. Os DOCUMENTOS têm rota própria
  // (/api/tecnicos/[id]/documentos) e não voltam aqui: o arquivo de cada um é grande e esta
  // resposta serve ao cadastro rápido. O salário só vai junto
  // para quem tem "Financeiro › Custo de pessoal". Seletores de técnico usam GET /api/tecnicos.
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const tecnico = await prisma.tecnico.findFirst({
    where: { id, empresaId },
    include: {
      competencias: { select: { id: true } },
    },
  });
  if (!tecnico) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(semSalario(tecnico, session));
}

/** Remove o salário da resposta para quem não tem a permissão de folha. */
function semSalario<T extends { salario?: unknown }>(t: T, session: { user?: { permissoes?: any; role?: string } | null }) {
  if (pode(session.user?.permissoes, "financeiro", "folha", session.user?.role)) return t;
  const { salario: _, ...resto } = t;
  return resto;
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Editar colaborador exige "Equipes / Colaboradores › gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = (session.user as any).empresaId as string;

  const existente = await prisma.tecnico.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = tecnicoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cpf !== existente.cpf) {
    const dup = await prisma.tecnico.findUnique({
      where: { cpf_empresaId: { cpf: parsed.data.cpf, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "CPF já cadastrado" }, { status: 409 });
  }

  const { competenciaIds, dataNascimento, dataAdmissao, cargoId, perfilAcessoId, email, veiculoId, jornadaFaixas, jornadaEntrada, jornadaSaida, jornadaDias, ...rest } = parsed.data;
  // Leva J: a jornada em faixas (ou, de um cliente antigo, os campos antigos)
  const jornada = jornadaDoCorpo({ jornadaFaixas, jornadaEntrada, jornadaSaida, jornadaDias });
  // Veículo padrão (opcional): só muda quando enviado; precisa ser da mesma empresa
  if (veiculoId && !(await prisma.veiculo.findFirst({ where: { id: veiculoId, empresaId }, select: { id: true } })))
    return NextResponse.json({ erro: "Veículo inválido." }, { status: 400 });
  // Cargo, perfil de acesso e competências (tipos de OS) precisam ser da mesma empresa
  try {
    await Promise.all([
      validarRefEmpresa("cargo", cargoId, empresaId, "Cargo", { novoAtivo: true, manter: [existente.cargoId] }),
      validarRefEmpresa("perfilAcesso", perfilAcessoId, empresaId, "Perfil de acesso", { novoAtivo: true, manter: [existente.perfilAcessoId] }),
      validarRefsEmpresa("tipoOs", competenciaIds, empresaId, "Competência"),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  // Avatar e documentos: tipo decidido pelos BYTES; grava o data URL normalizado
  if (rest.avatar) {
    const r = validarFoto(rest.avatar);
    if (!r.ok) return NextResponse.json({ erro: `Foto do colaborador: ${r.erro}` }, { status: 400 });
    rest.avatar = r.arquivo.conteudo;
  }
  // O login do app acompanha o e-mail do colaborador (o vínculo é por e-mail). Se o e-mail muda e há um
  // usuário ligado ao antigo, ele é renomeado junto — e o novo não pode ser login de outro usuário do Frivo
  // (de qualquer empresa: lib/acesso/email-unico). Confere ANTES de gravar: nada muda se não der.
  const emailAntigo = (existente.email ?? "").trim();
  const emailNovo = (email ?? "").trim();
  const login = emailNovo && emailAntigo && emailNovo.toLowerCase() !== emailAntigo.toLowerCase()
    ? await prisma.usuario.findFirst({ where: { empresaId, email: { equals: emailAntigo, mode: "insensitive" } }, select: { id: true } })
    : null;
  if (login && await emailDeLoginEmUso(emailNovo, login.id)) return NextResponse.json({ erro: MSG_EMAIL_LOGIN_EM_USO }, { status: 409 });

  // Status "Inativo" no formulário = inativar o colaborador pela MESMA função do botão e da ação em
  // massa (impacto/bloqueio, motivo e anotação nas observações; exige "excluir"). Sair de "Inativo"
  // = reativar pela mesma função. `ativo` só muda por essas funções.
  const u = session.user!;
  const ctxStatus = { empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", motivo: lerMotivo({ motivo: body?.motivoInativacao }), role: u.role, permissoes: u.permissoes as Permissoes };
  const virandoInativo = rest.statusColaborador === "INATIVO" && existente.ativo;
  const saindoDeInativo = rest.statusColaborador !== "INATIVO" && (!existente.ativo || existente.statusColaborador === "INATIVO");
  if (virandoInativo) {
    if (!pode(u.permissoes, "equipes", "excluir", u.role))
      return NextResponse.json({ erro: "Sem permissão para inativar colaboradores" }, { status: 403 });
    const impacto = await impactoColaborador(id, empresaId);
    if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });
  }
  if (saindoDeInativo) {
    const r = await reativarColaborador(id, ctxStatus);
    if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: statusHttp(r) });
  }

  const atualizado = await prisma.tecnico.update({
    where: { id },
    data: {
      ...rest,
      ...jornada, jornadaFaixas: jornada.jornadaFaixas ?? Prisma.DbNull,
      email: email || null,
      cargoId: cargoId || null,
      perfilAcessoId: perfilAcessoId || null,
      ...(veiculoId !== undefined && { veiculoId: veiculoId || null }),
      dataNascimento: dataNascimento ? new Date(dataNascimento) : null,
      dataAdmissao: dataAdmissao ? new Date(dataAdmissao) : null,
      competencias: { set: competenciaIds.map((cid) => ({ id: cid })) },
      // Os DOCUMENTOS não entram aqui. Até esta leva, salvar a ficha fazia `deleteMany` e recriava
      // a lista inteira: perdia a data de envio e o id de cada arquivo, e apagava sem rastro o que
      // o colaborador tivesse mandado pela admissão depois de a tela ter carregado. Cada documento
      // agora tem a sua própria rota (anexar, baixar, excluir com rastro) — salvar o cadastro não
      // mexe nos papéis da pessoa.
    },
  });
  // Renomeia o login junto (evita um login órfão no e-mail velho); a unicidade já foi conferida acima
  if (login) await prisma.usuario.update({ where: { id: login.id }, data: { email: emailNovo } });
  if (virandoInativo) {
    const r = await inativarColaborador(id, ctxStatus);
    if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: statusHttp(r) });
    return NextResponse.json(semSalario({ ...atualizado, ativo: false, statusColaborador: "INATIVO" as const }, session));
  }
  return NextResponse.json(semSalario(atualizado, session));
}

/**
 * Inativa o colaborador — soft-delete (ativo=false + status INATIVO). Atividades, OS,
 * equipes e histórico ficam preservados; ele sai das listas e dos seletores.
 * Exige "excluir" do módulo Equipes/Colaboradores. Body opcional: { motivo }.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const corpo = await req.json().catch(() => ({}));
  const motivo = lerMotivo(corpo);
  const u = session.user!;
  const ctx = { empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", motivo, role: u.role, permissoes: u.permissoes as Permissoes };

  // Inativar o USUÁRIO de login junto (opcional): mesma regra e travas de Configurações › Usuários,
  // conferidas ANTES de mexer no colaborador (nada pela metade)
  let usuarioId: string | null = null;
  if (corpo?.inativarUsuario === true) {
    if (!pode(u.permissoes, "configuracoes", "gerenciar", u.role))
      return NextResponse.json({ erro: "Sem permissão para inativar usuários (Configurações › gerenciar)." }, { status: 403 });
    const impacto = await impactoColaborador(id, empresaId);
    if (!impacto) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
    if (impacto.usuarioVinculado) {
      const registro = await prisma.usuario.findUnique({ where: { id: impacto.usuarioVinculado.id } });
      const bloqueio = registro && await verificarAtivoCadastro("usuarios", registro, false, ctx);
      if (bloqueio) return NextResponse.json({ erro: `Usuário de login: ${bloqueio}` }, { status: 409 });
      usuarioId = impacto.usuarioVinculado.id;
    }
  }

  // Mesma regra da ação em massa (lib/acoes-massa/regras.ts)
  const r = await inativarColaborador(id, ctx);
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Não encontrado" : r.motivo }, { status: statusHttp(r) });
  if (usuarioId) {
    const ru = await definirAtivoCadastro("usuarios", usuarioId, false, ctx);
    if (!ru.ok) return NextResponse.json({ ok: true, aviso: `Colaborador inativado, mas o usuário não: ${ru.motivo}` });
  }
  return NextResponse.json({ ok: true, usuarioInativado: !!usuarioId });
}

/** Edição parcial pelo "editar no contexto" de um seletor: só nome, telefone e CREA (o resto é da ficha). */
const edicaoRapidaSchema = z.object({
  nome: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").transform(caixaNome).optional(),
  telefone: z.string().trim().min(8, "Telefone inválido").optional(),
  crea: z.string().trim().max(60).optional(),
}).strict().refine((d) => Object.keys(d).length > 0, "Nada para alterar");

/**
 * Exige "gerenciar". Dois usos:
 * - { ativo: true } reativa o colaborador (ativo=true + status ATIVO);
 * - { nome?, telefone?, crea? } corrige esses campos sem passar pela ficha inteira.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const corpo = await req.json().catch(() => null);
  if (corpo?.ativo !== true) {
    const parsed = edicaoRapidaSchema.safeParse(corpo);
    if (!parsed.success) {
      // Campo conhecido com valor ruim: diz qual; qualquer outra coisa (vazio, { ativo: false }, campo estranho) é ação inválida
      const campo = parsed.error.issues.find((i) => i.code !== "unrecognized_keys" && i.path.length > 0);
      return NextResponse.json({ erro: campo?.message ?? "Ação inválida" }, { status: 400 });
    }
    const atual = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { id: true, tipo: true, crea: true } });
    if (!atual) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
    const { crea, ...resto } = parsed.data;
    // Responsável técnico não fica sem CREA (é o que sai impresso no orçamento)
    if (crea !== undefined && !crea && atual.tipo === "RESPONSAVEL_TECNICO") return NextResponse.json({ erro: "Informe o CREA do responsável técnico." }, { status: 400 });
    const t = await prisma.tecnico.update({
      where: { id }, data: { ...resto, ...(crea !== undefined && { crea: crea || null }) },
      select: { id: true, nome: true, telefone: true, crea: true, tipo: true, ativo: true },
    });
    return NextResponse.json(t);
  }

  const r = await reativarColaborador(id, { empresaId, usuarioId: guard.session.user!.id, usuarioNome: guard.session.user!.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: "Não encontrado" }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}
