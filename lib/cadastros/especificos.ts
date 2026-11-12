import { prisma } from "@/lib/prisma";
import { permissoesDoUsuario, permissoesExcedentes, type Permissoes } from "@/lib/permissoes";
import { REGIME_LABEL, type Regime } from "@/lib/folha/calculo";
import { garantirModelosPadrao } from "@/lib/folha/server";
import { ErroRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { calcularValorFinalTabela } from "@/lib/tabela-preco-helpers";
import { enviarConvite, senhaInicialAleatoria } from "@/lib/usuarios/convite";
import { CADASTROS, type EntidadeCadastro } from "@/lib/cadastros/registro";
import { normalizarCodigoServico } from "@/lib/cadastros/codigos";
import { colisaoDeCodigo, criarProdutoComCodigo, criarServicoComCodigo, servicoComCodigo } from "@/lib/cadastros/codigos-server";
import { motivoRetencaoServicoInvalida, type RetencoesDoServico } from "@/lib/financeiro/retencoes";
import { categoriaProdutoComNome, garantirCategoriasProdutoPadrao } from "@/lib/estoque/categoria-server";
import { custoDoKit } from "@/lib/estoque/composicao";
import { kitMaterialComNome, montarItensKit, montarMateriaisServico } from "@/lib/estoque/composicao-server";
import { ultimosCustos } from "@/lib/estoque/custo";

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
  /** Depois de listar (lista paginada): acrescenta dados calculados às linhas (ex.: custo de referência do kit) */
  enriquecer?: (itens: Registro[], empresaId: string) => Promise<Registro[]>;
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
    if (excede(ator, dados.permissoes)) return falha(403, "Não é possível conceder acessos além dos do próprio usuário.");
    const item = await prisma.perfilAcesso.create({ data: { ...(dados as any), empresaId: ator.empresaId, ativo: true, padraoSistema: false } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    if (!admin(ator)) {
      const meu = await prisma.usuario.findUnique({ where: { id: ator.id }, select: { perfilAcessoId: true } });
      if (meu?.perfilAcessoId === existente.id) return falha(403, "Não é possível alterar o próprio perfil de acesso.");
      if (excede(ator, existente.permissoes)) return falha(403, "Este perfil tem acessos além dos do usuário atual; só um administrador pode alterá-lo.");
      if (dados.permissoes !== undefined && excede(ator, dados.permissoes)) return falha(403, "Não é possível conceder acessos além dos do próprio usuário.");
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
      return `Este perfil tem acessos além dos do usuário atual; só um administrador pode ${ativo ? "reativá-lo" : "inativá-lo"}.`;
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
      const quem = `${pl(perdem.length, "usuário ativo usa", "usuários ativos usam")} este perfil (${nomes(perdem)})`;
      avisos.push(`${quem}. Ao inativar, perde${perdem.length === 1 ? "" : "m"} o acesso na próxima tela, até receber outro perfil.`);
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
      return `Modelo padrão de ${REGIME_LABEL[m.regime as Regime] ?? m.regime}: defina outro padrão antes de inativar.`;
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
  if (excede(ator, perfil?.permissoes)) return falha(403, "Não é possível atribuir um perfil com acessos além dos do próprio usuário.");
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
      return falha(403, "Este usuário tem acessos além dos do usuário atual; só um administrador pode alterá-lo.");
    if (d.perfilAcessoId !== undefined && (d.perfilAcessoId ?? null) !== (existente.perfilAcessoId ?? null)) {
      if (proprio) return falha(403, "Não é possível alterar o próprio perfil de acesso. Peça a outro administrador.");
      const erroPerfil = await conferirPerfil(d.perfilAcessoId, ator, existente.perfilAcessoId as string | null);
      if (erroPerfil) return erroPerfil;
    }
    const item = await prisma.usuario.update({ where: { id: existente.id }, data: d });
    return { ok: true, item };
  },
  async bloqueioAtivo(u, ativo, ator) {
    if (!ativo && u.id === ator.id) return "Não é possível inativar o próprio usuário.";
    if (!ativo && u.role === "ADMIN") {
      const admins = await prisma.usuario.count({ where: { empresaId: ator.empresaId, role: "ADMIN", ativo: true } });
      if (admins <= 1) return "É o último administrador ativo da empresa: inativá-lo deixaria a empresa sem administrador.";
    }
    if (!admin(ator) && excede(ator, await acessosDe(u.id)))
      return `Este usuário tem acessos além dos do usuário atual; só um administrador pode ${ativo ? "reativá-lo" : "inativá-lo"}.`;
    return null;
  },
  async impacto(u, empresaId) {
    const [os, pedidos] = await Promise.all([
      prisma.ordemServico.count({ where: { empresaId, responsavelId: u.id, status: { notIn: ["CONCLUIDA", "CANCELADA"] } } }),
      prisma.pedidoCompraInterno.count({ where: { empresaId, compradorId: u.id, status: { notIn: ["ENTREGUE", "CONCLUIDO", "CANCELADO"] } } }),
    ]);
    const avisos = ["Perde o acesso na próxima tela que abrir. Nada é apagado; pode ser reativado depois."];
    if (os) avisos.push(`É responsável por ${pl(os, "OS em aberto", "OS em aberto")}: reatribua se for o caso.`);
    if (pedidos) avisos.push(`É comprador de ${pl(pedidos, "pedido de compra em aberto", "pedidos de compra em aberto")}.`);
    return { usos: [{ rotulo: pl(os, "OS em aberto", "OS em aberto"), total: os }, { rotulo: pl(pedidos, "pedido de compra", "pedidos de compra"), total: pedidos }], avisos };
  },
};

/* ───────────────────────── Tipos de equipamento ───────────────────────── */
/** Nome único entre os tipos ATIVOS (um inativo com o mesmo nome não impede: reative-o ou use outro). */
async function nomeTipoEmUso(empresaId: string, nome: string, exceto?: string) {
  return !!(await prisma.tipoEquipamentoCustom.findFirst({
    where: { empresaId, ativo: true, nome: { equals: nome, mode: "insensitive" }, ...(exceto && { id: { not: exceto } }) }, select: { id: true },
  }));
}

const tiposEquipamento: RegrasCadastro = {
  async criar(dados, ator) {
    const d = dados as { nome: string; descricao: string | null };
    if (await nomeTipoEmUso(ator.empresaId, d.nome)) return falha(409, "Já existe um tipo de equipamento com esse nome.");
    const item = await prisma.tipoEquipamentoCustom.create({ data: { empresaId: ator.empresaId, nome: d.nome, descricao: d.descricao, ativo: true } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    const d = dados as { nome?: string; descricao?: string | null };
    if (d.nome !== undefined && d.nome.toLowerCase() !== String(existente.nome).toLowerCase() && await nomeTipoEmUso(ator.empresaId, d.nome, existente.id))
      return falha(409, "Já existe um tipo de equipamento com esse nome.");
    const item = await prisma.tipoEquipamentoCustom.update({ where: { id: existente.id }, data: d });
    return { ok: true, item };
  },
  async bloqueioAtivo(t, ativo, ator) {
    // Reativar com o nome de outro tipo ativo duplicaria a lista
    if (ativo && await nomeTipoEmUso(ator.empresaId, String(t.nome), t.id))
      return `Já existe outro tipo ativo chamado “${t.nome}”: renomeie um dos dois antes de reativar.`;
    return null;
  },
  async impacto(t, empresaId) {
    const [equip, forms, itens] = await Promise.all([
      prisma.equipamento.count({ where: { empresaId, tipoEquipamentoId: t.id, ativo: true } }),
      prisma.formTypeMapping.count({ where: { tipoEquipamentoId: t.id } }),
      prisma.checklistTipoItem.count({ where: { tipoEquipamentoId: t.id, ativo: true } }),
    ]);
    const avisos: string[] = [];
    const eq = pl(equip, "equipamento ativo é", "equipamentos ativos são"), fm = pl(forms, "formulário está vinculado", "formulários estão vinculados"), it = pl(itens, "item", "itens");
    if (equip) avisos.push(`${eq} deste tipo: continua${equip === 1 ? "" : "m"} com ele (como “inativo”); só sai das novas escolhas.`);
    if (forms) avisos.push(`${fm} a este tipo: os vínculos ficam guardados e voltam a valer na reativação.`);
    if (itens) avisos.push(`O checklist (${it}) fica guardado: segue nas OS deste tipo e as respostas antigas não mudam.`);
    return {
      usos: [
        { rotulo: pl(equip, "equipamento ativo", "equipamentos ativos"), total: equip },
        { rotulo: pl(forms, "formulário vinculado", "formulários vinculados"), total: forms },
        { rotulo: pl(itens, "item de checklist", "itens de checklist"), total: itens },
      ],
      avisos,
    };
  },
};

/* ───────────────────────── Tabelas de preço ───────────────────────── */
type ItemTabela = { servicoId?: string | null; produtoId?: string | null; tipoPreco: "VALOR_FIXO" | "DESCONTO_PERCENTUAL"; valorFixo?: number | null; descontoPercent?: number | null; bloqueado: boolean };

/**
 * Itens da tabela: serviço/produto da empresa; item NOVO precisa estar ativo no catálogo (o que a
 * tabela já tinha continua aceito, mesmo inativo). O valor final é calculado aqui, nunca vem do corpo.
 */
async function montarItensTabela(itens: ItemTabela[], empresaId: string, jaTinha: { servicoId?: unknown; produtoId?: unknown }[] = []) {
  const servicoIds = itens.map((i) => i.servicoId).filter((x): x is string => !!x);
  const produtoIds = itens.map((i) => i.produtoId).filter((x): x is string => !!x);
  if (new Set(servicoIds).size !== servicoIds.length || new Set(produtoIds).size !== produtoIds.length)
    throw new ErroRefEmpresa("O mesmo serviço/produto aparece duas vezes na tabela.");
  await Promise.all([
    validarRefsEmpresa("servico", servicoIds, empresaId, "Serviço", { novoAtivo: true, manter: jaTinha.map((i) => i.servicoId as string) }),
    validarRefsEmpresa("produto", produtoIds, empresaId, "Produto", { novoAtivo: true, manter: jaTinha.map((i) => i.produtoId as string) }),
  ]);
  const [servicos, produtos] = await Promise.all([
    servicoIds.length ? prisma.servico.findMany({ where: { id: { in: servicoIds }, empresaId }, select: { id: true, valorPadrao: true } }) : [],
    produtoIds.length ? prisma.produto.findMany({ where: { id: { in: produtoIds }, empresaId }, select: { id: true, valorPadrao: true } }) : [],
  ]);
  const base = new Map([...servicos, ...produtos].map((x) => [x.id, x.valorPadrao ? Number(x.valorPadrao) : 0]));
  return itens.map((it) => ({
    servicoId: it.servicoId || null,
    produtoId: it.produtoId || null,
    tipoPreco: it.tipoPreco,
    valorFixo: it.tipoPreco === "VALOR_FIXO" ? (it.valorFixo ?? null) : null,
    descontoPercent: it.tipoPreco === "DESCONTO_PERCENTUAL" ? (it.descontoPercent ?? null) : null,
    valorFinal: calcularValorFinalTabela(it.tipoPreco, it.valorFixo, it.descontoPercent, base.get((it.servicoId || it.produtoId) as string)),
    bloqueado: it.bloqueado,
  }));
}

const comRef = async (fn: () => Promise<Gravacao>): Promise<Gravacao> => {
  try { return await fn(); } catch (e) { if (e instanceof ErroRefEmpresa) return falha(400, e.message); throw e; }
};

const tabelasPreco: RegrasCadastro = {
  criar: (dados, ator) => comRef(async () => {
    const { itens, ...d } = dados as { itens: ItemTabela[] } & Record<string, unknown>;
    const linhas = await montarItensTabela(itens, ator.empresaId);
    const item = await prisma.tabelaPreco.create({ data: { ...(d as any), empresaId: ator.empresaId, ativo: true, itens: { create: linhas } } });
    return { ok: true, item };
  }),
  // Parcial: sem `itens` no corpo, os itens não mudam (renomear nunca apaga preço)
  editar: (existente, dados, ator) => comRef(async () => {
    const { itens, ...d } = dados as { itens?: ItemTabela[] } & Record<string, unknown>;
    const linhas = itens && await montarItensTabela(itens, ator.empresaId, (existente.itens ?? []) as { servicoId?: unknown; produtoId?: unknown }[]);
    const item = await prisma.tabelaPreco.update({
      where: { id: existente.id }, data: { ...(d as any), ...(linhas && { itens: { deleteMany: {}, create: linhas } }) },
    });
    return { ok: true, item };
  }),
  async impacto(t, empresaId) {
    const clientes = await prisma.cliente.count({ where: { empresaId, tabelaPrecoId: t.id, ativo: true } });
    const avisos: string[] = [];
    // Uma tabela só vale para os clientes ligados a ela: inativar não empurra ninguém para outra tabela
    const cl = pl(clientes, "cliente ativo usa", "clientes ativos usam");
    if (clientes) avisos.push(`${cl} esta tabela: segue${clientes === 1 ? "" : "m"} ligado${clientes === 1 ? "" : "s"} a ela (como “inativa”), com os preços padrão do catálogo até a troca ou reativação.`);
    return { usos: [{ rotulo: pl(clientes, "cliente ativo", "clientes ativos"), total: clientes }], avisos };
  },
};

/* ───────────────────────── Termos de referência ───────────────────────── */
const termos: RegrasCadastro = {
  async impacto() {
    // A proposta COPIA o texto do termo: nada que já foi feito depende do cadastro
    return { usos: [], avisos: ["As propostas já emitidas guardam uma cópia do texto: nada muda nelas. O termo só sai de “Carregar de um template”."] };
  },
};

/* ───────────────────────── Modelos de prazo ───────────────────────── */
type EtapaPrazo = { nome: string; prazoHoras: number; responsavel: string; canal: string; mensagem?: string | null };
const linhasEtapas = (etapas: EtapaPrazo[]) => etapas.map((e, ordem) => ({
  nome: e.nome, prazoHoras: e.prazoHoras, responsavel: e.responsavel as any, canal: e.canal as any, mensagem: e.mensagem ?? null, ordem,
}));

const modelosPrazo: RegrasCadastro = {
  async criar(dados, ator) {
    const { etapas, ...d } = dados as { etapas: EtapaPrazo[] } & Record<string, unknown>;
    const item = await prisma.prazoTemplate.create({ data: { ...(d as any), empresaId: ator.empresaId, ativo: true, etapas: { create: linhasEtapas(etapas) } } });
    return { ok: true, item };
  },
  // Parcial: sem `etapas`, as etapas não mudam. Prazos já abertos nas OS têm cópia das etapas: não mudam.
  async editar(existente, dados) {
    const { etapas, ...d } = dados as { etapas?: EtapaPrazo[] } & Record<string, unknown>;
    const item = await prisma.prazoTemplate.update({
      where: { id: existente.id }, data: { ...(d as any), ...(etapas && { etapas: { deleteMany: {}, create: linhasEtapas(etapas) } }) },
    });
    return { ok: true, item };
  },
  async impacto(m, empresaId) {
    const abertos = await prisma.osPrazo.count({ where: { templateId: m.id, status: { in: ["ATIVO", "ATRASADO"] }, ordemServico: { empresaId } } });
    const avisos = abertos
      ? [`${pl(abertos, "prazo em andamento usa", "prazos em andamento usam")} este modelo: segue${abertos === 1 ? "" : "m"} correndo. O modelo só sai de “Adicionar prazo”.`]
      : [];
    return { usos: [{ rotulo: pl(abertos, "prazo em andamento", "prazos em andamento"), total: abertos }], avisos };
  },
};

/* ───────────────────────── Fornecedores ───────────────────────── */
/** CNPJ/CPF único por empresa (o banco também garante: índice único empresa + documento). */
async function documentoEmUso(empresaId: string, documento: string | null | undefined, exceto?: string) {
  if (!documento) return null;
  return prisma.fornecedor.findFirst({ where: { empresaId, documento, ...(exceto && { id: { not: exceto } }) }, select: { nome: true, ativo: true } });
}
const msgDocumento = (f: { nome: string; ativo: boolean }) =>
  `Já existe um fornecedor com este CNPJ/CPF: “${f.nome}”${f.ativo ? "" : " (inativo: reative-o)"}.`;

const fornecedores: RegrasCadastro = {
  async criar(dados, ator) {
    const d = dados as { nome: string; documento: string | null };
    const dup = await documentoEmUso(ator.empresaId, d.documento);
    if (dup) return falha(409, msgDocumento(dup));
    const item = await prisma.fornecedor.create({ data: { ...(dados as any), empresaId: ator.empresaId, ativo: true } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    const d = dados as { documento?: string | null };
    if (d.documento !== undefined && d.documento !== existente.documento) {
      const dup = await documentoEmUso(ator.empresaId, d.documento, existente.id);
      if (dup) return falha(409, msgDocumento(dup));
    }
    const item = await prisma.fornecedor.update({ where: { id: existente.id }, data: dados as any });
    return { ok: true, item };
  },
  async impacto(f, empresaId) {
    const [total, abertas] = await Promise.all([
      prisma.contaPagar.count({ where: { empresaId, fornecedorId: f.id } }),
      prisma.contaPagar.count({ where: { empresaId, fornecedorId: f.id, status: { notIn: ["PAGO_TOTAL", "CANCELADO"] } } }),
    ]);
    const avisos = total
      ? [`Usado em ${pl(total, "conta a pagar", "contas a pagar")}${abertas ? ` (${pl(abertas, "em aberto", "em aberto")})` : ""}. Elas continuam ligadas a ele (aparece como “inativo”); ele só deixa de ser oferecido em contas novas.`]
      : [];
    return { usos: [{ rotulo: pl(total, "conta a pagar", "contas a pagar"), total }], avisos };
  },
};

/* ───────────────────────── Produtos e serviços: código ───────────────────────── */
/** Produto: código numérico sequencial da empresa, gerado aqui (não vem do formulário). */
/** Categoria do produto (E3.1): da empresa; escolha NOVA precisa estar ativa (manter a atual, mesmo inativa, é aceito). */
async function validarCategoriaProduto(categoriaId: unknown, empresaId: string, atual?: string | null) {
  if (typeof categoriaId !== "string" || !categoriaId) return null;
  try { await validarRefEmpresa("categoriaProduto", categoriaId, empresaId, "Categoria de produto", { novoAtivo: true, manter: [atual] }); return null; }
  catch (e) { if (e instanceof ErroRefEmpresa) return e.message; throw e; }
}
const INCLUIR_PRODUTO = { categoriaProduto: { select: { id: true, nome: true, comportamento: true, ativo: true } } };

const produtos: RegrasCadastro = {
  async criar(dados, ator) {
    const erro = await validarCategoriaProduto(dados.categoriaProdutoId, ator.empresaId);
    if (erro) return falha(400, erro);
    const item = await criarProdutoComCodigo(ator.empresaId, (codigo, tx) =>
      tx.produto.create({ data: { ...(dados as any), codigo, empresaId: ator.empresaId, ativo: true }, include: INCLUIR_PRODUTO }));
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    const erro = await validarCategoriaProduto(dados.categoriaProdutoId, ator.empresaId, existente.categoriaProdutoId as string | null);
    if (erro) return falha(400, erro);
    // (a rota do item relê o produto com a categoria depois de gravar)
    const item = await prisma.produto.update({ where: { id: existente.id }, data: dados as any });
    return { ok: true, item };
  },
};

const msgCodigoServico = (codigo: string, s: { nome: string }) => `O código ${codigo} já é do serviço “${s.nome}”. Escolha outro.`;

/** Serviço: código digitado (normalizado, único na empresa) ou gerado pelo nome; vazio ao editar mantém o atual. */
const servicos: RegrasCadastro = {
  criar: (dados, ator) => comRef(async () => {
    // E3.2: a composição (materiais padrão) vai junto; vazia = serviço como sempre
    const { materiais, ...d } = dados as { materiais: LinhaMaterial[] } & Record<string, unknown>;
    const ret = motivoRetencaoServicoInvalida(d as RetencoesDoServico);
    if (ret) return falha(400, ret);
    const n = normalizarCodigoServico(d.codigo);
    if (n.erro) return falha(400, n.erro);
    if (n.codigo) { const dup = await servicoComCodigo(ator.empresaId, n.codigo); if (dup) return falha(409, msgCodigoServico(n.codigo, dup)); }
    const linhas = await montarMateriaisServico(materiais ?? [], ator.empresaId);
    try {
      const item = await criarServicoComCodigo(ator.empresaId, String(d.nome), n.codigo, (codigo, tx) =>
        tx.servico.create({ data: { ...(d as any), codigo, empresaId: ator.empresaId, ativo: true, materiais: { create: linhas } }, include: CADASTROS.servicos.incluir as any }));
      return { ok: true, item };
    } catch (e) {
      if (n.codigo && colisaoDeCodigo(e)) return falha(409, `O código ${n.codigo} acabou de ser usado em outro serviço. Escolha outro.`);
      throw e;
    }
  }),
  editar: (existente, dados, ator) => comRef(async () => {
    // Parcial: sem `materiais` no corpo, a composição não muda (renomear nunca apaga a composição)
    const { materiais, ...data } = dados as { materiais?: LinhaMaterial[] } & Record<string, unknown>;
    const linhas = materiais && await montarMateriaisServico(materiais, ator.empresaId, (existente.materiais ?? []) as { produtoId?: unknown; kitId?: unknown }[]);
    if (linhas) (data as Record<string, unknown>).materiais = { deleteMany: {}, create: linhas };
    // "Reter" exige alíquota, olhando o que fica gravado (o que veio + o que já estava)
    const ret = motivoRetencaoServicoInvalida({ ...existente, ...data } as RetencoesDoServico);
    if (ret) return falha(400, ret);
    if ("codigo" in data) {
      const n = normalizarCodigoServico(data.codigo);
      if (n.erro) return falha(400, n.erro);
      if (!n.codigo || n.codigo === existente.codigo) delete data.codigo;
      else {
        const dup = await servicoComCodigo(ator.empresaId, n.codigo);
        if (dup) return falha(409, msgCodigoServico(n.codigo, dup));
        data.codigo = n.codigo;
      }
    }
    if (!Object.keys(data).length) return { ok: true, item: existente };
    try {
      return { ok: true, item: await prisma.servico.update({ where: { id: existente.id }, data: data as any }) };
    } catch (e) {
      if (colisaoDeCodigo(e)) return falha(409, `O código ${String(data.codigo)} acabou de ser usado em outro serviço. Escolha outro.`);
      throw e;
    }
  }),
};
type LinhaMaterial = Parameters<typeof montarMateriaisServico>[0][number];

/* ───────────────────────── Kits de material (E3.2) ───────────────────────── */
const msgKit = (k: { nome: string; ativo: boolean }) =>
  `Já existe o kit “${k.nome}”${k.ativo ? "" : " (inativo — reative-o em vez de cadastrar de novo)"}.`;

/**
 * Kit: nome único na empresa; itens = produtos da empresa (novo precisa estar ativo; o que o kit já tinha fica).
 * A lista traz o custo de referência (último custo de compra × quantidade) — informativo, nunca vira preço.
 */
const kitsMaterial: RegrasCadastro = {
  criar: (dados, ator) => comRef(async () => {
    const { itens, ...d } = dados as { itens: { produtoId: string; quantidade: number }[]; nome: string; descricao?: string | null };
    const dup = await kitMaterialComNome(ator.empresaId, d.nome);
    if (dup) return falha(409, msgKit(dup));
    const linhas = await montarItensKit(itens ?? [], ator.empresaId);
    // A resposta já traz os itens com o produto (o que a lista mostra), como a listagem
    const item = await prisma.kitMaterial.create({ data: { ...d, empresaId: ator.empresaId, ativo: true, itens: { create: linhas } }, include: CADASTROS["kits-material"].incluir as any });
    return { ok: true, item };
  }),
  // Parcial: sem `itens` no corpo, os itens não mudam
  editar: (existente, dados, ator) => comRef(async () => {
    const { itens, ...d } = dados as { itens?: { produtoId: string; quantidade: number }[]; nome?: string; descricao?: string | null };
    if (typeof d.nome === "string") {
      const dup = await kitMaterialComNome(ator.empresaId, d.nome, existente.id);
      if (dup) return falha(409, msgKit(dup));
    }
    const linhas = itens && await montarItensKit(itens, ator.empresaId, (existente.itens ?? []) as { produtoId?: unknown }[]);
    const item = await prisma.kitMaterial.update({ where: { id: existente.id }, data: { ...d, ...(linhas && { itens: { deleteMany: {}, create: linhas } }) } });
    return { ok: true, item };
  }),
  async enriquecer(itens, empresaId) {
    const produtoIds = itens.flatMap((k) => ((k.itens ?? []) as { produtoId: string }[]).map((i) => i.produtoId));
    const custos = await ultimosCustos(empresaId, produtoIds);
    return itens.map((k) => ({ ...k, custoReferencia: custoDoKit({ itens: (k.itens ?? []) as { produtoId: string; quantidade: unknown }[] }, custos) }));
  },
  async impacto(k, empresaId) {
    const servicos = await prisma.servico.count({ where: { empresaId, materiais: { some: { kitId: k.id } } } });
    const avisos: string[] = [];
    if (servicos) avisos.push(`Usado nos materiais padrão de ${pl(servicos, "serviço", "serviços")}: segue${servicos === 1 ? "" : "m"} com o kit (como “inativo”); só sai das composições novas.`);
    return { usos: [{ rotulo: pl(servicos, "serviço", "serviços"), total: servicos }], avisos };
  },
};

/* ───────────────────────── Contas bancárias ───────────────────────── */
/** Nome único na empresa, sem diferença de maiúsculas/minúsculas (ativa ou inativa). */
async function contaBancariaComNome(empresaId: string, nome: string, exceto?: string) {
  return prisma.contaBancaria.findFirst({
    where: { empresaId, nome: { equals: nome.trim(), mode: "insensitive" }, ...(exceto && { id: { not: exceto } }) },
    select: { nome: true, ativo: true },
  });
}
const msgContaBancaria = (c: { nome: string; ativo: boolean }) =>
  `Já existe a conta bancária “${c.nome}”${c.ativo ? "" : " (inativa — reative-a em vez de cadastrar de novo)"}.`;

const contasBancarias: RegrasCadastro = {
  async criar(dados, ator) {
    const dup = await contaBancariaComNome(ator.empresaId, String(dados.nome));
    if (dup) return falha(409, msgContaBancaria(dup));
    const item = await prisma.contaBancaria.create({ data: { ...(dados as { nome: string }), empresaId: ator.empresaId, ativo: true } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    if (typeof dados.nome === "string") {
      const dup = await contaBancariaComNome(ator.empresaId, dados.nome, existente.id);
      if (dup) return falha(409, msgContaBancaria(dup));
    }
    const item = await prisma.contaBancaria.update({ where: { id: existente.id }, data: dados as { nome?: string } });
    return { ok: true, item };
  },
  async impacto(c, empresaId) {
    const abertas = await prisma.contaReceber.count({ where: { empresaId, contaBancariaId: c.id, excluidaEm: null, status: { notIn: ["RECEBIDO", "CANCELADO", "PARCELADO", "PERDA", "RENEGOCIADO"] } } });
    return {
      usos: [{ rotulo: pl(abertas, "conta a receber em aberto", "contas a receber em aberto"), total: abertas }],
      avisos: abertas ? [`Está em ${pl(abertas, "conta a receber em aberto", "contas a receber em aberto")}: seguem com esta conta (como “inativa”); só sai das próximas.`] : [],
    };
  },
};

/* ───────────────────────── Centros de custo ───────────────────────── */
/** Nome único na empresa, sem diferença de maiúsculas/minúsculas (ativo ou inativo). */
async function centroComNome(empresaId: string, nome: string, exceto?: string) {
  return prisma.centroCusto.findFirst({
    where: { empresaId, nome: { equals: nome.trim(), mode: "insensitive" }, ...(exceto && { id: { not: exceto } }) },
    select: { nome: true, ativo: true },
  });
}
const msgCentro = (c: { nome: string; ativo: boolean }) =>
  `Já existe o centro de custo “${c.nome}”${c.ativo ? "" : " (inativo: reative-o)"}.`;

const msgCategoriaProduto = (c: { nome: string; ativo: boolean }) =>
  `Já existe a categoria “${c.nome}”${c.ativo ? "" : " (inativa: reative-a)"}.`;

/** Categorias de produto (E3.1): as duas do Zé vêm pré-cadastradas (seed por empresa, uma vez); nome único na empresa. */
const categoriasProduto: RegrasCadastro = {
  antesDeListar: async (empresaId) => { await garantirCategoriasProdutoPadrao(empresaId); },
  async criar(dados, ator) {
    const dup = await categoriaProdutoComNome(ator.empresaId, String(dados.nome));
    if (dup) return falha(409, msgCategoriaProduto(dup));
    const item = await prisma.categoriaProduto.create({ data: { ...(dados as { nome: string; comportamento: "VENDA_A_PARTE" | "INCLUSO_NO_SERVICO" }), empresaId: ator.empresaId, ativo: true } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    if (typeof dados.nome === "string") {
      const dup = await categoriaProdutoComNome(ator.empresaId, dados.nome, existente.id);
      if (dup) return falha(409, msgCategoriaProduto(dup));
    }
    const item = await prisma.categoriaProduto.update({ where: { id: existente.id }, data: dados as { nome?: string; comportamento?: "VENDA_A_PARTE" | "INCLUSO_NO_SERVICO" } });
    return { ok: true, item };
  },
  async impacto(c, empresaId) {
    const produtos = await prisma.produto.count({ where: { empresaId, categoriaProdutoId: c.id } });
    const ativos = produtos ? await prisma.produto.count({ where: { empresaId, categoriaProdutoId: c.id, ativo: true } }) : 0;
    const avisos: string[] = [];
    if (produtos) avisos.push(`Usada em ${pl(produtos, "produto", "produtos")}${ativos !== produtos ? ` (${pl(ativos, "ativo", "ativos")})` : ""}. Eles continuam com esta categoria e com o comportamento dela (aparece como “inativa”); ela só deixa de ser oferecida nos produtos novos.`);
    return { usos: [{ rotulo: pl(produtos, "produto", "produtos"), total: produtos }], avisos };
  },
};

const centrosCusto: RegrasCadastro = {
  async criar(dados, ator) {
    const dup = await centroComNome(ator.empresaId, String(dados.nome));
    if (dup) return falha(409, msgCentro(dup));
    const item = await prisma.centroCusto.create({ data: { nome: String(dados.nome), empresaId: ator.empresaId, ativo: true } });
    return { ok: true, item };
  },
  async editar(existente, dados, ator) {
    if (typeof dados.nome === "string") {
      const dup = await centroComNome(ator.empresaId, dados.nome, existente.id);
      if (dup) return falha(409, msgCentro(dup));
    }
    const item = await prisma.centroCusto.update({ where: { id: existente.id }, data: dados as { nome?: string } });
    return { ok: true, item };
  },
  async impacto(c, empresaId) {
    const [contas, abertas, fornecedores, notas] = await Promise.all([
      prisma.contaPagar.count({ where: { empresaId, centroCustoId: c.id } }),
      prisma.contaPagar.count({ where: { empresaId, centroCustoId: c.id, status: { notIn: ["PAGO_TOTAL", "CANCELADO"] } } }),
      prisma.fornecedor.count({ where: { empresaId, centroCustoPadraoId: c.id } }),
      prisma.notaCompra.count({ where: { empresaId, centroCustoId: c.id, status: { not: "LANCADA" } } }),
    ]);
    const avisos: string[] = [];
    const ct = `${pl(contas, "conta a pagar", "contas a pagar")}${abertas ? ` (${pl(abertas, "em aberto", "em aberto")})` : ""}`;
    if (contas) avisos.push(`Usado em ${ct}: seguem com este centro (como “inativo”); só sai das contas novas.`);
    if (fornecedores) avisos.push(`É o padrão de ${pl(fornecedores, "fornecedor", "fornecedores")}: as próximas notas deles vêm sem centro.`);
    const nt = pl(notas, "nota de compra ainda não lançada", "notas de compra ainda não lançadas");
    if (notas) avisos.push(`Está em ${nt}: dá para lançar assim mesmo ou trocar antes.`);
    return {
      usos: [
        { rotulo: pl(contas, "conta a pagar", "contas a pagar"), total: contas },
        { rotulo: pl(fornecedores, "fornecedor (padrão)", "fornecedores (padrão)"), total: fornecedores },
        { rotulo: pl(notas, "nota não lançada", "notas não lançadas"), total: notas },
      ],
      avisos,
    };
  },
};

export const REGRAS: Partial<Record<EntidadeCadastro, RegrasCadastro>> = {
  produtos,
  servicos,
  "perfis-acesso": perfis,
  "modelos-encargos": modelos,
  usuarios,
  "tipos-equipamento": tiposEquipamento,
  "tabelas-preco": tabelasPreco,
  "termos-referencia": termos,
  "modelos-prazo": modelosPrazo,
  fornecedores,
  "centros-custo": centrosCusto,
  "contas-bancarias": contasBancarias,
  "categorias-produto": categoriasProduto,
  "kits-material": kitsMaterial,
};
