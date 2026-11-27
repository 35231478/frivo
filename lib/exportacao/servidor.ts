/**
 * "Exportar dados da empresa (backup portátil)" — a parte do SERVIDOR: lê o banco em lotes e entrega cada
 * planilha do pacote em pedaços (CSV em bytes), para o zip em streaming (lib/zip-stream).
 *
 * Regras que não se dobram:
 *  - TODA consulta filtra pela empresa da sessão (`empresaId`); os itens sem coluna própria de empresa (itens da
 *    OS e do orçamento) filtram pela empresa do pai. O teste de vazamento com duas empresas trava isso.
 *  - Lotes de LOTE registros, em ordem de id (cursor): a memória fica do tamanho de um lote, não da empresa.
 *  - Colaboradores: só o cadastro operacional — a consulta nem seleciona salário, senha, dados bancários ou
 *    documentos pessoais (lib/importacao/servidor, carregarExportacao).
 *  - Os cadastros que a Implantação importa saem com as MESMAS colunas da planilha de importação.
 */
import { prisma } from "@/lib/prisma";
import { defPara, OPCOES_PERIODICIDADE, OPCOES_TIPO_CONTRATO, type EntidadeImportacao } from "@/lib/importacao/entidades";
import type { OpcaoRef } from "@/lib/importacao/motor";
import { carregarExportacao } from "@/lib/importacao/servidor";
import {
  LABELS_FORMA_PAGAMENTO, LABELS_ORIGEM_OS, LABELS_PRIORIDADE, LABELS_STATUS_CONTA_RECEBER, LABELS_STATUS_ORCAMENTO, LABELS_STATUS_OS,
  LABELS_TIPO_ORCAMENTO,
} from "@/lib/utils";
import { LABELS_STATUS_CONTA_PAGAR } from "@/lib/financeiro-status";
import type { ArquivoStream } from "@/lib/zip-stream";
import {
  arquivosDaParte, BOM, COLUNAS, dia, dinheiro, instante, leiaMe, linhaCsv, numero, rotulo, simNao,
  type ArquivoId, type ArquivoProprio, type InfoLeiaMe, type Parte,
} from "@/lib/exportacao/arquivos";

/** Registros por consulta. */
export const LOTE = 500;

type Linha = readonly unknown[];
type Lotes = AsyncIterable<Linha[]>;

/** Quantas linhas (sem o cabeçalho) cada arquivo teve — vai para o registro da exportação. */
export interface Contagem { linhas: number }

const codificador = new TextEncoder();

/** O CSV de um arquivo em pedaços: BOM + cabeçalho, depois um pedaço por lote. */
export async function* csvEmPedacos(cabecalho: readonly string[], lotes: Lotes, conta?: Contagem): AsyncGenerator<Uint8Array> {
  yield codificador.encode(BOM + linhaCsv(cabecalho));
  for await (const lote of lotes) {
    if (!lote.length) continue;
    if (conta) conta.linhas += lote.length;
    yield codificador.encode(lote.map(linhaCsv).join(""));
  }
}

/** Percorre uma consulta em lotes por id: `buscar(depoisDe)` devolve até LOTE registros com id > depoisDe. */
export async function* emLotes<T extends { id: string }>(buscar: (depoisDe: string | null, take: number) => Promise<T[]>, take = LOTE): AsyncGenerator<T[]> {
  let cursor: string | null = null;
  for (;;) {
    const lote = await buscar(cursor, take);
    if (!lote.length) return;
    yield lote;
    if (lote.length < take) return;
    cursor = lote[lote.length - 1].id;
  }
}

/** Transforma cada lote. */
async function* mapear<T>(lotes: AsyncIterable<T[]>, f: (lote: T[]) => Linha[] | Promise<Linha[]>): Lotes {
  for await (const l of lotes) yield await f(l);
}

const depois = (depoisDe: string | null) => (depoisDe ? { id: { gt: depoisDe } } : {});
const porId = { id: "asc" as const };
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ───────── os cadastros da Implantação (mesmas colunas) ───────── */

/**
 * As opções que os exportadores da importação consultam (nomes de tabela de preço, tipo de equipamento
 * personalizado e cargo) — TODAS da empresa, inclusive as inativas, para o nome sair mesmo de um cadastro antigo.
 */
export async function refsDaEmpresa(empresaId: string): Promise<Record<string, OpcaoRef[]>> {
  const [tabelas, tipos, cargos] = await Promise.all([
    prisma.tabelaPreco.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
    prisma.tipoEquipamentoCustom.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
    prisma.cargo.findMany({ where: { empresaId }, select: { id: true, nome: true } }),
  ]);
  return {
    tabela_preco: tabelas.map((t) => ({ valor: t.id, rotulo: t.nome })),
    tipo: tipos.map((t) => ({ valor: `c:${t.id}`, rotulo: t.nome })),
    cargo: cargos.map((c) => ({ valor: c.id, rotulo: c.nome })),
  };
}

/** A planilha de importação como o administrador a vê (com o custo, no estoque). */
export const defExportacao = (entidade: EntidadeImportacao) => defPara(entidade, () => true, "ADMIN");

function cadastroDaImportacao(entidade: EntidadeImportacao, empresaId: string, refs: Record<string, OpcaoRef[]>, conta: Contagem) {
  const def = defExportacao(entidade);
  const lotes = emLotes((depoisDe, take) => carregarExportacao(entidade, empresaId, { verCusto: true, pagina: { depoisDe, take } }) as Promise<{ id: string }[]>);
  return csvEmPedacos(def.colunas.map((c) => c.titulo), mapear(lotes, (rs) => rs.map((r) => {
    const v = def.exportar(r, refs);
    return def.colunas.map((c) => v[c.chave] ?? "");
  })), conta);
}

/** Situação do contrato nas três opções que a importação aceita (o "ativo" entra Suspenso ao importar). */
export function situacaoContratoImportacao(status: string): string {
  if (status === "CANCELADO") return "Cancelado";
  if (status === "ENCERRADO" || status === "VENCIDO") return "Encerrado";
  return "Ativo";
}

const rotuloOpcao = (opcoes: OpcaoRef[], v: unknown) => opcoes.find((o) => o.valor === v)?.rotulo ?? (v == null ? "" : String(v));

function contratos(empresaId: string, conta: Contagem) {
  const def = defExportacao("contratos");
  const lotes = emLotes((depoisDe, take) => prisma.contrato.findMany({
    where: { empresaId, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, numero: true, tipo: true, status: true, dataInicio: true, dataFim: true, valorMensal: true, periodicidade: true, diaVencimento: true,
      descricaoServicos: true, artNumero: true, observacoes: true,
      cliente: { select: { cpfCnpj: true } },
      unidades: { where: { unidade: { empresaId } }, select: { unidade: { select: { nome: true } } } },
    },
  }));
  return csvEmPedacos(def.colunas.map((c) => c.titulo), mapear(lotes, (cs) => cs.map((c) => {
    const v: Record<string, string> = {
      numero: c.numero, cnpj_cpf: c.cliente?.cpfCnpj ?? "", tipo: rotuloOpcao(OPCOES_TIPO_CONTRATO, c.tipo), situacao: situacaoContratoImportacao(c.status),
      data_inicio: dia(c.dataInicio), data_fim: dia(c.dataFim), valor_mensal: dinheiro(n(c.valorMensal)), periodicidade: rotuloOpcao(OPCOES_PERIODICIDADE, c.periodicidade),
      dia_vencimento: c.diaVencimento == null ? "" : String(c.diaVencimento), unidades: c.unidades.map((u) => u.unidade.nome).join("; "),
      descricao_servicos: c.descricaoServicos ?? "", art_numero: c.artNumero ?? "", observacoes: c.observacoes ?? "",
    };
    return def.colunas.map((col) => v[col.chave] ?? "");
  })), conta);
}

function pmocs(empresaId: string, conta: Contagem) {
  const def = defExportacao("pmocs");
  // Plano excluído (ativo = false) não volta no backup
  const lotes = emLotes((depoisDe, take) => prisma.pmoc.findMany({
    where: { empresaId, ativo: true, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, nome: true, dataInicio: true, dataExpiracao: true, rtNome: true, rtCrea: true, artNumero: true, descricao: true,
      cliente: { select: { cpfCnpj: true } }, unidade: { select: { nome: true, principal: true } },
      equipamentos: { where: { equipamento: { empresaId } }, select: { equipamento: { select: { numeroSerie: true } } } },
    },
  }));
  return csvEmPedacos(def.colunas.map((c) => c.titulo), mapear(lotes, (ps) => ps.map((p) => {
    const v: Record<string, string> = {
      cnpj_cpf: p.cliente?.cpfCnpj ?? "", unidade: p.unidade?.principal ? "" : p.unidade?.nome ?? "", nome: p.nome,
      data_inicio: dia(p.dataInicio), data_expiracao: dia(p.dataExpiracao),
      equipamentos: p.equipamentos.map((e) => e.equipamento.numeroSerie?.trim()).filter(Boolean).join("; "),
      rt_nome: p.rtNome ?? "", rt_crea: p.rtCrea ?? "", art_numero: p.artNumero ?? "", descricao: p.descricao ?? "",
    };
    return def.colunas.map((col) => v[col.chave] ?? "");
  })), conta);
}

/* ───────── operação ───────── */

const TIPO_ITEM: Record<string, string> = { SERVICO: "Serviço", PRODUTO: "Produto" };
const STATUS_ATIVIDADE: Record<string, string> = { AGENDADA: "Agendada", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };

function ordensServico(empresaId: string, conta: Contagem) {
  const lotes = emLotes((depoisDe, take) => prisma.ordemServico.findMany({
    where: { empresaId, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, numero: true, descricao: true, prioridade: true, status: true, origem: true, previsaoConclusao: true, prazoExecucao: true,
      dataInicio: true, dataConclusao: true, observacoes: true, criadoEm: true,
      cliente: { select: { cpfCnpj: true, nome: true } }, unidade: { select: { nome: true } }, contrato: { select: { numero: true } },
      orcamentoOrigem: { select: { codigo: true } }, responsavel: { select: { nome: true } },
    },
  }));
  return csvEmPedacos(COLUNAS.os, mapear(lotes, async (os) => {
    // Totais pelos itens da OS (o mesmo que a tela soma), numa consulta por lote
    const somas = await prisma.osItemOrcamento.groupBy({
      by: ["ordemServicoId", "tipo"], where: { ordemServicoId: { in: os.map((o) => o.id) }, ordemServico: { empresaId } }, _sum: { valorTotal: true },
    });
    const soma = (id: string, tipo: string) => n(somas.find((s) => s.ordemServicoId === id && s.tipo === tipo)?._sum.valorTotal) ?? 0;
    return os.map((o) => {
      const sv = soma(o.id, "SERVICO"), pr = soma(o.id, "PRODUTO");
      return [o.numero, o.cliente?.cpfCnpj ?? "", o.cliente?.nome ?? "", o.unidade?.nome ?? "", o.contrato?.numero ?? "", o.orcamentoOrigem?.codigo ?? "",
        o.descricao, rotulo(LABELS_PRIORIDADE, o.prioridade), rotulo(LABELS_STATUS_OS, o.status), rotulo(LABELS_ORIGEM_OS, o.origem), o.responsavel?.nome ?? "",
        dia(o.previsaoConclusao), instante(o.prazoExecucao), instante(o.dataInicio), instante(o.dataConclusao),
        dinheiro(sv), dinheiro(pr), dinheiro(sv + pr), o.observacoes ?? "", instante(o.criadoEm), o.id];
    });
  }), conta);
}

function itensOs(empresaId: string, conta: Contagem) {
  const lotes = emLotes((depoisDe, take) => prisma.osItemOrcamento.findMany({
    where: { ordemServico: { empresaId }, ...depois(depoisDe) }, orderBy: porId, take,
    select: { id: true, ordem: true, tipo: true, descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, executado: true, executadoEm: true, ordemServico: { select: { numero: true } } },
  }));
  return csvEmPedacos(COLUNAS.os_itens, mapear(lotes, (is) => is.map((i) => [
    i.ordemServico.numero, i.ordem, rotulo(TIPO_ITEM, i.tipo), i.descricao, numero(n(i.quantidade)), dinheiro(n(i.valorUnitario)), dinheiro(n(i.valorTotal)),
    simNao(i.executado), instante(i.executadoEm), i.id,
  ])), conta);
}

function atividadesOs(empresaId: string, conta: Contagem) {
  const lotes = emLotes((depoisDe, take) => prisma.atividadeOs.findMany({
    where: { empresaId, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, titulo: true, status: true, dataAgendada: true, prazo: true, iniciadaEm: true, concluidaEm: true, duracaoMin: true, observacao: true, resumo: true,
      ordemServico: { select: { numero: true } }, tecnico: { select: { nome: true } },
    },
  }));
  return csvEmPedacos(COLUNAS.os_atividades, mapear(lotes, (as) => as.map((a) => [
    a.ordemServico.numero, a.titulo, rotulo(STATUS_ATIVIDADE, a.status), a.tecnico?.nome ?? "", instante(a.dataAgendada), instante(a.prazo),
    instante(a.iniciadaEm), instante(a.concluidaEm), a.duracaoMin ?? "", a.observacao ?? "", a.resumo ?? "", a.id,
  ])), conta);
}

/** Desconto: "10%" quando é percentual; senão o valor. */
const desconto = (valor: unknown, tipo: string) => (tipo === "PERCENTUAL" ? `${numero(n(valor))}%` : dinheiro(n(valor)));

function orcamentos(empresaId: string, conta: Contagem) {
  const lotes = emLotes((depoisDe, take) => prisma.orcamento.findMany({
    where: { empresaId, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, codigo: true, nome: true, tipo: true, status: true, validadeEm: true, totalServicos: true, totalProdutos: true, desconto: true, tipoDesconto: true,
      valorIss: true, totalGeral: true, formaPagamento: true, condicaoPagamento: true, garantiaServico: true, garantiaPecas: true, enviadoEm: true,
      assinadoEm: true, assinadoPor: true, criadoEm: true,
      cliente: { select: { cpfCnpj: true, nome: true } }, unidade: { select: { nome: true } },
    },
  }));
  return csvEmPedacos(COLUNAS.orcamentos, mapear(lotes, (os) => os.map((o) => [
    o.codigo, o.nome, o.cliente?.cpfCnpj ?? "", o.cliente?.nome ?? "", o.unidade?.nome ?? "", rotulo(LABELS_TIPO_ORCAMENTO, o.tipo), rotulo(LABELS_STATUS_ORCAMENTO, o.status),
    dia(o.validadeEm), dinheiro(n(o.totalServicos)), dinheiro(n(o.totalProdutos)), desconto(o.desconto, o.tipoDesconto), dinheiro(n(o.valorIss)), dinheiro(n(o.totalGeral)),
    o.formaPagamento ?? "", o.condicaoPagamento ?? "", o.garantiaServico ?? "", o.garantiaPecas ?? "", instante(o.enviadoEm), instante(o.assinadoEm), o.assinadoPor ?? "",
    instante(o.criadoEm), o.id,
  ])), conta);
}

/** Itens do orçamento: primeiro os serviços, depois os produtos (cada um com o seu tipo). */
async function* itensOrcamentoLotes(empresaId: string): Lotes {
  const sel = { id: true, ordem: true, descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, observacao: true, orcamento: { select: { codigo: true } } } as const;
  type Item = { id: string; ordem: number; descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; observacao: string | null; orcamento: { codigo: string } };
  const linha = (tipo: string) => (i: Item): Linha => [
    i.orcamento.codigo, i.ordem, tipo, i.descricao, numero(n(i.quantidade)), dinheiro(n(i.valorUnitario)), dinheiro(n(i.valorTotal)), i.observacao ?? "", i.id,
  ];
  for await (const l of emLotes((depoisDe, take) => prisma.orcamentoServico.findMany({ where: { orcamento: { empresaId }, ...depois(depoisDe) }, orderBy: porId, take, select: sel })))
    yield l.map(linha("Serviço"));
  for await (const l of emLotes((depoisDe, take) => prisma.orcamentoProduto.findMany({ where: { orcamento: { empresaId }, ...depois(depoisDe) }, orderBy: porId, take, select: sel })))
    yield l.map(linha("Produto"));
}

/* ───────── financeiro ───────── */

const referencia = (mes: number | null, ano: number | null) => (mes && ano ? `${String(mes).padStart(2, "0")}/${ano}` : "");

function contasReceber(empresaId: string, conta: Contagem) {
  // A excluída (excluidaEm) some das telas e do backup; a cancelada fica, com a situação
  const lotes = emLotes((depoisDe, take) => prisma.contaReceber.findMany({
    where: { empresaId, excluidaEm: null, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, numero: true, descricao: true, valor: true, valorRecebido: true, status: true, dataVencimento: true, dataRecebimento: true, formaPagamento: true,
      parcelaNumero: true, parcelaTotal: true, categoria: true, refMes: true, refAno: true, observacao: true, criadoEm: true,
      cliente: { select: { cpfCnpj: true, nome: true } }, categoriaFinanceira: { select: { nome: true } },
      contrato: { select: { numero: true } }, orcamento: { select: { codigo: true } },
    },
  }));
  return csvEmPedacos(COLUNAS.contas_receber, mapear(lotes, (cs) => cs.map((c) => [
    c.numero, c.cliente?.cpfCnpj ?? "", c.cliente?.nome ?? "", c.descricao, dinheiro(n(c.valor)), dinheiro(n(c.valorRecebido)), rotulo(LABELS_STATUS_CONTA_RECEBER, c.status),
    dia(c.dataVencimento), dia(c.dataRecebimento), rotulo(LABELS_FORMA_PAGAMENTO, c.formaPagamento),
    c.parcelaNumero ? `${c.parcelaNumero}/${c.parcelaTotal ?? ""}` : "", c.categoriaFinanceira?.nome ?? c.categoria ?? "", referencia(c.refMes, c.refAno),
    c.contrato?.numero ?? "", c.orcamento?.codigo ?? "", c.observacao ?? "", instante(c.criadoEm), c.id,
  ])), conta);
}

function contasPagar(empresaId: string, conta: Contagem) {
  const lotes = emLotes((depoisDe, take) => prisma.contaPagar.findMany({
    where: { empresaId, ...depois(depoisDe) }, orderBy: porId, take,
    select: {
      id: true, numero: true, fornecedor: true, fornecedorCnpj: true, descricao: true, valorTotal: true, valorPago: true, saldoRestante: true, status: true,
      dataVencimento: true, dataPagamento: true, formaPagamento: true, refMes: true, refAno: true, observacao: true, criadoEm: true,
    },
  }));
  return csvEmPedacos(COLUNAS.contas_pagar, mapear(lotes, (cs) => cs.map((c) => [
    c.numero, c.fornecedor, c.fornecedorCnpj ?? "", c.descricao, dinheiro(n(c.valorTotal)), dinheiro(n(c.valorPago)), dinheiro(n(c.saldoRestante)),
    rotulo(LABELS_STATUS_CONTA_PAGAR, c.status), dia(c.dataVencimento), dia(c.dataPagamento), rotulo(LABELS_FORMA_PAGAMENTO, c.formaPagamento),
    referencia(c.refMes, c.refAno), c.observacao ?? "", instante(c.criadoEm), c.id,
  ])), conta);
}

/* ───────── o pacote ───────── */

const PROPRIOS: Record<ArquivoProprio, (empresaId: string, conta: Contagem) => AsyncIterable<Uint8Array>> = {
  os: ordensServico,
  os_itens: itensOs,
  os_atividades: atividadesOs,
  orcamentos,
  orcamentos_itens: (empresaId, conta) => csvEmPedacos(COLUNAS.orcamentos_itens, itensOrcamentoLotes(empresaId), conta),
  contas_receber: contasReceber,
  contas_pagar: contasPagar,
};

/** O conteúdo de um arquivo do pacote, em pedaços. */
export function conteudoDoArquivo(id: ArquivoId, empresaId: string, refs: () => Promise<Record<string, OpcaoRef[]>>, conta: Contagem): AsyncIterable<Uint8Array> {
  if (id === "contratos") return contratos(empresaId, conta);
  if (id === "pmocs") return pmocs(empresaId, conta);
  if (id in PROPRIOS) return PROPRIOS[id as ArquivoProprio](empresaId, conta);
  return (async function* () { yield* cadastroDaImportacao(id as EntidadeImportacao, empresaId, await refs(), conta); })();
}

/**
 * Os arquivos do pacote de uma parte (o LEIA-ME primeiro). Nada é consultado aqui: cada arquivo só lê o banco
 * quando o zip chega nele. `contagens` recebe as linhas de cada arquivo à medida que saem.
 */
export function arquivosDoPacote(empresaId: string, parte: Parte, info: Omit<InfoLeiaMe, "parte">, contagens: Map<ArquivoId, Contagem> = new Map()): ArquivoStream[] {
  let refs: Promise<Record<string, OpcaoRef[]>> | null = null;
  const refsUmaVez = () => (refs ??= refsDaEmpresa(empresaId));
  return [
    { nome: "LEIA-ME.txt", partes: async function* () { yield codificador.encode(leiaMe({ ...info, parte })); } },
    ...arquivosDaParte(parte).map((a) => {
      const conta: Contagem = { linhas: 0 };
      contagens.set(a.id, conta);
      return { nome: a.nome, partes: () => conteudoDoArquivo(a.id, empresaId, refsUmaVez, conta) };
    }),
  ];
}
