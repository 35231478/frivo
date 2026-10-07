import { prisma } from "@/lib/prisma";
import { permissoesDoUsuario, permissoesExcedentes, type Permissoes } from "@/lib/permissoes";
import { REGIME_LABEL, type Regime } from "@/lib/folha/calculo";
import { garantirModelosPadrao } from "@/lib/folha/server";
import { ErroRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { enviarConvite, senhaInicialAleatoria } from "@/lib/usuarios/convite";
import type { EntidadeCadastro } from "@/lib/cadastros/registro";

/**
 * Regras ESPECÍFICAS de alguns cadastros padronizados (perfis de acesso, modelos de encargos,
 * usuários). A rota genérica continua fazendo o comum (sessão, permissão por ação, schema estrito,
 * empresa da sessão); aqui ficam as travas de negócio e de segurança:
 *  - `criar`/`editar`: gravação própria (anti-autopromoção, nome único, padrão único…);
 *  - `bloqueioAtivo`: o que IMPEDE inativar/reativar — usado pela rota, pelo modal de impacto e
 *    pelas ações em massa (a trava nunca é pulada);
 *  - `impacto`: o que avisar antes de inativar.
 */

/** Quem está agindo (vem da sessão). */
export interface Ator {
  id: string;
  nome: string;
  empresaId: string;
  role?: string;
  permissoes: Permissoes;
  /** Origem do site (para links de convite) */
  baseUrl?: string;
}

export type Registro = Record<string, unknown> & { id: string };
export type Gravacao = { ok: true; item: Record<string, unknown> } | { ok: false; status: number; erro: string };
export interface ImpactoEspecifico { usos: { rotulo: string; total: number }[]; avisos: string[] }

export interface RegrasCadastro {
  antesDeListar?: (empresaId: string) => Promise<void>;
  criar?: (dados: Record<string, unknown>, ator: Ator) => Promise<Gravacao>;
  editar?: (existente: Registro, dados: Record<string, unknown>, ator: Ator) => Promise<Gravacao>;
  /** Motivo que impede inativar (ativo=false) ou reativar (ativo=true); null = pode. */
  bloqueioAtivo?: (registro: Registro, ativo: boolean, ator: Pick<Ator, "id" | "empresaId" | "role" | "permissoes">) => Promise<string | null>;
  impacto?: (registro: Registro, empresaId: string) => Promise<ImpactoEspecifico>;
}

const falha = (status: number, erro: string): Gravacao => ({ ok: false, status, erro });
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const nomes = (xs: { nome: string }[], max = 5) =>
  xs.slice(0, max).map((x) => x.nome).join(", ") + (xs.length > max ? ` e mais ${xs.length - max}` : "");
const admin = (a: { role?: string }) => a.role === "ADMIN";
const excede = (ator: { permissoes: Permissoes; role?: string }, alvo: unknown) =>
  permissoesExcedentes(ator.permissoes, (alvo ?? {}) as Permissoes, ator.role).length > 0;

/* ───────────────────────── Perfis de acesso ───────────────────────── */
const perfis: RegrasCadastro = {
  async criar(dados, ator) {
    // Ninguém cria perfil com acessos que ele mesmo não tem (autopromoção)
    if (excede(ator, dados.permissoes)) return falha(403, "Você não pode conceder acessos que você mesmo não tem.");
    const item = await prisma.perfilAcesso.create({ data: { ...(dados as any), empresaId: ator.empresaId, ativo: true, padraoSistema: false } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    if (!admin(ator)) {
      const meu = await prisma.usuario.findUnique({ where: { id: ator.id }, select: { perfilAcessoId: true } });
      if (meu?.perfilAcessoId === existente.id) return falha(403, "Você não pode alterar o perfil de acesso ao qual está vinculado.");
      if (excede(ator, existente.permissoes)) return falha(403, "Este perfil tem acessos que você não tem; só um administrador pode alterá-lo.");
      if (dados.permissoes !== undefined && excede(ator, dados.permissoes)) return falha(403, "Você não pode conceder acessos que você mesmo não tem.");
    }
    const item = await prisma.perfilAcesso.update({ where: { id: existente.id }, data: dados as any });
    return { ok: true, item };
  },
  async bloqueioAtivo(p, ativo, ator) {
    if (!ativo && p.padraoSistema) return "É um perfil padrão do sistema: não pode ser inativado.";
    if (!ativo) {
      const meu = await prisma.usuario.findUnique({ where: { id: ator.id }, select: { perfilAcessoId: true } });
      if (meu?.perfilAcessoId === p.id) return "É o seu próprio perfil de acesso: inativá-lo tiraria o seu acesso. Peça a outro administrador.";
    }
    if (!admin(ator) && excede(ator, p.permissoes))
      return `Este perfil tem acessos que você não tem; só um administrador pode ${ativo ? "reativá-lo" : "inativá-lo"}.`;
    return null;
  },
  async impacto(p, empresaId) {
    const [usuarios, colaboradores] = await Promise.all([
      prisma.usuario.findMany({ where: { empresaId, perfilAcessoId: p.id, ativo: true }, select: { nome: true, role: true }, orderBy: { nome: "asc" } }),
      prisma.tecnico.count({ where: { empresaId, perfilAcessoId: p.id, ativo: true } }),
    ]);
    // ADMIN tem acesso total sem depender do perfil: só os demais perdem o acesso
    const perdem = usuarios.filter((u) => u.role !== "ADMIN");
    const avisos: string[] = [];
    if (perdem.length) {
      avisos.push(`${pl(perdem.length, "usuário ativo usa", "usuários ativos usam")} este perfil (${nomes(perdem)}). Ao inativar, ${perdem.length === 1 ? "ele fica" : "eles ficam"} SEM ACESSO (só o início) a partir da próxima tela, até receber${perdem.length === 1 ? "" : "em"} outro perfil em Configurações › Usuários.`);
    }
    if (colaboradores) avisos.push(`${pl(colaboradores, "colaborador está ligado", "colaboradores estão ligados")} a este perfil no cadastro.`);
    return {
      usos: [{ rotulo: pl(usuarios.length, "usuário ativo", "usuários ativos"), total: usuarios.length }, { rotulo: pl(colaboradores, "colaborador", "colaboradores"), total: colaboradores }],
      avisos,
    };
  },
};

/* ───────────────────────── Modelos de encargos ───────────────────────── */
const modelos: RegrasCadastro = {
  antesDeListar: async (empresaId) => { await garantirModelosPadrao(empresaId); },
  async criar(dados, ator) {
    const d = dados as { nome: string; regime: Regime; padrao: boolean; itens: unknown };
    if (await prisma.modeloEncargos.findFirst({ where: { empresaId: ator.empresaId, nome: d.nome }, select: { id: true } }))
      return falha(409, "Já existe um modelo com esse nome.");
    const item = await prisma.$transaction(async (tx) => {
      // Um padrão por regime
      if (d.padrao) await tx.modeloEncargos.updateMany({ where: { empresaId: ator.empresaId, regime: d.regime }, data: { padrao: false } });
      return tx.modeloEncargos.create({ data: { empresaId: ator.empresaId, nome: d.nome, regime: d.regime, padrao: d.padrao, itens: d.itens as any, ativo: true } });
    });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    const empresaId = ator.empresaId;
    const d = dados as { nome?: string; regime?: Regime; padrao?: boolean; itens?: unknown };
    if (d.nome !== undefined && d.nome !== existente.nome
      && await prisma.modeloEncargos.findFirst({ where: { empresaId, nome: d.nome, id: { not: existente.id } }, select: { id: true } }))
      return falha(409, "Já existe um modelo com esse nome.");
    if (d.regime !== undefined && d.regime !== existente.regime && await prisma.colaboradorFolha.count({ where: { empresaId, modeloEncargosId: existente.id } }))
      return falha(409, "Há colaboradores usando este modelo: não dá para mudar o tipo de contrato dele.");
    if (d.padrao && !existente.ativo) return falha(400, "Reative o modelo antes de torná-lo o padrão.");
    const regime = (d.regime ?? existente.regime) as Regime;
    const item = await prisma.$transaction(async (tx) => {
      if (d.padrao) await tx.modeloEncargos.updateMany({ where: { empresaId, regime, id: { not: existente.id } }, data: { padrao: false } });
      return tx.modeloEncargos.update({ where: { id: existente.id }, data: d as any });
    });
    return { ok: true, item };
  },
  async bloqueioAtivo(m, ativo) {
    // Sem padrão ativo, quem não escolheu modelo ficaria sem encargos: troque o padrão antes
    if (!ativo && m.padrao)
      return `É o modelo padrão de ${REGIME_LABEL[m.regime as Regime] ?? m.regime}: marque outro modelo como padrão antes de inativar este.`;
    return null;
  },
  async impacto(m, empresaId) {
    const [usando, padrao] = await Promise.all([
      prisma.colaboradorFolha.findMany({
        where: { empresaId, modeloEncargosId: m.id, colaborador: { ativo: true } },
        select: { colaborador: { select: { nome: true } } },
      }),
      prisma.modeloEncargos.findFirst({ where: { empresaId, regime: m.regime as Regime, padrao: true, ativo: true, id: { not: m.id } }, select: { nome: true } }),
    ]);
    const avisos = usando.length
      ? [`${pl(usando.length, "colaborador ativo usa", "colaboradores ativos usam")} este modelo (${nomes(usando.map((u) => u.colaborador))}). Ao inativar, o custo ${usando.length === 1 ? "dele" : "deles"} passa a ser calculado pelo padrão do tipo de contrato${padrao ? ` (“${padrao.nome}”)` : ""}. Os meses já fechados não mudam.`]
      : [];
    return { usos: [{ rotulo: pl(usando.length, "colaborador ativo", "colaboradores ativos"), total: usando.length }], avisos };
  },
};

/* ───────────────────────── Usuários ───────────────────────── */
/** Acessos efetivos do usuário (perfil ativo; ADMIN = tudo). */
async function acessosDe(usuarioId: string) {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { role: true, perfilAcesso: { select: { ativo: true, permissoes: true } } } });
  return u ? permissoesDoUsuario(u) : {};
}

/** Perfil escolhido: da empresa; novo precisa estar ativo; e o ator precisa ter os acessos dele. */
async function conferirPerfil(perfilAcessoId: string | null | undefined, ator: Ator, atual?: string | null): Promise<Gravacao | null> {
  if (!perfilAcessoId) return null;
  try { await validarRefEmpresa("perfilAcesso", perfilAcessoId, ator.empresaId, "Perfil de acesso", { novoAtivo: true, manter: [atual] }); }
  catch (e) { if (e instanceof ErroRefEmpresa) return falha(400, e.message); throw e; }
  if (perfilAcessoId === atual) return null;
  const perfil = await prisma.perfilAcesso.findUnique({ where: { id: perfilAcessoId }, select: { permissoes: true } });
  if (excede(ator, perfil?.permissoes)) return falha(403, "Você não pode atribuir um perfil com acessos que você mesmo não tem.");
  return null;
}

const usuarios: RegrasCadastro = {
  async criar(dados, ator) {
    const d = dados as { nome: string; email: string; perfilAcessoId: string | null };
    if (await prisma.usuario.findFirst({ where: { empresaId: ator.empresaId, email: { equals: d.email, mode: "insensitive" } }, select: { id: true } }))
      return falha(409, "Já existe um usuário com este e-mail.");
    const erroPerfil = await conferirPerfil(d.perfilAcessoId, ator);
    if (erroPerfil) return erroPerfil;
    // Nunca ADMIN por aqui: o acesso vem do perfil. Senha aleatória até o convidado definir a dele.
    const criado = await prisma.usuario.create({
      data: { empresaId: ator.empresaId, nome: d.nome, email: d.email, perfilAcessoId: d.perfilAcessoId, role: "OPERADOR", ativo: true, senha: await senhaInicialAleatoria() },
    });
    const convite = await enviarConvite(criado.id, ator.baseUrl ?? "");
    return { ok: true, item: { ...criado, convite } };
  },
  async editar(existente, dados, ator) {
    const d = dados as { nome?: string; perfilAcessoId?: string | null };
    const proprio = existente.id === ator.id;
    if (!proprio && !admin(ator) && excede(ator, await acessosDe(existente.id)))
      return falha(403, "Este usuário tem acessos que você não tem; só um administrador pode alterá-lo.");
    if (d.perfilAcessoId !== undefined && (d.perfilAcessoId ?? null) !== (existente.perfilAcessoId ?? null)) {
      if (proprio) return falha(403, "Você não pode alterar o seu próprio perfil de acesso. Peça a outro administrador.");
      const erroPerfil = await conferirPerfil(d.perfilAcessoId, ator, existente.perfilAcessoId as string | null);
      if (erroPerfil) return erroPerfil;
    }
    const item = await prisma.usuario.update({ where: { id: existente.id }, data: d });
    return { ok: true, item };
  },
  async bloqueioAtivo(u, ativo, ator) {
    if (!ativo && u.id === ator.id) return "Você não pode inativar o seu próprio usuário.";
    if (!ativo && u.role === "ADMIN") {
      const admins = await prisma.usuario.count({ where: { empresaId: ator.empresaId, role: "ADMIN", ativo: true } });
      if (admins <= 1) return "É o último administrador ativo da empresa: inativá-lo deixaria a empresa sem administrador.";
    }
    if (!admin(ator) && excede(ator, await acessosDe(u.id)))
      return `Este usuário tem acessos que você não tem; só um administrador pode ${ativo ? "reativá-lo" : "inativá-lo"}.`;
    return null;
  },
  async impacto(u, empresaId) {
    const [os, pedidos] = await Promise.all([
      prisma.ordemServico.count({ where: { empresaId, responsavelId: u.id, status: { notIn: ["CONCLUIDA", "CANCELADA"] } } }),
      prisma.pedidoCompraInterno.count({ where: { empresaId, compradorId: u.id, status: { notIn: ["ENTREGUE", "CANCELADO"] } } }),
    ]);
    const avisos = ["Ele perde o acesso ao sistema na hora (na próxima tela que abrir). Nada do que ele fez é apagado e dá para reativar depois."];
    if (os) avisos.push(`É responsável por ${pl(os, "OS em aberto", "OS em aberto")}: reatribua se for o caso.`);
    if (pedidos) avisos.push(`É comprador de ${pl(pedidos, "pedido de compra em aberto", "pedidos de compra em aberto")}.`);
    return { usos: [{ rotulo: pl(os, "OS em aberto", "OS em aberto"), total: os }, { rotulo: pl(pedidos, "pedido de compra", "pedidos de compra"), total: pedidos }], avisos };
  },
};

export const REGRAS: Partial<Record<EntidadeCadastro, RegrasCadastro>> = {
  "perfis-acesso": perfis,
  "modelos-encargos": modelos,
  usuarios,
};
