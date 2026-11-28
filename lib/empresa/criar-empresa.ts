/**
 * "Nova empresa" (área do super admin): cria, numa transação só, tudo o que uma empresa precisa
 * para começar — a empresa, a configuração padrão, os 5 perfis de acesso, os 6 tipos de OS de
 * climatização e o PRIMEIRO ADMINISTRADOR (senha inicial definida pelo super admin, marcada para
 * troca: no 1º login o sistema só abre a tela de troca). Ou tudo, ou nada.
 *
 * Também serve para COMPLETAR o que falta numa empresa (`completarPadroesDaEmpresa`): perfis e tipos
 * de OS que já existem (mesmo nome) não são tocados; só entram os que faltam.
 */
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cnpjValido, digitos } from "@/lib/documento";
import { problemaSenha } from "@/lib/acesso/senha";
import { emailDeLoginEmUso, MSG_EMAIL_LOGIN_EM_USO } from "@/lib/acesso/email-unico";
import { perfisPadrao, TIPOS_OS_PADRAO, faltando } from "@/lib/empresa/padroes";
import { detalheNovaSenhaAdmin, diferencasEmpresa, TIPOS_EVENTO_EMPRESA, type DadosEmpresa, type TipoEventoEmpresa } from "@/lib/empresa/eventos";
import { gerarSenhaProvisoria } from "@/lib/portal/gerar-senha";
import { limparTentativas } from "@/lib/acesso/limite";

type Db = Prisma.TransactionClient | typeof prisma;

export const novaEmpresaSchema = z.object({
  razaoSocial: z.string().trim().min(2, "Informe a razão social.").max(200),
  nomeFantasia: z.string().trim().max(200).optional().nullable(),
  cnpj: z.string().trim().refine(cnpjValido, "CNPJ inválido."),
  email: z.string().trim().toLowerCase().email("E-mail da empresa inválido.").max(200),
  telefone: z.string().trim().max(40).optional().nullable(),
  admin: z.object({
    nome: z.string().trim().min(2, "Informe o nome do administrador.").max(120),
    email: z.string().trim().toLowerCase().email("E-mail do administrador inválido.").max(200),
    senha: z.string().superRefine((s, ctx) => { const p = problemaSenha(s); if (p) ctx.addIssue({ code: "custom", message: p }); }),
  }).strict(),
}).strict();

export type NovaEmpresa = z.infer<typeof novaEmpresaSchema>;

/** CNPJ gravado como no restante do sistema: 00.000.000/0000-00 */
export const formatarCnpj = (s: string) => digitos(s).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export const MSG_CNPJ_EM_USO = "Já existe uma empresa com este CNPJ.";

/** Outra empresa já tem este CNPJ (com ou sem máscara)? `exceto` = a própria, na edição. */
async function cnpjDeOutraEmpresa(cnpj: string, exceto?: string) {
  return !!(await prisma.empresa.findFirst({
    where: { OR: [{ cnpj: formatarCnpj(cnpj) }, { cnpj: digitos(cnpj) }], ...(exceto ? { id: { not: exceto } } : {}) },
    select: { id: true },
  }));
}

/**
 * Perfis e tipos de OS padrão que faltam na empresa (mesmo nome = já existe e fica como está).
 * Devolve quantos de cada entraram.
 */
export async function completarPadroesDaEmpresa(db: Db, empresaId: string, o: { perfis?: boolean; tiposOs?: boolean } = { perfis: true, tiposOs: true }) {
  let perfis = 0, tiposOs = 0;
  if (o.perfis) {
    const existentes = await db.perfilAcesso.findMany({ where: { empresaId }, select: { nome: true } });
    for (const p of faltando(perfisPadrao(), existentes)) {
      await db.perfilAcesso.create({ data: { empresaId, nome: p.nome, descricao: p.descricao, tipo: p.tipo, cor: p.cor, padraoSistema: true, ativo: true, permissoes: p.permissoes as Prisma.InputJsonValue } });
      perfis++;
    }
  }
  if (o.tiposOs) {
    const existentes = await db.tipoOs.findMany({ where: { empresaId }, select: { nome: true } });
    for (const t of faltando(TIPOS_OS_PADRAO, existentes)) {
      await db.tipoOs.create({ data: { empresaId, nome: t.nome, descricao: t.descricao, cor: t.cor, exigeEquipamento: t.exigeEquipamento } });
      tiposOs++;
    }
  }
  return { perfis, tiposOs };
}

export type ResultadoNovaEmpresa =
  | { ok: true; empresaId: string; adminEmail: string; perfis: number; tiposOs: number }
  | { ok: false; status: number; erro: string };

export async function criarEmpresa(d: NovaEmpresa): Promise<ResultadoNovaEmpresa> {
  const cnpj = formatarCnpj(d.cnpj);
  // O login procura o e-mail em todas as empresas: o do 1º administrador não pode existir em nenhuma
  const [cnpjEmUso, emailEmUso] = await Promise.all([cnpjDeOutraEmpresa(d.cnpj), emailDeLoginEmUso(d.admin.email)]);
  if (cnpjEmUso) return { ok: false, status: 409, erro: MSG_CNPJ_EM_USO };
  if (emailEmUso) return { ok: false, status: 409, erro: MSG_EMAIL_LOGIN_EM_USO };

  const senha = await bcrypt.hash(d.admin.senha, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({
        data: { nome: d.razaoSocial, nomeFantasia: d.nomeFantasia || null, cnpj, email: d.email, telefone: d.telefone || null },
        select: { id: true },
      });
      await tx.configuracao.create({ data: { empresaId: empresa.id } });
      const { perfis, tiposOs } = await completarPadroesDaEmpresa(tx, empresa.id);
      const perfilAdmin = await tx.perfilAcesso.findFirst({ where: { empresaId: empresa.id, tipo: "ADMINISTRADOR" }, select: { id: true } });
      await tx.usuario.create({
        // trocarSenha: a senha inicial é do super admin; no 1º login o sistema só abre a tela de troca
        data: { empresaId: empresa.id, nome: d.admin.nome, email: d.admin.email, senha, trocarSenha: true, role: "ADMIN", ativo: true, perfilAcessoId: perfilAdmin?.id ?? null },
      });
      return { ok: true as const, empresaId: empresa.id, adminEmail: d.admin.email, perfis, tiposOs };
    });
  } catch (e) {
    // Corrida com outro cadastro igual (CNPJ único no banco)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, status: 409, erro: MSG_CNPJ_EM_USO };
    throw e;
  }
}

/** A lista da área do super admin: só o mínimo de cada empresa (nada de dentro dela). */
export async function listarEmpresas() {
  const empresas = await prisma.empresa.findMany({
    orderBy: { criadoEm: "desc" },
    select: { id: true, nome: true, nomeFantasia: true, cnpj: true, ativo: true, criadoEm: true, _count: { select: { usuarios: true } } },
  });
  return empresas.map((e) => ({ id: e.id, nome: e.nome, nomeFantasia: e.nomeFantasia, cnpj: e.cnpj, ativo: e.ativo, criadoEm: e.criadoEm.toISOString(), usuarios: e._count.usuarios }));
}

export const MSG_NAO_INATIVA_PROPRIA = "A empresa do administrador do Frivo não pode ser inativada por aqui.";

/**
 * Inativar / reativar uma empresa (área do dono do Frivo). Inativa: ninguém dela entra, e as sessões abertas caem na
 * próxima requisição (lib/sessao-ativa confere `empresa.ativo`). Nada é apagado: reativar devolve tudo como estava.
 */
export async function alterarSituacaoEmpresa(p: { id: string; ativo: boolean; empresaDoDono: string; autorId?: string | null }):
  Promise<{ ok: true; ativo: boolean } | { ok: false; status: number; erro: string }> {
  if (!p.ativo && p.id === p.empresaDoDono) return { ok: false, status: 409, erro: MSG_NAO_INATIVA_PROPRIA };
  const r = await prisma.empresa.updateMany({ where: { id: p.id }, data: { ativo: p.ativo } });
  if (!r.count) return { ok: false, status: 404, erro: "Empresa não encontrada." };
  await registrarEvento(prisma, { empresaId: p.id, usuarioId: p.autorId, tipo: p.ativo ? "REATIVADA" : "INATIVADA" });
  return { ok: true, ativo: p.ativo };
}

/* ───────────────────────── A trilha da empresa (empresa_eventos) ───────────────────────── */

async function registrarEvento(db: Db, e: { empresaId: string; usuarioId?: string | null; tipo: TipoEventoEmpresa; detalhe?: string | null }) {
  await db.empresaEvento.create({ data: { empresaId: e.empresaId, usuarioId: e.usuarioId ?? null, tipo: e.tipo, detalhe: e.detalhe ?? null } });
}

const MSG_EMPRESA_NAO_ENCONTRADA = "Empresa não encontrada.";
type Falha = { ok: false; status: number; erro: string };

/* ───────────────────────── Nova senha provisória do 1º administrador ───────────────────────── */

export const MSG_SEM_ADMIN = "A empresa não tem administrador ativo.";

/** O "1º administrador" da empresa: o ADMIN ativo mais antigo (desempate pelo id, para a resposta ser sempre a mesma). */
export function primeiroAdministrador(db: Db, empresaId: string) {
  return db.usuario.findFirst({
    where: { empresaId, role: "ADMIN", ativo: true },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: { id: true, nome: true, email: true },
  });
}

/**
 * Nova senha provisória do 1º administrador (área do dono do Frivo): o sistema GERA a senha (ninguém digita a de
 * ninguém), grava só o hash, marca a troca obrigatória no próximo acesso e devolve o texto UMA vez, para o super
 * admin repassar. As sessões abertas desse usuário caem na leitura seguinte: a impressão da senha no token deixa
 * de bater (lib/sessao-ativa). O bloqueio por senhas erradas do e-mail é zerado (quem esqueceu a senha costuma
 * estar bloqueado). Na trilha entra de quem foi — nunca a senha.
 */
export async function gerarNovaSenhaDoAdmin(p: { empresaId: string; autorId?: string | null }):
  Promise<{ ok: true; senha: string; admin: { nome: string; email: string } } | Falha> {
  const empresa = await prisma.empresa.findUnique({ where: { id: p.empresaId }, select: { id: true } });
  if (!empresa) return { ok: false, status: 404, erro: MSG_EMPRESA_NAO_ENCONTRADA };
  const admin = await primeiroAdministrador(prisma, p.empresaId);
  if (!admin) return { ok: false, status: 409, erro: MSG_SEM_ADMIN };
  const senha = gerarSenhaProvisoria();
  const hash = await bcrypt.hash(senha, 12);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: admin.id }, data: { senha: hash, trocarSenha: true } });
    await registrarEvento(tx, { empresaId: p.empresaId, usuarioId: p.autorId, tipo: "NOVA_SENHA_ADMIN", detalhe: detalheNovaSenhaAdmin(admin) });
  });
  await limparTentativas("LOGIN", { email: admin.email });
  return { ok: true, senha, admin: { nome: admin.nome, email: admin.email } };
}

/* ───────────────────────── Editar os dados da empresa ───────────────────────── */

export const editarEmpresaSchema = novaEmpresaSchema.omit({ admin: true }).strict();
export type DadosEditados = z.infer<typeof editarEmpresaSchema>;

const SELECT_DADOS = { nome: true, nomeFantasia: true, cnpj: true, email: true, telefone: true } as const;
const comoDados = (e: { nome: string; nomeFantasia: string | null; cnpj: string; email: string; telefone: string | null }): DadosEmpresa =>
  ({ razaoSocial: e.nome, nomeFantasia: e.nomeFantasia, cnpj: e.cnpj, email: e.email, telefone: e.telefone });

/**
 * Editar razão social, nome fantasia, CNPJ (válido e único entre as empresas), e-mail e telefone. O que mudou vai
 * para a trilha num evento só ("Campo: antes → depois", uma linha por campo). Nada mudou: nada é gravado.
 */
export async function editarEmpresa(p: { id: string; dados: DadosEditados; autorId?: string | null }):
  Promise<{ ok: true; alterado: boolean; empresa: DadosEmpresa } | Falha> {
  const atual = await prisma.empresa.findUnique({ where: { id: p.id }, select: SELECT_DADOS });
  if (!atual) return { ok: false, status: 404, erro: MSG_EMPRESA_NAO_ENCONTRADA };
  const d = p.dados;
  const depois: DadosEmpresa = { razaoSocial: d.razaoSocial, nomeFantasia: d.nomeFantasia || null, cnpj: formatarCnpj(d.cnpj), email: d.email, telefone: d.telefone || null };
  const mudancas = diferencasEmpresa(comoDados(atual), depois);
  if (!mudancas.length) return { ok: true, alterado: false, empresa: comoDados(atual) };
  if (digitos(depois.cnpj!) !== digitos(atual.cnpj) && await cnpjDeOutraEmpresa(depois.cnpj!, p.id)) return { ok: false, status: 409, erro: MSG_CNPJ_EM_USO };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.empresa.update({ where: { id: p.id }, data: { nome: depois.razaoSocial!, nomeFantasia: depois.nomeFantasia, cnpj: depois.cnpj!, email: depois.email!, telefone: depois.telefone } });
      await registrarEvento(tx, { empresaId: p.id, usuarioId: p.autorId, tipo: "DADOS_EDITADOS", detalhe: mudancas.join("\n") });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, status: 409, erro: MSG_CNPJ_EM_USO };
    throw e;
  }
  return { ok: true, alterado: true, empresa: depois };
}

/** O modal de edição: os dados de agora e a trilha recente (com o nome de quem fez). */
export async function detalheDaEmpresa(id: string, limite = 20) {
  const empresa = await prisma.empresa.findUnique({ where: { id }, select: SELECT_DADOS });
  if (!empresa) return null;
  // Só a trilha do dono do Frivo: a mesma tabela guarda eventos da própria empresa (ex.: PRECO_TABELA_FATURA, o
  // preço de tabela alterado numa fatura — dado comercial do cliente), que não aparecem aqui
  const eventos = await prisma.empresaEvento.findMany({ where: { empresaId: id, tipo: { in: [...TIPOS_EVENTO_EMPRESA] } }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: limite });
  const ids = [...new Set(eventos.map((e) => e.usuarioId).filter((x): x is string => !!x))];
  const autores = new Map((ids.length ? await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]));
  return {
    empresa: comoDados(empresa),
    eventos: eventos.map((e) => ({ id: e.id, tipo: e.tipo, detalhe: e.detalhe, criadoEm: e.criadoEm.toISOString(), autor: e.usuarioId ? autores.get(e.usuarioId) ?? null : null })),
  };
}
