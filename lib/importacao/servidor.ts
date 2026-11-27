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
import { APELIDOS_TIPO_EQUIPAMENTO, chaveCodigo, chaveParecido, chavePlaca, PERMISSOES_IMPORTACAO, statusImportado, type EntidadeImportacao } from "@/lib/importacao/entidades";
import { proximoNumero } from "@/lib/numeracao-server";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { resolverTipoEquipamento } from "@/lib/tipo-equipamento";
import { proximoCodigoServico } from "@/lib/cadastros/codigos";
import { proximoCodigoProduto } from "@/lib/cadastros/codigos-server";
import { ErroEstoque, movimentar } from "@/lib/estoque/servidor";
import { ultimosCustos } from "@/lib/estoque/custo";
import { arred } from "@/lib/estoque/regras";

export { PERMISSOES_IMPORTACAO };
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
  /** Chave que está em MAIS de um registro (CPF, placa, nome escritos de jeitos diferentes): nunca casa sozinha */
  const unicas = (pares: [string, string][]) => {
    const ids = new Map<string, Set<string>>();
    for (const [k, id] of pares) ids.set(k, (ids.get(k) ?? new Set()).add(id));
    mapas.ambiguas = new Map();
    for (const [k, s] of ids) {
      if (s.size === 1) existentes.set(k, [...s][0]);
      else mapas.ambiguas.set(k, String(s.size));
    }
  };
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
    case "estoque": {
      const [ps, movs] = await Promise.all([
        prisma.produto.findMany({ where: { empresaId }, select: { id: true, nome: true, codigo: true, saldo: true, controlaEstoque: true, ativo: true } }),
        prisma.movimentacaoEstoque.groupBy({ by: ["produtoId"], where: { empresaId }, _count: { _all: true } }),
      ]);
      porId(ps); porCodigo(ps);
      unicas(ps.map((p) => [`nome:${chaveNome(p.nome)}`, p.id]));
      mapas.saldos = new Map(ps.map((p) => [p.id, String(arred(Number(p.saldo)))]));
      mapas.semControle = new Map(ps.filter((p) => !p.controlaEstoque).map((p) => [p.id, "1"]));
      mapas.inativos = new Map(ps.filter((p) => !p.ativo).map((p) => [p.id, "1"]));
      mapas.comMovimento = new Map(movs.map((m) => [m.produtoId, String(m._count._all)]));
      break;
    }
    case "colaboradores": {
      const [ts, cargos] = await Promise.all([
        prisma.tecnico.findMany({ where: { empresaId }, select: { id: true, cpf: true } }),
        prisma.cargo.findMany({ where: { empresaId }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" } }),
      ]);
      porId(ts);
      // O cadastro guarda o CPF como foi digitado: compara só os dígitos
      unicas(ts.map((t) => [`cpf:${t.cpf.replace(/\D/g, "")}`, t.id]));
      refs.cargo = cargos.filter((c) => c.ativo).map((c) => ({ valor: c.id, rotulo: c.nome }));
      // Inativo não é recriado: o nome do inativo (sem um ativo igual) vira erro na linha
      const ativos = new Set(refs.cargo.map((c) => chaveNome(c.rotulo)));
      mapas.cargosInativos = new Map(cargos.filter((c) => !c.ativo && !ativos.has(chaveNome(c.nome))).map((c) => [chaveNome(c.nome), c.id]));
      break;
    }
    case "contratos":
    case "pmocs": {
      await clientesPorDoc();
      const us = await prisma.unidade.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, clienteId: true, principal: true } });
      mapas.unidades = new Map();
      for (const u of us) {
        const k = `${u.clienteId}|${chaveNome(u.nome)}`;
        if (!mapas.unidades.has(k)) mapas.unidades.set(k, u.id);
        if (u.principal) mapas.unidades.set(`${u.clienteId}|*principal`, u.id);
      }
      if (entidade === "contratos") {
        // A planilha só cadastra: o número que já existe vira erro na linha
        const cs = await prisma.contrato.findMany({ where: { empresaId }, select: { id: true, numero: true } });
        for (const c of cs) existentes.set(`num:${c.numero.trim().toUpperCase()}`, c.id);
      } else {
        const [ps, eqs] = await Promise.all([
          prisma.pmoc.findMany({ where: { empresaId }, select: { id: true, nome: true, unidadeId: true } }),
          // Equipamentos ATIVOS do cliente, pela série (a mesma regra da tela do PMOC)
          prisma.equipamento.findMany({ where: { empresaId, ativo: true, numeroSerie: { not: null } }, select: { id: true, numeroSerie: true, unidade: { select: { clienteId: true } } } }),
        ]);
        for (const pm of ps) existentes.set(`pmoc:${pm.unidadeId}|${chaveNome(pm.nome)}`, pm.id);
        const porSerie = new Map<string, string[]>();
        for (const e of eqs) {
          if (!e.numeroSerie?.trim()) continue;
          const k = `${e.unidade.clienteId}|serie:${chaveCodigo(e.numeroSerie)}`;
          porSerie.set(k, [...(porSerie.get(k) ?? []), e.id]);
        }
        mapas.series = new Map([...porSerie].filter(([, ids]) => ids.length === 1).map(([k, ids]) => [k, ids[0]]));
        mapas.seriesAmbiguas = new Map([...porSerie].filter(([, ids]) => ids.length > 1).map(([k, ids]) => [k, String(ids.length)]));
      }
      break;
    }
    case "veiculos": {
      const [vs, ts] = await Promise.all([
        prisma.veiculo.findMany({ where: { empresaId }, select: { id: true, placa: true } }),
        prisma.tecnico.findMany({ where: { empresaId }, select: { id: true, cpf: true } }),
      ]);
      porId(vs);
      unicas(vs.map((v) => [`placa:${chavePlaca(v.placa)}`, v.id]));
      // Responsável pelo CPF (só os dígitos); CPF em dois colaboradores não decide sozinho
      const porCpf = new Map<string, string[]>();
      for (const t of ts) { const k = `cpf:${t.cpf.replace(/\D/g, "")}`; porCpf.set(k, [...(porCpf.get(k) ?? []), t.id]); }
      mapas.colaboradores = new Map([...porCpf].filter(([, ids]) => ids.length === 1).map(([k, ids]) => [k, ids[0]]));
      mapas.colaboradoresAmbiguos = new Map([...porCpf].filter(([, ids]) => ids.length > 1).map(([k, ids]) => [k, String(ids.length)]));
      break;
    }
  }
  return { existentes, refs, podeAtualizar, permitido, mapas };
}

/** Uma página da exportação (o backup da empresa lê em lotes, por id, para não carregar tudo na memória). */
export interface PaginaExportacao { depoisDe?: string | null; take: number }

/**
 * Registros DA EMPRESA para a planilha exportada (ativos e inativos). Sem `pagina`: todos, na ordem da lista
 * (o download de um cadastro). Com `pagina`: um lote em ordem de id, depois de `depoisDe` (o backup da empresa,
 * lib/exportacao) — os mesmos campos, então a mesma planilha.
 */
export async function carregarExportacao(entidade: EntidadeImportacao, empresaId: string, o: { verCusto?: boolean; pagina?: PaginaExportacao } = {}): Promise<Record<string, unknown>[]> {
  const pg = o.pagina;
  /** O filtro da empresa (sempre) + o "depois de" da página */
  const onde = <T extends Record<string, unknown>>(extra?: T) => ({ empresaId, ...(extra ?? {}), ...(pg?.depoisDe ? { id: { gt: pg.depoisDe } } : {}) });
  /** Na página, a ordem é por id (o cursor) */
  const porId = { id: "asc" as const };
  const take = pg?.take;
  switch (entidade) {
    case "clientes": return prisma.cliente.findMany({ where: onde(), orderBy: pg ? porId : [{ nome: "asc" }, { id: "asc" }], take });
    case "unidades": return prisma.unidade.findMany({
      where: onde(), include: { cliente: { select: { cpfCnpj: true, nome: true } } },
      orderBy: pg ? porId : [{ cliente: { nome: "asc" } }, { principal: "desc" }, { nome: "asc" }, { id: "asc" }], take,
    });
    case "equipamentos": return prisma.equipamento.findMany({
      where: onde(), include: { unidade: { select: { nome: true, principal: true, cliente: { select: { cpfCnpj: true, nome: true } } } } },
      orderBy: pg ? porId : [{ unidade: { cliente: { nome: "asc" } } }, { unidade: { nome: "asc" } }, { marca: "asc" }, { id: "asc" }], take,
    }) as unknown as Promise<Record<string, unknown>[]>;
    case "contatos": return prisma.contatoCliente.findMany({
      where: onde(), select: { id: true, nome: true, cargo: true, tipo: true, email: true, telefone: true, whatsapp: true, principal: true, cliente: { select: { cpfCnpj: true } } },
      orderBy: pg ? porId : [{ cliente: { nome: "asc" } }, { principal: "desc" }, { nome: "asc" }, { id: "asc" }], take,
    }) as unknown as Promise<Record<string, unknown>[]>;
    case "fornecedores": return prisma.fornecedor.findMany({ where: onde(), orderBy: pg ? porId : [{ nome: "asc" }, { id: "asc" }], take });
    case "servicos": return prisma.servico.findMany({ where: onde(), orderBy: pg ? porId : [{ codigo: "asc" }, { nome: "asc" }, { id: "asc" }], take });
    case "produtos": return prisma.produto.findMany({ where: onde(), orderBy: pg ? porId : [{ codigo: "asc" }, { nome: "asc" }, { id: "asc" }], take });
    case "estoque": {
      // Os produtos que controlam estoque (ativos), com o saldo; o último custo só para quem vê custo
      const ps = await prisma.produto.findMany({
        where: onde({ controlaEstoque: true, ativo: true }), select: { id: true, codigo: true, nome: true, saldo: true },
        orderBy: pg ? porId : [{ codigo: "asc" }, { nome: "asc" }, { id: "asc" }], take,
      });
      const custos = o.verCusto ? await ultimosCustos(empresaId, ps.map((p) => p.id)) : new Map<string, number>();
      return ps.map((p) => ({ ...p, saldo: arred(Number(p.saldo)), ultimoCusto: custos.get(p.id) ?? null }));
    }
    case "colaboradores": return prisma.tecnico.findMany({
      where: onde(), orderBy: pg ? porId : [{ nome: "asc" }, { id: "asc" }], take,
      // Nunca salário, dados bancários ou documentos pessoais: só as colunas da planilha
      select: { id: true, nome: true, cpf: true, telefone: true, email: true, tipo: true, tipoEquipe: true, cargoId: true, crea: true, endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true, observacoes: true },
    });
    case "contratos":
    case "pmocs": return [];
    case "veiculos": return prisma.veiculo.findMany({
      where: onde(), orderBy: pg ? porId : [{ placa: "asc" }, { id: "asc" }], take,
      select: { id: true, placa: true, modelo: true, marca: true, ano: true, anoModelo: true, tipo: true, combustivel: true, cor: true, chassi: true, renavam: true, quilometragemAtual: true, observacoes: true, responsavel: { select: { cpf: true } } },
    }) as unknown as Promise<Record<string, unknown>[]>;
  }
}

type Delegate = {
  create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
  updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  count: (a: { where: Record<string, unknown> }) => Promise<number>;
};
const MODELO: Record<EntidadeImportacao, string> = {
  clientes: "cliente", unidades: "unidade", contatos: "contatoCliente", equipamentos: "equipamento", fornecedores: "fornecedor", servicos: "servico", produtos: "produto",
  estoque: "produto", colaboradores: "tecnico", veiculos: "veiculo", contratos: "contrato", pmocs: "pmoc",
};
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

/**
 * O que a gravação de UMA linha fez: o registro dela (criado ou atualizado) e o que criou por conta própria
 * (ex.: a unidade "Principal" do cliente novo). Vira os itens do lote de importação (leva 5).
 */
type Feito = { r: "criado" | "atualizado" | "igual"; id?: string; extras?: { entidade: string; id: string }[] };

/** O que a gravação fez além de criar/atualizar a linha (vira uma frase no resultado). */
interface Efeitos { unidadesPrincipais: number; principaisTrocados: number; saldosIguais: number; contratosSuspensos: number }

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
async function gravarCliente(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, ef: Efeitos): Promise<Feito> {
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
    const extras: { entidade: string; id: string }[] = [];
    if ((await tx.unidade.count({ where: { clienteId, empresaId } })) === 0) {
      // O endereço gravado (no update, o que já estava + o que veio preenchido)
      const c = await tx.cliente.findFirstOrThrow({ where: { id: clienteId, empresaId } });
      const u = await tx.unidade.create({ data: unidadePrincipalDe(c as unknown as Record<string, unknown>, empresaId, clienteId), select: { id: true } });
      extras.push({ entidade: "unidades", id: u.id });
      ef.unidadesPrincipais++;
    }
    return { r: resultado, id: clienteId, extras };
  });
}

/**
 * Unidade ou contato (vivem dentro do cliente): cria ou atualiza; "principal = Sim" tira a marcação
 * do principal anterior DO MESMO CLIENTE (na mesma transação). Unidade nova de um cliente sem nenhuma
 * unidade vira a principal (o cliente sempre tem um endereço principal). Nunca muda o cliente.
 */
async function gravarDoCliente(entidade: "unidades" | "contatos", l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, ef: Efeitos): Promise<Feito> {
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
      const novo = await t.create({ data: { ...dados, principal: dados.principal === true, empresaId, clienteId } }) as { id: string };
      return { r: "criado", id: novo.id } as Feito;
    }
    if (l.chave?.includes("|") && !l.chave.startsWith("ctmail:")) delete dados.nome; // casou pelo nome: não renomeia
    await atualizar(t, { id: l.existenteId, empresaId, clienteId }, dados);
    return { r: "atualizado", id: l.existenteId } as Feito;
  });
}

type TipoResolvido = { tipo: string; tipoEquipamentoId: string | null };

/**
 * Equipamento: a unidade é conferida de novo (da empresa E do cliente da linha); o tipo já veio
 * resolvido (uma vez por planilha). Cria nunca sem tipo (vazio = Outro); atualiza sem mudar de
 * cliente (pode mudar de unidade dentro do mesmo cliente) e só o que veio preenchido.
 */
async function gravarEquipamento(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, tipos: Map<string, TipoResolvido>): Promise<Feito> {
  const { clienteId, tipoRef, semChave: _s, ...campos } = dados as Record<string, unknown> & { clienteId: string; tipoRef?: string };
  const unidade = await prisma.unidade.findFirst({ where: { id: String(campos.unidadeId), empresaId, clienteId }, select: { id: true } });
  if (!unidade) throw new ErroLinha("A unidade desta linha não foi encontrada no cliente (na sua empresa).");
  const tipo = tipoRef ? tipos.get(tipoRef) : undefined;
  if (tipoRef && !tipo) throw new ErroLinha("Tipo de equipamento não encontrado (ou inativo).");
  if (l.status === "criar") {
    const t = tipo ?? tipos.get("e:OUTRO");
    if (!t) throw new ErroLinha("Tipo de equipamento não encontrado.");
    const novo = await prisma.equipamento.create({ data: { ...(campos as Prisma.EquipamentoUncheckedCreateInput), tipo: t.tipo as Prisma.EquipamentoUncheckedCreateInput["tipo"], tipoEquipamentoId: t.tipoEquipamentoId, empresaId, ativo: true, fotos: [] }, select: { id: true } });
    return { r: "criado", id: novo.id };
  }
  const existe = await prisma.equipamento.count({ where: { id: l.existenteId, empresaId, unidade: { clienteId } } });
  if (existe !== 1) throw new ErroLinha("O equipamento a atualizar não foi encontrado neste cliente (na sua empresa).");
  await atualizar(prisma.equipamento as unknown as Delegate, { id: l.existenteId, empresaId }, { ...campos, ...(tipo && { tipo: tipo.tipo, tipoEquipamentoId: tipo.tipoEquipamentoId }) });
  return { r: "atualizado", id: l.existenteId };
}

/**
 * Tipos de equipamento da planilha, resolvidos UMA vez e em sequência antes de gravar (o tipo do
 * sistema sem personalizado ganha o personalizado na 1ª vez — gravar em paralelo criaria vários).
 */
async function resolverTipos(linhas: LinhaAnalisada[], empresaId: string, criados: string[] = []) {
  const refs = new Set(linhas.filter((l) => l.status === "criar" || l.dados?.tipoRef).map((l) => String(l.dados?.tipoRef ?? "e:OUTRO")));
  const tipos = new Map<string, TipoResolvido>();
  for (const ref of refs) {
    // Tipo do sistema que ainda não tem o personalizado: a resolução CRIA o personalizado (entra no lote)
    const antes = ref.startsWith("e:") ? await prisma.tipoEquipamentoCustom.count({ where: { empresaId, chaveEnum: ref.slice(2) } }) : 1;
    const r = ref.startsWith("c:") ? await resolverTipoEquipamento(empresaId, "OUTRO", ref.slice(2)) : await resolverTipoEquipamento(empresaId, ref.slice(2), null);
    if (!("erro" in r)) {
      tipos.set(ref, r);
      if (antes === 0 && r.tipoEquipamentoId) criados.push(r.tipoEquipamentoId);
    }
  }
  return tipos;
}

export const OBS_SALDO_INICIAL = "Saldo inicial (planilha de implantação)";

/**
 * Estoque: leva o saldo do produto à quantidade da linha, lançando SÓ a diferença, com a linha do produto
 * travada (o saldo é relido aqui, nunca o da prévia). Subindo = ENTRADA de origem Inventário, com o custo
 * (vira o último custo de compra do produto); descendo = ajuste de inventário (sem custo); igual = nada.
 */
async function gravarEstoque(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string, usuarioId: string | null, ef: Efeitos): Promise<Feito> {
  const produtoId = l.existenteId!;
  const quantidade = Number(dados.quantidade);
  const custo = dados.custoUnitario === undefined ? null : Number(dados.custoUnitario);
  return prisma.$transaction(async (tx) => {
    const p = await tx.produto.update({ where: { id: produtoId, empresaId }, data: { saldo: { increment: 0 } }, select: { saldo: true, controlaEstoque: true, ativo: true } })
      .catch((e: { code?: string }) => { throw e?.code === "P2025" ? new ErroLinha("O produto desta linha não foi encontrado na sua empresa.") : e; });
    if (!p.controlaEstoque || !p.ativo) throw new ErroLinha("Este produto não controla estoque ou está inativo.");
    const atual = arred(Number(p.saldo));
    if (quantidade === atual) { ef.saldosIguais++; return { r: "igual" } as Feito; }
    const base = { empresaId, produtoId, usuarioId, observacao: OBS_SALDO_INICIAL, origem: "INVENTARIO" as const };
    if (quantidade > atual) await movimentar({ ...base, operacao: "ENTRADA", valor: arred(quantidade - atual), custoUnitario: custo }, tx);
    else await movimentar({ ...base, operacao: "INVENTARIO", valor: quantidade }, tx);
    return { r: "atualizado", id: produtoId } as Feito;
  });
}

/** Colaborador: cria (com o CPF formatado e o cargo conferido) ou atualiza só o que veio — nunca o CPF. */
async function gravarColaborador(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string): Promise<Feito> {
  if (dados.cargoId) await validarRefEmpresa("cargo", dados.cargoId as string, empresaId, "Cargo", { novoAtivo: true });
  delete dados.cargoNovo; // já virou cargoId (resolverCargos)
  if (l.status === "criar") {
    // Sem telefone entra vazio (a coluna é obrigatória), como na planilha da folha; a prévia avisou
    const novo = await prisma.tecnico.create({ data: { ...(dados as Prisma.TecnicoUncheckedCreateInput), telefone: (dados.telefone as string | undefined) ?? "", empresaId, ativo: true }, select: { id: true } });
    return { r: "criado", id: novo.id };
  }
  const { cpf: _cpf, ...resto } = dados;
  await atualizar(prisma.tecnico as unknown as Delegate, { id: l.existenteId, empresaId }, resto);
  return { r: "atualizado", id: l.existenteId };
}

/** Veículo: cria com a placa normalizada ou atualiza só o que veio — nunca a placa. Responsável conferido na empresa. */
async function gravarVeiculo(l: LinhaAnalisada, dados: Record<string, unknown>, empresaId: string): Promise<Feito> {
  if (dados.responsavelId) await validarRefEmpresa("tecnico", dados.responsavelId as string, empresaId, "Responsável");
  if (l.status === "criar") {
    const novo = await prisma.veiculo.create({ data: { ...(dados as Prisma.VeiculoUncheckedCreateInput), empresaId, fotos: [] }, select: { id: true } });
    return { r: "criado", id: novo.id };
  }
  const { placa: _placa, ...resto } = dados;
  await atualizar(prisma.veiculo as unknown as Delegate, { id: l.existenteId, empresaId }, resto);
  return { r: "atualizado", id: l.existenteId };
}

/** "AAAA-MM-DD" da planilha → a data (meio-dia UTC: o dia não muda em nenhum fuso do Brasil) */
const dataDe = (iso: unknown) => (typeof iso === "string" && iso ? new Date(`${iso}T12:00:00.000Z`) : null);

/**
 * Contrato da planilha (leva 6): SÓ cadastra. Nasce com tudo que cobra ou agenda DESLIGADO e, se veio "ativo",
 * SUSPENSO (só contrato ATIVO gera previsão de contas a receber, entra nas medições e gera OS — regra CO2). Não
 * chama a previsão nem a recorrência que a tela chama ao salvar. O número vazio vem da numeração da empresa.
 */
async function gravarContrato(dados: Record<string, unknown>, empresaId: string, usuarioId: string | null, ef: Efeitos): Promise<Feito> {
  const clienteId = dados.clienteId as string;
  await validarRefEmpresa("cliente", clienteId, empresaId, "Cliente");
  const unidadeIds = (dados.unidadeIds as string[] | undefined) ?? [];
  if (unidadeIds.length && (await prisma.unidade.count({ where: { id: { in: unidadeIds }, empresaId, clienteId } })) !== unidadeIds.length)
    throw new ErroLinha("unidades: uma das unidades não é mais deste cliente. Gere a prévia de novo.");
  const situacao = String(dados.situacao ?? "ATIVO");
  const status = statusImportado(situacao) as "SUSPENSO" | "ENCERRADO" | "CANCELADO";
  const autor = usuarioId && (await prisma.usuario.count({ where: { id: usuarioId, empresaId } })) ? usuarioId : null;
  const id = await prisma.$transaction(async (tx) => {
    const numero = (dados.numero as string | undefined) ?? await proximoNumero(tx, empresaId, "contrato");
    const c = await tx.contrato.create({
      data: {
        empresaId, clienteId, numero, status,
        tipo: dados.tipo as Prisma.ContratoUncheckedCreateInput["tipo"],
        periodicidade: dados.periodicidade as Prisma.ContratoUncheckedCreateInput["periodicidade"],
        dataInicio: dataDe(dados.dataInicio)!, dataFim: dataDe(dados.dataFim),
        valorMensal: (dados.valorMensal as number | undefined) ?? null, diaVencimento: (dados.diaVencimento as number | undefined) ?? null,
        descricaoServicos: (dados.descricaoServicos as string | undefined) ?? null, artNumero: (dados.artNumero as string | undefined) ?? null,
        observacoes: (dados.observacoes as string | undefined) ?? null,
        // DESLIGADO até a revisão (explícito: não depende do padrão do banco)
        faturamentoAutomatico: false, aprovacaoAutomatica: false, emitirNfseAuto: false, emitirBoletoAuto: false,
        recorrencia: false, renovacaoAutomatica: false, reajusteAtivo: false, reajusteNotificar: false,
        notificarClienteRenovacao: false, alertaEmailCliente: false,
        unidades: { create: unidadeIds.map((unidadeId) => ({ unidadeId })) },
      },
      select: { id: true },
    });
    if (status === "SUSPENSO" && autor)
      await tx.contratoHistoricoStatus.create({
        data: {
          empresaId, contratoId: c.id, statusAnterior: "ATIVO", statusNovo: "SUSPENSO", usuarioId: autor,
          motivo: "Importado por planilha (ativo na planilha): suspenso até a revisão de cobrança, NFS-e, boleto e recorrência.",
        },
      });
    return c.id;
  });
  if (status === "SUSPENSO") ef.contratosSuspensos++;
  return { r: "criado", id };
}

/** Plano PMOC da planilha (leva 6): SÓ cadastra, sempre em RASCUNHO (não gera cronograma, OS nem aviso). */
async function gravarPmoc(dados: Record<string, unknown>, empresaId: string, usuarioId: string | null): Promise<Feito> {
  const clienteId = dados.clienteId as string;
  const unidadeId = dados.unidadeId as string;
  await validarRefEmpresa("cliente", clienteId, empresaId, "Cliente");
  if (!(await prisma.unidade.count({ where: { id: unidadeId, empresaId, clienteId, ativo: true } })))
    throw new ErroLinha("unidade: não é mais uma unidade ativa deste cliente. Gere a prévia de novo.");
  const equipamentoIds = (dados.equipamentoIds as string[] | undefined) ?? [];
  if (equipamentoIds.length && (await prisma.equipamento.count({ where: { id: { in: equipamentoIds }, empresaId, ativo: true, unidade: { clienteId } } })) !== equipamentoIds.length)
    throw new ErroLinha("equipamentos: algum equipamento foi inativado ou não é mais deste cliente. Gere a prévia de novo.");
  const autor = usuarioId && (await prisma.usuario.count({ where: { id: usuarioId, empresaId } })) ? usuarioId : null;
  const p = await prisma.pmoc.create({
    data: {
      empresaId, clienteId, unidadeId, status: "RASCUNHO", criadoPorId: autor,
      nome: dados.nome as string, descricao: (dados.descricao as string | undefined) ?? null,
      dataInicio: dataDe(dados.dataInicio)!, dataExpiracao: dataDe(dados.dataExpiracao)!,
      rtNome: (dados.rtNome as string | undefined) ?? null, rtCrea: (dados.rtCrea as string | undefined) ?? null, artNumero: (dados.artNumero as string | undefined) ?? null,
      equipamentos: { create: equipamentoIds.map((equipamentoId) => ({ equipamentoId })) },
    },
    select: { id: true },
  });
  return { r: "criado", id: p.id };
}

/**
 * Cargos que a planilha cita e não existem: criados UMA vez cada (sem acento/maiúsculas), em sequência, antes de
 * gravar; o que já existe ativo (criado enquanto se importava) é reaproveitado. As linhas passam a ter o cargoId.
 */
export async function resolverCargos(linhas: LinhaAnalisada[], empresaId: string, criadosIds: string[] = []): Promise<string[]> {
  const novos = new Map<string, string>(); // chave → nome como veio na 1ª linha
  for (const l of linhas) { const n = l.dados?.cargoNovo as string | undefined; if (n && !novos.has(chaveNome(n))) novos.set(chaveNome(n), n); }
  const ids = new Map<string, string>();
  const criados: string[] = [];
  for (const [k, nome] of novos) {
    const existe = await prisma.cargo.findFirst({ where: { empresaId, ativo: true, nome: { equals: nome, mode: "insensitive" } }, select: { id: true } });
    if (existe) { ids.set(k, existe.id); continue; }
    const c = await prisma.cargo.create({ data: { empresaId, nome }, select: { id: true } });
    ids.set(k, c.id); criados.push(nome); criadosIds.push(c.id);
  }
  for (const l of linhas) {
    const n = l.dados?.cargoNovo as string | undefined;
    if (n) l.dados = { ...l.dados, cargoId: ids.get(chaveNome(n)), cargoNovo: undefined };
  }
  return criados.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Uma linha: cria (com os padrões do cadastro) ou atualiza só o que veio preenchido. */
async function gravarLinha(entidade: EntidadeImportacao, l: LinhaAnalisada, empresaId: string, ef: Efeitos, tipos: Map<string, TipoResolvido> = new Map(), usuarioId: string | null = null): Promise<Feito> {
  const dados = semIndefinidos(l.dados ?? {});
  // Nunca deixa a planilha escolher empresa, id ou situação
  delete dados.empresaId; delete dados.id; delete dados.ativo;
  if (entidade === "clientes") return gravarCliente(l, dados, empresaId, ef);
  if (entidade === "unidades" || entidade === "contatos") return gravarDoCliente(entidade, l, dados, empresaId, ef);
  if (entidade === "equipamentos") return gravarEquipamento(l, dados, empresaId, tipos);
  if (entidade === "estoque") return gravarEstoque(l, dados, empresaId, usuarioId, ef);
  if (entidade === "colaboradores") return gravarColaborador(l, dados, empresaId);
  if (entidade === "veiculos") return gravarVeiculo(l, dados, empresaId);
  // Contratos e PMOC só cadastram: uma linha que "casou" com um existente nunca chega aqui (é erro na prévia)
  if (entidade === "contratos" || entidade === "pmocs") {
    if (l.status !== "criar") throw new ErroLinha(`A planilha só cadastra ${entidade === "contratos" ? "contratos" : "planos PMOC"} novos.`);
    return entidade === "contratos" ? gravarContrato(dados, empresaId, usuarioId, ef) : gravarPmoc(dados, empresaId, usuarioId);
  }
  if (l.status === "criar") {
    // O código já foi reservado para a linha (gravarImportacao); o schema do produto não aceita código
    const { codigo, ...semCodigo } = dados;
    const cad = CADASTROS[entidade as "fornecedores" | "servicos" | "produtos"];
    const base = cad.schemaCriar.parse(semCodigo) as Record<string, unknown>;
    // Campo estruturado (ex.: materiais padrão do serviço, E3.2) não vem da planilha: o padrão do schema (lista vazia) fica de fora da gravação
    for (const c of cad.campos) if (c.tipo === "estruturado") delete base[c.key];
    const novo = await tabela(entidade).create({ data: { ...base, ...(codigo !== undefined && { codigo }), empresaId, ativo: true } }) as { id: string };
    return { r: "criado", id: novo.id };
  }
  // Casou pelo nome: o nome é a chave — "gas r410a" na planilha não renomeia o "Gás R410A" do cadastro
  if (l.chave?.startsWith("nome:")) delete dados.nome;
  await atualizar(tabela(entidade), { id: l.existenteId, empresaId }, dados);
  return { r: "atualizado", id: l.existenteId };
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
  /** O lote desta importação (Implantação › Importações), quando registrado */
  loteId?: string;
}

/** O cadastro do registro de cada planilha, nos itens do lote (a de estoque ATUALIZA produtos) */
export const ENTIDADE_DO_ITEM: Record<EntidadeImportacao, string> = {
  clientes: "clientes", unidades: "unidades", contatos: "contatos", equipamentos: "equipamentos", fornecedores: "fornecedores",
  servicos: "servicos", produtos: "produtos", estoque: "produtos", colaboradores: "colaboradores", veiculos: "veiculos",
  contratos: "contratos", pmocs: "pmocs",
};

type ItemLote = { entidade: string; registroId: string; acao: "CRIADO" | "ATUALIZADO"; linha: number | null };

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

export async function gravarImportacao(
  entidade: EntidadeImportacao, analise: Analise, empresaId: string,
  /** arquivo: o nome do arquivo enviado — com ele, a importação vira um LOTE (leva 5) */
  o: { usuarioId?: string | null; arquivo?: string } = {},
): Promise<ResultadoImportacao> {
  const res: ResultadoImportacao = { criados: 0, atualizados: 0, observacoes: [], avisos: [], erros: analise.linhas.filter((l) => l.status === "erro") };
  const ef: Efeitos = { unidadesPrincipais: 0, principaisTrocados: 0, saldosIguais: 0, contratosSuspensos: 0 };
  const gravar = analise.linhas.filter((l) => l.status !== "erro");
  await reservarCodigos(entidade, gravar, empresaId);
  const itens: ItemLote[] = [];
  const tiposCriados: string[] = [];
  const cargosCriadosIds: string[] = [];
  const tipos = entidade === "equipamentos" ? await resolverTipos(gravar, empresaId, tiposCriados) : new Map<string, TipoResolvido>();
  const cargosCriados = entidade === "colaboradores" ? await resolverCargos(gravar, empresaId, cargosCriadosIds) : [];
  for (const id of tiposCriados) itens.push({ entidade: "tiposEquipamento", registroId: id, acao: "CRIADO", linha: null });
  for (const id of cargosCriadosIds) itens.push({ entidade: "cargos", registroId: id, acao: "CRIADO", linha: null });
  for (let i = 0; i < gravar.length; i += TAMANHO_LOTE) {
    const lote = gravar.slice(i, i + TAMANHO_LOTE);
    // Unidades e contatos: uma linha por vez (o "principal" de um cliente não pode correr em paralelo); contratos
    // também (o número automático e o número digitado não podem disputar o mesmo valor)
    const feitos = entidade === "unidades" || entidade === "contatos" || entidade === "contratos" || entidade === "pmocs"
      ? await (async () => { const r: PromiseSettledResult<Feito>[] = []; for (const l of lote) r.push(...await Promise.allSettled([gravarLinha(entidade, l, empresaId, ef, tipos, o.usuarioId ?? null)])); return r; })()
      : await Promise.allSettled(lote.map((l) => gravarLinha(entidade, l, empresaId, ef, tipos, o.usuarioId ?? null)));
    feitos.forEach((f, k) => {
      if (f.status === "fulfilled") {
        const l = lote[k];
        if (f.value.r === "criado") res.criados++; else if (f.value.r === "atualizado") res.atualizados++;
        if (f.value.id && f.value.r !== "igual")
          itens.push({ entidade: ENTIDADE_DO_ITEM[entidade], registroId: f.value.id, acao: f.value.r === "criado" ? "CRIADO" : "ATUALIZADO", linha: l.linha });
        for (const x of f.value.extras ?? []) itens.push({ entidade: x.entidade, registroId: x.id, acao: "CRIADO", linha: null });
        if (l.avisos?.length) res.avisos.push({ linha: l.linha, rotulo: l.rotulo, valores: l.valores, avisos: l.avisos });
        return;
      }
      const e = f.reason as { code?: string; message?: string };
      const motivo = e instanceof ErroRefEmpresa || e instanceof ErroLinha || e instanceof ErroEstoque ? e.message
        : e?.code === "P2002" && String((e as { meta?: { target?: unknown } }).meta?.target ?? "").includes("codigo")
          ? "Este código já é de outro cadastro (ou foi usado enquanto você importava). Gere a prévia de novo."
        : e?.code === "P2002" ? `Já existe um registro com ${entidade === "veiculos" ? "esta placa" : entidade === "colaboradores" ? "este CPF" : entidade === "contratos" ? "este número de contrato" : "este documento"} (cadastrado enquanto você importava). Gere a prévia de novo.`
        : e?.message?.includes("não foi encontrado") ? e.message
        : "Não foi possível gravar esta linha.";
      res.erros.push({ ...lote[k], erros: [motivo] });
    });
  }
  res.erros.sort((a, b) => a.linha - b.linha);
  res.avisos.sort((a, b) => a.linha - b.linha);
  if (ef.contratosSuspensos)
    res.observacoes.push(`${ef.contratosSuspensos === 1 ? "1 contrato ativo entrou SUSPENSO" : `${ef.contratosSuspensos} contratos ativos entraram SUSPENSOS`}: faturamento automático, NFS-e, boleto, recorrência de OS, renovação automática e reajuste estão desligados. Revise cada um e ative pela tela do contrato — só então a cobrança começa.`);
  if (ef.unidadesPrincipais)
    res.observacoes.push(`${ef.unidadesPrincipais} ${ef.unidadesPrincipais === 1 ? "cliente ganhou" : "clientes ganharam"} a unidade “Principal” com o endereço do cadastro.`);
  if (cargosCriados.length)
    res.observacoes.push(`${cargosCriados.length === 1 ? "Cargo criado" : "Cargos criados"} (revise em Configurações › Cargos): ${cargosCriados.join(", ")}.`);
  if (ef.saldosIguais)
    res.observacoes.push(`${ef.saldosIguais} ${ef.saldosIguais === 1 ? "produto já estava" : "produtos já estavam"} com esse saldo: nada foi lançado.`);
  if (ef.principaisTrocados)
    res.observacoes.push(`${ef.principaisTrocados} ${entidade === "contatos" ? (ef.principaisTrocados === 1 ? "contato deixou" : "contatos deixaram") : (ef.principaisTrocados === 1 ? "unidade deixou" : "unidades deixaram")} de ser ${entidade === "contatos" ? "o principal" : "a principal"}: a planilha marcou outro.`);
  // O lote: quem, quando, o arquivo, as contagens e cada registro criado/atualizado (para "Desfazer lote")
  // Os dados já estão gravados: registrar o lote nunca derruba a importação (falhou = aviso no resultado)
  if (o.arquivo !== undefined) {
    try {
      const usuarioId = o.usuarioId && (await prisma.usuario.count({ where: { id: o.usuarioId } })) ? o.usuarioId : null;
      const lote = await prisma.importacaoLote.create({
        data: {
          empresaId, usuarioId, entidade, arquivo: o.arquivo.slice(0, 200) || "planilha",
          criados: res.criados, atualizados: res.atualizados, comErro: res.erros.length, avisos: res.avisos.length,
          itens: { createMany: { data: itens.map((x) => ({ ...x, empresaId })) } },
        },
        select: { id: true },
      });
      res.loteId = lote.id;
    } catch (e) {
      console.error("[importacao] lote não registrado", e);
      res.observacoes.push("Os dados foram gravados, mas o lote desta importação não foi registrado: ela não aparece em Implantação › Importações e não pode ser desfeita por lá.");
    }
  }
  return res;
}
