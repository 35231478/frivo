/**
 * Importação por planilha — lado do servidor: permissões, contexto (o que já existe NA EMPRESA DA
 * SESSÃO) e gravação em lotes. Só cria e atualiza: nunca apaga, nunca inativa, nunca reativa.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pode, type Permissoes } from "@/lib/permissoes";
import { CADASTROS, type Requisito } from "@/lib/cadastros/registro";
import { ErroRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { chaveNome, type Analise, type ContextoImportacao, type LinhaAnalisada, type OpcaoRef } from "@/lib/importacao/motor";
import { APELIDOS_TIPO_EQUIPAMENTO, chaveCodigo, chaveParecido, REQUISITO_FAMILIA, type EntidadeImportacao } from "@/lib/importacao/entidades";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { resolverTipoEquipamento } from "@/lib/tipo-equipamento";
import { proximoCodigoServico } from "@/lib/cadastros/codigos";
import { proximoCodigoProduto } from "@/lib/cadastros/codigos-server";

/** Criar = importar; editar = poder ATUALIZAR os duplicados. Mesmas permissões das telas. */
export const PERMISSOES_IMPORTACAO: Record<EntidadeImportacao, { criar: Requisito; editar: Requisito }> = {
  clientes: { criar: [["clientes", "criar"]], editar: [["clientes", "editar"]] },
  unidades: { criar: REQUISITO_FAMILIA.unidades!, editar: REQUISITO_FAMILIA.unidades! },
  contatos: { criar: REQUISITO_FAMILIA.contatos!, editar: REQUISITO_FAMILIA.contatos! },
  equipamentos: { criar: [["equipamentos", "criar"]], editar: [["equipamentos", "editar"]] },
  fornecedores: { criar: CADASTROS.fornecedores.permissoes.criar, editar: CADASTROS.fornecedores.permissoes.editar },
  servicos: { criar: CADASTROS.servicos.permissoes.criar, editar: CADASTROS.servicos.permissoes.editar },
  produtos: { criar: CADASTROS.produtos.permissoes.criar, editar: CADASTROS.produtos.permissoes.editar },
};

export { PERMISSOES_EXPORTACAO } from "@/lib/importacao/entidades";

export function temRequisito(req: Requisito, permissoes: Permissoes, role?: string) {
  return !req || req.some(([m, a]) => pode(permissoes, m, a, role));
}

/** O que já existe na empresa (chaves de dedup → id) e as opções dos campos referenciados. */
export async function carregarContexto(
  entidade: EntidadeImportacao, empresaId: string, podeAtualizar: boolean, permitido?: ContextoImportacao["permitido"],
): Promise<ContextoImportacao> {
  const existentes = new Map<string, string>();
  const refs: Record<string, OpcaoRef[]> = {};
  const mapas: Record<string, Map<string, string>> = {};
  /** Clientes da empresa: documento (só dígitos) → id */
  const clientesPorDoc = async () => {
    const cs = await prisma.cliente.findMany({ where: { empresaId }, select: { id: true, cpfCnpj: true } });
    mapas.clientes = new Map(cs.map((c) => [c.cpfCnpj.replace(/\D/g, ""), c.id]));
  };
  // id_sistema da planilha exportada: só os ids DESTA empresa casam
  const porId = (rs: { id: string }[]) => { for (const r of rs) existentes.set(`id:${r.id}`, r.id); };
  const porNome = (rs: { id: string; nome: string }[]) => { for (const r of rs) { const k = `nome:${chaveNome(r.nome)}`; if (!existentes.has(k)) existentes.set(k, r.id); } };
  const porCodigo = (rs: { id: string; codigo: string | number | null }[]) => { for (const r of rs) if (r.codigo != null) existentes.set(`cod:${r.codigo}`, r.id); };
  switch (entidade) {
    case "clientes": {
      const [cs, tabelas] = await Promise.all([
        prisma.cliente.findMany({ where: { empresaId }, select: { id: true, cpfCnpj: true } }),
        prisma.tabelaPreco.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
      ]);
      porId(cs);
      // O cadastro guarda o documento formatado: a dedup compara só os dígitos
      for (const c of cs) existentes.set(`doc:${c.cpfCnpj.replace(/\D/g, "")}`, c.id);
      refs.tabela_preco = tabelas.map((t) => ({ valor: t.id, rotulo: t.nome }));
      break;
    }
    case "unidades": {
      await clientesPorDoc();
      const us = await prisma.unidade.findMany({ where: { empresaId }, select: { id: true, nome: true, clienteId: true } });
      porId(us);
      mapas.unidadeDoCliente = new Map(us.map((u) => [u.id, u.clienteId]));
      for (const u of us) { const k = `un:${u.clienteId}|${chaveNome(u.nome)}`; if (!existentes.has(k)) existentes.set(k, u.id); }
      break;
    }
    case "contatos": {
      await clientesPorDoc();
      const cs = await prisma.contatoCliente.findMany({ where: { empresaId }, select: { id: true, nome: true, email: true, clienteId: true } });
      porId(cs);
      mapas.contatoDoCliente = new Map(cs.map((c) => [c.id, c.clienteId]));
      for (const c of cs) {
        if (c.email) { const k = `ctmail:${c.clienteId}|${c.email.trim().toLowerCase()}`; if (!existentes.has(k)) existentes.set(k, c.id); }
        const k = `ctnome:${c.clienteId}|${chaveNome(c.nome)}`; if (!existentes.has(k)) existentes.set(k, c.id);
      }
      break;
    }
    case "equipamentos": {
      await clientesPorDoc();
      const [us, tipos, eqs] = await Promise.all([
        prisma.unidade.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, clienteId: true, principal: true } }),
        prisma.tipoEquipamentoCustom.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, chaveEnum: true }, orderBy: { nome: "asc" } }),
        prisma.equipamento.findMany({
          where: { empresaId },
          select: { id: true, numeroSerie: true, patrimonio: true, marca: true, modelo: true, capacidade: true, localizacao: true, ativo: true, unidadeId: true, unidade: { select: { clienteId: true } } },
        }),
      ]);
      // Unidade pelo nome no cliente; "*principal" = a unidade principal do cliente
      mapas.unidades = new Map();
      for (const u of us) {
        const k = `${u.clienteId}|${chaveNome(u.nome)}`;
        if (!mapas.unidades.has(k)) mapas.unidades.set(k, u.id);
        if (u.principal) mapas.unidades.set(`${u.clienteId}|*principal`, u.id);
      }
      // Tipos: os personalizados ativos da empresa primeiro; o tipo do sistema que um deles já representa
      // (chaveEnum) não repete — os apelidos dele passam para o personalizado
      const cobertos = new Set(tipos.map((t) => t.chaveEnum).filter(Boolean) as string[]);
      refs.tipo = [
        ...tipos.map((t) => ({ valor: `c:${t.id}`, rotulo: t.nome, aceitos: t.chaveEnum ? [t.chaveEnum, LABELS_TIPO_EQUIPAMENTO[t.chaveEnum] ?? "", ...(APELIDOS_TIPO_EQUIPAMENTO[t.chaveEnum] ?? [])].filter(Boolean) : [] })),
        ...Object.entries(LABELS_TIPO_EQUIPAMENTO).filter(([k]) => !cobertos.has(k)).map(([k, rotulo]) => ({ valor: `e:${k}`, rotulo, aceitos: [k, ...(APELIDOS_TIPO_EQUIPAMENTO[k] ?? [])] })),
      ];
      porId(eqs);
      mapas.equipamentoDoCliente = new Map(eqs.map((e) => [e.id, e.unidade.clienteId]));
      // Série e patrimônio: repetidos em mais de um equipamento ficam "ambíguos" (nunca casam sozinhos)
      const contagem = new Map<string, string[]>();
      for (const e of eqs)
        for (const k of [e.numeroSerie?.trim() && `serie:${chaveCodigo(e.numeroSerie)}`, e.patrimonio?.trim() && `pat:${chaveCodigo(e.patrimonio)}`])
          if (k) contagem.set(k, [...(contagem.get(k) ?? []), e.id]);
      mapas.ambiguas = new Map();
      for (const [k, ids] of contagem) {
        if (ids.length === 1) existentes.set(k, ids[0]);
        else mapas.ambiguas.set(k, String(ids.length));
      }
      // Possíveis duplicados (só os ATIVOS): mesmo cliente, unidade, marca, modelo e capacidade
      const parecidos = new Map<string, string[]>();
      for (const e of eqs) {
        if (!e.ativo) continue;
        const k = chaveParecido(e.unidade.clienteId, e.unidadeId, e.marca, e.modelo, e.capacidade);
        const desc = `${e.marca} ${e.modelo}${e.capacidade ? ` ${e.capacidade}` : ""}${e.localizacao ? ` (${e.localizacao})` : ""}${e.numeroSerie ? `, série ${e.numeroSerie}` : ", sem série"}`;
        parecidos.set(k, [...(parecidos.get(k) ?? []), desc]);
      }
      // Em ordem alfabética: o relatório sai sempre igual, seja qual for a ordem do banco
      mapas.parecidos = new Map([...parecidos].map(([k, ds]) => { ds.sort((a, b) => a.localeCompare(b, "pt-BR")); return [k, ds.length > 3 ? `${ds.slice(0, 3).join("; ")} e mais ${ds.length - 3}` : ds.join("; ")]; }));
      break;
    }
    case "fornecedores": {
      const fs = await prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true, nome: true, documento: true } });
      porId(fs);
      for (const f of fs) if (f.documento) existentes.set(`doc:${f.documento}`, f.id);
      porNome(fs);
      break;
    }
    case "servicos": { const ss = await prisma.servico.findMany({ where: { empresaId }, select: { id: true, nome: true, codigo: true } }); porId(ss); porCodigo(ss); porNome(ss); break; }
    case "produtos": { const ps = await prisma.produto.findMany({ where: { empresaId }, select: { id: true, nome: true, codigo: true } }); porId(ps); porCodigo(ps); porNome(ps); break; }
  }
  return { existentes, refs, podeAtualizar, permitido, mapas };
}

/** Todos os registros DA EMPRESA para a planilha exportada (ativos e inativos), na ordem da lista */
export async function carregarExportacao(entidade: EntidadeImportacao, empresaId: string): Promise<Record<string, unknown>[]> {
  switch (entidade) {
    case "clientes": return prisma.cliente.findMany({ where: { empresaId }, orderBy: [{ nome: "asc" }, { id: "asc" }] });
    case "unidades": return prisma.unidade.findMany({
      where: { empresaId }, include: { cliente: { select: { cpfCnpj: true, nome: true } } },
      orderBy: [{ cliente: { nome: "asc" } }, { principal: "desc" }, { nome: "asc" }, { id: "asc" }],
    });
    case "equipamentos": return prisma.equipamento.findMany({
      where: { empresaId }, include: { unidade: { select: { nome: true, principal: true, cliente: { select: { cpfCnpj: true, nome: true } } } } },
      orderBy: [{ unidade: { cliente: { nome: "asc" } } }, { unidade: { nome: "asc" } }, { marca: "asc" }, { id: "asc" }],
    }) as unknown as Promise<Record<string, unknown>[]>;
    case "contatos": return prisma.contatoCliente.findMany({
      where: { empresaId }, select: { id: true, nome: true, cargo: true, tipo: true, email: true, telefone: true, whatsapp: true, principal: true, cliente: { select: { cpfCnpj: true } } },
      orderBy: [{ cliente: { nome: "asc" } }, { principal: "desc" }, { nome: "asc" }, { id: "asc" }],
    }) as unknown as Promise<Record<string, unknown>[]>;
    case "fornecedores": return prisma.fornecedor.findMany({ where: { empresaId }, orderBy: [{ nome: "asc" }, { id: "asc" }] });
    case "servicos": return prisma.servico.findMany({ where: { empresaId }, orderBy: [{ codigo: "asc" }, { nome: "asc" }, { id: "asc" }] });
    case "produtos": return prisma.produto.findMany({ where: { empresaId }, orderBy: [{ codigo: "asc" }, { nome: "asc" }, { id: "asc" }] });
  }
}

type Delegate = {
  create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
  updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  count: (a: { where: Record<string, unknown> }) => Promise<number>;
};
const MODELO: Record<EntidadeImportacao, string> = { clientes: "cliente", unidades: "unidade", contatos: "contatoCliente", equipamentos: "equipamento", fornecedores: "fornecedor", servicos: "servico", produtos: "produto" };
const tabela = (e: EntidadeImportacao) => (prisma as unknown as Record<string, Delegate>)[MODELO[e]];
const semIndefinidos = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Atualiza a linha casada. Sem nada a mudar (ex.: casou pelo nome e só o nome veio), só confere que o
 * registro continua na empresa — um update vazio contaria 0 e viraria um erro falso.
 */
async function atualizar(
  t: { updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>; count: (a: { where: Record<string, unknown> }) => Promise<number> },
  where: Record<string, unknown>, data: Record<string, unknown>,
) {
  const n = Object.keys(data).length ? (await t.updateMany({ where, data })).count : await t.count({ where });
  if (n !== 1) throw new Error("O registro a atualizar não foi encontrado na sua empresa.");
}

/** Erro de UMA linha, com a mensagem que a pessoa vê (o resto do lote segue). */
export class ErroLinha extends Error {}

/** O que a gravação fez além de criar/atualizar a linha (vira uma frase no resultado). */
interface Efeitos { unidadesPrincipais: number; principaisTrocados: number }

/** Endereço do cliente → a unidade "Principal" (mesmos campos da unidade). */
function unidadePrincipalDe(c: Record<string, unknown>, empresaId: string, clienteId: string) {
  const s = (k: string) => (typeof c[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  return {
    empresaId, clienteId, nome: "Principal", principal: true,
    logradouro: s("endereco"), numero: s("numero"), complemento: s("complemento"), bairro: s("bairro"),
    cidade: s("cidade"), estado: s("estado"), cep: s("cep"), telefone: s("telefone"),
  };
}

/**
 * Cliente: cria (com a unidade "Principal" com o endereço dele, na mesma transação) ou atualiza;
 * cliente atualizado que ainda não tem NENHUMA unidade também ganha a "Principal".
 */
async function gravarCliente(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, ef: Efeitos): Promise<"criado" | "atualizado"> {
  if (dados.tabelaPrecoId)
    await validarRefEmpresa("tabelaPreco", dados.tabelaPrecoId as string, empresaId, "Tabela de preço", { novoAtivo: true });
  return prisma.$transaction(async (tx) => {
    let clienteId: string;
    let resultado: "criado" | "atualizado";
    if (l.status === "criar") {
      const c = await tx.cliente.create({ data: { ...(dados as Prisma.ClienteUncheckedCreateInput), empresaId, ativo: true } });
      clienteId = c.id; resultado = "criado";
    } else {
      await atualizar(tx.cliente as unknown as Delegate, { id: l.existenteId, empresaId }, dados);
      clienteId = l.existenteId!; resultado = "atualizado";
    }
    if ((await tx.unidade.count({ where: { clienteId, empresaId } })) === 0) {
      // O endereço gravado (no update, o que já estava + o que veio preenchido)
      const c = await tx.cliente.findFirstOrThrow({ where: { id: clienteId, empresaId } });
      await tx.unidade.create({ data: unidadePrincipalDe(c as unknown as Record<string, unknown>, empresaId, clienteId) });
      ef.unidadesPrincipais++;
    }
    return resultado;
  });
}

/**
 * Unidade ou contato (vivem dentro do cliente): cria ou atualiza; "principal = Sim" tira a marcação
 * do principal anterior DO MESMO CLIENTE (na mesma transação). Unidade nova de um cliente sem nenhuma
 * unidade vira a principal (o cliente sempre tem um endereço principal). Nunca muda o cliente.
 */
async function gravarDoCliente(entidade: "unidades" | "contatos", l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, ef: Efeitos): Promise<"criado" | "atualizado"> {
  const clienteId = String(dados.clienteId);
  delete dados.clienteId;
  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { id: true } });
    if (!cliente) throw new Error("O cliente desta linha não foi encontrado na sua empresa.");
    const t = (entidade === "unidades" ? tx.unidade : tx.contatoCliente) as unknown as Delegate;
    // Unidade: "Não" só quer dizer "não vira a principal" — a principal só troca quando OUTRA vem "Sim"
    // (o cliente nunca fica sem endereço principal, como na tela)
    if (entidade === "unidades" && dados.principal === false) delete dados.principal;
    if (entidade === "unidades" && l.status === "criar" && dados.principal === undefined
      && (await t.count({ where: { clienteId, empresaId } })) === 0) dados.principal = true;
    if (dados.principal === true) {
      const r = await t.updateMany({ where: { clienteId, empresaId, principal: true, ...(l.existenteId && { NOT: { id: l.existenteId } }) }, data: { principal: false } });
      ef.principaisTrocados += r.count;
    }
    if (l.status === "criar") {
      await t.create({ data: { ...dados, principal: dados.principal === true, empresaId, clienteId } });
      return "criado";
    }
    if (l.chave?.includes("|") && !l.chave.startsWith("ctmail:")) delete dados.nome; // casou pelo nome: não renomeia
    await atualizar(t, { id: l.existenteId, empresaId, clienteId }, dados);
    return "atualizado";
  });
}

type TipoResolvido = { tipo: string; tipoEquipamentoId: string | null };

/**
 * Equipamento: a unidade é conferida de novo (da empresa E do cliente da linha); o tipo já veio
 * resolvido (uma vez por planilha). Cria nunca sem tipo (vazio = Outro); atualiza sem mudar de
 * cliente (pode mudar de unidade dentro do mesmo cliente) e só o que veio preenchido.
 */
async function gravarEquipamento(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, tipos: Map<string, TipoResolvido>): Promise<"criado" | "atualizado"> {
  const { clienteId, tipoRef, semChave: _s, ...campos } = dados as Record<string, unknown> & { clienteId: string; tipoRef?: string };
  const unidade = await prisma.unidade.findFirst({ where: { id: String(campos.unidadeId), empresaId, clienteId }, select: { id: true } });
  if (!unidade) throw new ErroLinha("A unidade desta linha não foi encontrada no cliente (na sua empresa).");
  const tipo = tipoRef ? tipos.get(tipoRef) : undefined;
  if (tipoRef && !tipo) throw new ErroLinha("Tipo de equipamento não encontrado (ou inativo).");
  if (l.status === "criar") {
    const t = tipo ?? tipos.get("e:OUTRO");
    if (!t) throw new ErroLinha("Tipo de equipamento não encontrado.");
    await prisma.equipamento.create({ data: { ...(campos as Prisma.EquipamentoUncheckedCreateInput), tipo: t.tipo as Prisma.EquipamentoUncheckedCreateInput["tipo"], tipoEquipamentoId: t.tipoEquipamentoId, empresaId, ativo: true, fotos: [] } });
    return "criado";
  }
  const existe = await prisma.equipamento.count({ where: { id: l.existenteId, empresaId, unidade: { clienteId } } });
  if (existe !== 1) throw new ErroLinha("O equipamento a atualizar não foi encontrado neste cliente (na sua empresa).");
  await atualizar(prisma.equipamento as unknown as Delegate, { id: l.existenteId, empresaId }, { ...campos, ...(tipo && { tipo: tipo.tipo, tipoEquipamentoId: tipo.tipoEquipamentoId }) });
  return "atualizado";
}

/**
 * Tipos de equipamento da planilha, resolvidos UMA vez e em sequência antes de gravar (o tipo do
 * sistema sem personalizado ganha o personalizado na 1ª vez — gravar em paralelo criaria vários).
 */
async function resolverTipos(linhas: LinhaAnalisada[], empresaId: string) {
  const refs = new Set(linhas.filter((l) => l.status === "criar" || l.dados?.tipoRef).map((l) => String(l.dados?.tipoRef ?? "e:OUTRO")));
  const tipos = new Map<string, TipoResolvido>();
  for (const ref of refs) {
    const r = ref.startsWith("c:") ? await resolverTipoEquipamento(empresaId, "OUTRO", ref.slice(2)) : await resolverTipoEquipamento(empresaId, ref.slice(2), null);
    if (!("erro" in r)) tipos.set(ref, r);
  }
  return tipos;
}

/** Uma linha: cria (com os padrões do cadastro) ou atualiza só o que veio preenchido. */
async function gravarLinha(entidade: EntidadeImportacao, l: LinhaAnalisada, empresaId: string, ef: Efeitos, tipos: Map<string, TipoResolvido> = new Map()): Promise<"criado" | "atualizado"> {
  const dados = semIndefinidos(l.dados ?? {});
  // Nunca deixa a planilha escolher empresa, id ou situação
  delete dados.empresaId; delete dados.id; delete dados.ativo;
  if (entidade === "clientes") return gravarCliente(l, dados, empresaId, ef);
  if (entidade === "unidades" || entidade === "contatos") return gravarDoCliente(entidade, l, dados, empresaId, ef);
  if (entidade === "equipamentos") return gravarEquipamento(l, dados, empresaId, tipos);
  if (l.status === "criar") {
    // O código já foi reservado para a linha (gravarImportacao); o schema do produto não aceita código
    const { codigo, ...semCodigo } = dados;
    const base = CADASTROS[entidade].schemaCriar.parse(semCodigo) as Record<string, unknown>;
    // Campo estruturado (ex.: materiais padrão do serviço, E3.2) não vem da planilha: o padrão do schema (lista vazia) fica de fora da gravação
    for (const c of CADASTROS[entidade].campos) if (c.tipo === "estruturado") delete base[c.key];
    await tabela(entidade).create({ data: { ...base, ...(codigo !== undefined && { codigo }), empresaId, ativo: true } });
    return "criado";
  }
  // Casou pelo nome: o nome é a chave — "gas r410a" na planilha não renomeia o "Gás R410A" do cadastro
  if (l.chave?.startsWith("nome:")) delete dados.nome;
  await atualizar(tabela(entidade), { id: l.existenteId, empresaId }, dados);
  return "atualizado";
}

export const TAMANHO_LOTE = 50;

export interface ResultadoImportacao {
  criados: number;
  atualizados: number;
  /** O que mais aconteceu (ex.: "2 clientes ganharam a unidade “Principal”…"), em frases para a tela */
  observacoes: string[];
  /** Linhas GRAVADAS com aviso (sem chave, possível duplicado…), para a pessoa revisar */
  avisos: (Pick<LinhaAnalisada, "linha" | "rotulo" | "valores"> & { avisos: string[] })[];
  /** Linhas com erro (da análise e da gravação), com os valores originais para a planilha de erros */
  erros: Pick<LinhaAnalisada, "linha" | "rotulo" | "erros" | "valores">[];
}

/**
 * Grava as linhas válidas em lotes (uma linha que falhar ao gravar vira erro e as outras seguem).
 * Os erros da análise entram no resultado do jeito que estão.
 */
/**
 * Reserva os códigos das linhas NOVAS antes de gravar (as linhas são gravadas em paralelo): produto =
 * o maior da empresa + 1, + 2…; serviço sem código = o próximo do prefixo do nome, contando os já usados
 * e os que a própria planilha trouxe.
 */
async function reservarCodigos(entidade: EntidadeImportacao, linhas: LinhaAnalisada[], empresaId: string) {
  const novas = linhas.filter((l) => l.status === "criar");
  if (!novas.length) return;
  if (entidade === "produtos") {
    let proximo = await proximoCodigoProduto(empresaId);
    for (const l of novas) l.dados = { ...l.dados, codigo: proximo++ };
  } else if (entidade === "servicos") {
    const usados = (await prisma.servico.findMany({ where: { empresaId, codigo: { not: null } }, select: { codigo: true } })).map((s) => s.codigo as string);
    for (const l of novas) if (l.dados?.codigo) usados.push(String(l.dados.codigo));
    for (const l of novas) {
      if (l.dados?.codigo) continue;
      const codigo = proximoCodigoServico(String(l.dados?.nome ?? ""), usados);
      usados.push(codigo);
      l.dados = { ...l.dados, codigo };
    }
  }
}

export async function gravarImportacao(entidade: EntidadeImportacao, analise: Analise, empresaId: string): Promise<ResultadoImportacao> {
  const res: ResultadoImportacao = { criados: 0, atualizados: 0, observacoes: [], avisos: [], erros: analise.linhas.filter((l) => l.status === "erro") };
  const ef: Efeitos = { unidadesPrincipais: 0, principaisTrocados: 0 };
  const gravar = analise.linhas.filter((l) => l.status !== "erro");
  await reservarCodigos(entidade, gravar, empresaId);
  const tipos = entidade === "equipamentos" ? await resolverTipos(gravar, empresaId) : new Map<string, TipoResolvido>();
  for (let i = 0; i < gravar.length; i += TAMANHO_LOTE) {
    const lote = gravar.slice(i, i + TAMANHO_LOTE);
    // Unidades e contatos: uma linha por vez (o "principal" de um cliente não pode correr em paralelo)
    const feitos = entidade === "unidades" || entidade === "contatos"
      ? await (async () => { const r: PromiseSettledResult<"criado" | "atualizado">[] = []; for (const l of lote) r.push(...await Promise.allSettled([gravarLinha(entidade, l, empresaId, ef)])); return r; })()
      : await Promise.allSettled(lote.map((l) => gravarLinha(entidade, l, empresaId, ef, tipos)));
    feitos.forEach((f, k) => {
      if (f.status === "fulfilled") {
        if (f.value === "criado") res.criados++; else res.atualizados++;
        const l = lote[k];
        if (l.avisos?.length) res.avisos.push({ linha: l.linha, rotulo: l.rotulo, valores: l.valores, avisos: l.avisos });
        return;
      }
      const e = f.reason as { code?: string; message?: string };
      const motivo = e instanceof ErroRefEmpresa || e instanceof ErroLinha ? e.message
        : e?.code === "P2002" && String((e as { meta?: { target?: unknown } }).meta?.target ?? "").includes("codigo")
          ? "Este código já é de outro cadastro (ou foi usado enquanto você importava). Gere a prévia de novo."
        : e?.code === "P2002" ? "Já existe um registro com este documento (cadastrado enquanto você importava). Gere a prévia de novo."
        : e?.message?.includes("não foi encontrado") ? e.message
        : "Não foi possível gravar esta linha.";
      res.erros.push({ ...lote[k], erros: [motivo] });
    });
  }
  res.erros.sort((a, b) => a.linha - b.linha);
  res.avisos.sort((a, b) => a.linha - b.linha);
  if (ef.unidadesPrincipais)
    res.observacoes.push(`${ef.unidadesPrincipais} ${ef.unidadesPrincipais === 1 ? "cliente ganhou" : "clientes ganharam"} a unidade “Principal” com o endereço do cadastro.`);
  if (ef.principaisTrocados)
    res.observacoes.push(`${ef.principaisTrocados} ${entidade === "contatos" ? (ef.principaisTrocados === 1 ? "contato deixou" : "contatos deixaram") : (ef.principaisTrocados === 1 ? "unidade deixou" : "unidades deixaram")} de ser ${entidade === "contatos" ? "o principal" : "a principal"}: a planilha marcou outro.`);
  return res;
}
