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
import { perfisPadrao, TIPOS_OS_PADRAO, faltando } from "@/lib/empresa/padroes";

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
  const [cnpjEmUso, emailEmUso] = await Promise.all([
    prisma.empresa.findFirst({ where: { OR: [{ cnpj }, { cnpj: digitos(d.cnpj) }] }, select: { id: true } }),
    prisma.usuario.findFirst({ where: { email: { equals: d.admin.email, mode: "insensitive" } }, select: { id: true } }),
  ]);
  if (cnpjEmUso) return { ok: false, status: 409, erro: "Já existe uma empresa com este CNPJ." };
  if (emailEmUso) return { ok: false, status: 409, erro: "Este e-mail já é login de outro usuário. Use outro e-mail para o administrador." };

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
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, status: 409, erro: "Já existe uma empresa com este CNPJ." };
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
export async function alterarSituacaoEmpresa(p: { id: string; ativo: boolean; empresaDoDono: string }):
  Promise<{ ok: true; ativo: boolean } | { ok: false; status: number; erro: string }> {
  if (!p.ativo && p.id === p.empresaDoDono) return { ok: false, status: 409, erro: MSG_NAO_INATIVA_PROPRIA };
  const r = await prisma.empresa.updateMany({ where: { id: p.id }, data: { ativo: p.ativo } });
  if (!r.count) return { ok: false, status: 404, erro: "Empresa não encontrada." };
  return { ok: true, ativo: p.ativo };
}
