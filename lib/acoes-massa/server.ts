import { prisma } from "@/lib/prisma";
import { formatarData, LABELS_PRIORIDADE, LABELS_SEGMENTO, LABELS_STATUS_ORCAMENTO, LABELS_STATUS_OS } from "@/lib/utils";
import { lerFiltros, montarWhere } from "@/lib/equipamento-listagem";
import { lerFiltrosVeiculos, montarWhereVeiculos } from "@/lib/veiculo-listagem";
import { LABELS_FUNCAO, lerFiltrosColaboradores, montarWhereColaboradores } from "@/lib/colaborador-listagem";
import { whereClientes, whereContratos, whereOrcamentos, whereOrdens } from "@/lib/listas/filtros";
import { calcularStatusFinanceiroEmLote } from "@/lib/status-financeiro";
import { MAX_SELECAO, type AcaoItem, type Entidade } from "@/lib/acoes-massa/acoes";
import { idsCadastro, linhasCadastro, rotulosCadastro } from "@/lib/cadastros/servidor";
import type { EntidadeCadastro } from "@/lib/cadastros/registro";
import {
  cancelarOrcamento, cancelarOs, definirAtivoCadastro, definirAtivoCliente, definirAtivoEquipamento, gerarQrEquipamento, inativarColaborador,
  inativarVeiculo, reativarColaborador, reativarContrato, reativarOrcamento, reativarVeiculo, suspenderContrato,
  type ContextoItem, type ResultadoItem,
} from "@/lib/acoes-massa/regras";

/** Executor de cada ação (as mesmas funções das rotas individuais). */
export const EXECUTORES: Record<Entidade, Partial<Record<AcaoItem, (id: string, ctx: ContextoItem) => Promise<ResultadoItem>>>> = {
  ordens: { inativar: (id, ctx) => cancelarOs(id, ctx) },
  equipamentos: {
    inativar: (id, ctx) => definirAtivoEquipamento(id, false, ctx),
    reativar: (id, ctx) => definirAtivoEquipamento(id, true, ctx),
    "gerar-qr": gerarQrEquipamento,
  },
  clientes: { inativar: (id, ctx) => definirAtivoCliente(id, false, ctx), reativar: (id, ctx) => definirAtivoCliente(id, true, ctx) },
  orcamentos: { inativar: cancelarOrcamento, reativar: reativarOrcamento },
  contratos: { inativar: suspenderContrato, reativar: reativarContrato },
  veiculos: { inativar: inativarVeiculo, reativar: reativarVeiculo },
  colaboradores: { inativar: inativarColaborador, reativar: reativarColaborador },
  produtos: cadastro("produtos"),
  servicos: cadastro("servicos"),
  cargos: cadastro("cargos"),
  "categorias-financeiras": cadastro("categorias-financeiras"),
};

/** Cadastros padronizados: a mesma regra única de ativar/inativar da rota /api/cadastros. */
function cadastro(entidade: EntidadeCadastro) {
  return {
    inativar: (id: string, ctx: ContextoItem) => definirAtivoCadastro(entidade, id, false, ctx),
    reativar: (id: string, ctx: ContextoItem) => definirAtivoCadastro(entidade, id, true, ctx),
  };
}

/** Nome legível de cada registro (para o resultado mostrar QUAL não pôde), só da empresa da sessão. */
export async function rotulos(entidade: Entidade, ids: string[], empresaId: string): Promise<Map<string, string>> {
  const where = { id: { in: ids }, empresaId };
  let pares: [string, string][] = [];
  switch (entidade) {
    case "ordens":
      pares = (await prisma.ordemServico.findMany({ where, select: { id: true, numero: true, chamadoNumero: true } })).map((r) => [r.id, r.chamadoNumero ?? r.numero]);
      break;
    case "equipamentos":
      pares = (await prisma.equipamento.findMany({ where, select: { id: true, nome: true, marca: true, modelo: true, numeroSerie: true } }))
        .map((r) => [r.id, [r.nome || `${r.marca} ${r.modelo}`, r.numeroSerie && `série ${r.numeroSerie}`].filter(Boolean).join(" · ")]);
      break;
    case "clientes":
      pares = (await prisma.cliente.findMany({ where, select: { id: true, nome: true, nomeFantasia: true } })).map((r) => [r.id, r.nomeFantasia || r.nome]);
      break;
    case "orcamentos":
      pares = (await prisma.orcamento.findMany({ where, select: { id: true, codigo: true, nome: true } })).map((r) => [r.id, `${r.codigo} · ${r.nome}`]);
      break;
    case "contratos":
      pares = (await prisma.contrato.findMany({ where, select: { id: true, numero: true } })).map((r) => [r.id, r.numero]);
      break;
    case "veiculos":
      pares = (await prisma.veiculo.findMany({ where, select: { id: true, placa: true, modelo: true } })).map((r) => [r.id, `${r.placa} · ${r.modelo}`]);
      break;
    case "colaboradores":
      pares = (await prisma.tecnico.findMany({ where, select: { id: true, nome: true } })).map((r) => [r.id, r.nome]);
      break;
    case "produtos": case "servicos": case "cargos": case "categorias-financeiras":
      pares = await rotulosCadastro(entidade, ids, empresaId);
      break;
  }
  return new Map(pares);
}

/** Ids que batem no filtro da lista (mesmo where da página), até MAX_SELECAO. */
export async function idsDoFiltro(entidade: Entidade, filtro: string, empresaId: string): Promise<{ ids: string[]; total: number }> {
  const params = new URLSearchParams(filtro);
  const sp: Record<string, string> = Object.fromEntries(params.entries());
  const take = MAX_SELECAO + 1;
  const pegar = async (busca: Promise<{ id: string }[]>, contar: Promise<number>) => {
    const [linhas, total] = await Promise.all([busca, contar]);
    return { ids: linhas.slice(0, MAX_SELECAO).map((l) => l.id), total };
  };
  switch (entidade) {
    case "ordens": {
      const where = whereOrdens(empresaId, sp);
      return pegar(prisma.ordemServico.findMany({ where, select: { id: true }, orderBy: { criadoEm: "desc" }, take }), prisma.ordemServico.count({ where }));
    }
    case "equipamentos": {
      const where = montarWhere(empresaId, lerFiltros(sp));
      return pegar(prisma.equipamento.findMany({ where, select: { id: true }, take }), prisma.equipamento.count({ where }));
    }
    case "clientes": {
      const { where, statusFiltro } = whereClientes(empresaId, sp);
      if (!statusFiltro) return pegar(prisma.cliente.findMany({ where, select: { id: true }, orderBy: { nome: "asc" }, take }), prisma.cliente.count({ where }));
      // Status financeiro é calculado: filtra em memória, como a página
      const todos = await prisma.cliente.findMany({ where, select: { id: true }, orderBy: { nome: "asc" } });
      const mapa = await calcularStatusFinanceiroEmLote(empresaId, todos.map((c) => c.id));
      const ids = todos.filter((c) => (mapa[c.id] ?? "SEM_HISTORICO") === statusFiltro).map((c) => c.id);
      return { ids: ids.slice(0, MAX_SELECAO), total: ids.length };
    }
    case "orcamentos": {
      const where = whereOrcamentos(empresaId, sp);
      return pegar(prisma.orcamento.findMany({ where, select: { id: true }, orderBy: { criadoEm: "desc" }, take }), prisma.orcamento.count({ where }));
    }
    case "contratos": {
      const where = whereContratos(empresaId, sp);
      return pegar(prisma.contrato.findMany({ where, select: { id: true }, take }), prisma.contrato.count({ where }));
    }
    case "veiculos": {
      const where = montarWhereVeiculos(empresaId, lerFiltrosVeiculos(sp));
      return pegar(prisma.veiculo.findMany({ where, select: { id: true }, take }), prisma.veiculo.count({ where }));
    }
    case "colaboradores": {
      const where = montarWhereColaboradores(empresaId, lerFiltrosColaboradores(sp));
      return pegar(prisma.tecnico.findMany({ where, select: { id: true }, take }), prisma.tecnico.count({ where }));
    }
    case "produtos": case "servicos": case "cargos": case "categorias-financeiras":
      return idsCadastro(entidade, sp, empresaId, MAX_SELECAO);
  }
}

const d = (v: Date | null | undefined) => (v ? formatarData(v) : "");
const n = (v: unknown) => (v == null ? "" : String(Number(v)).replace(".", ","));

/** Linhas do CSV (cabeçalho + dados) dos registros escolhidos, só da empresa da sessão. */
export async function linhasExportacao(entidade: Entidade, ids: string[], empresaId: string): Promise<string[][]> {
  const where = { id: { in: ids }, empresaId };
  switch (entidade) {
    case "ordens": {
      const rs = await prisma.ordemServico.findMany({
        where, orderBy: { criadoEm: "desc" },
        select: { numero: true, chamadoNumero: true, status: true, prioridade: true, descricao: true, criadoEm: true, previsaoConclusao: true, dataConclusao: true,
          cliente: { select: { nome: true } }, unidade: { select: { nome: true } }, responsavel: { select: { nome: true } }, contrato: { select: { numero: true } } },
      });
      return [["Número", "Chamado", "Cliente", "Local", "Status", "Prioridade", "Responsável", "Contrato", "Descrição", "Aberta em", "Previsão", "Concluída em"],
        ...rs.map((r) => [r.numero, r.chamadoNumero ?? "", r.cliente.nome, r.unidade?.nome ?? "", LABELS_STATUS_OS[r.status] ?? r.status, LABELS_PRIORIDADE[r.prioridade] ?? r.prioridade,
          r.responsavel?.nome ?? "", r.contrato?.numero ?? "", r.descricao, d(r.criadoEm), d(r.previsaoConclusao), d(r.dataConclusao)])];
    }
    case "equipamentos": {
      const rs = await prisma.equipamento.findMany({
        where, orderBy: [{ marca: "asc" }, { modelo: "asc" }],
        select: { nome: true, marca: true, modelo: true, numeroSerie: true, patrimonio: true, capacidade: true, setor: true, localizacao: true, garantiaAte: true, ativo: true,
          unidade: { select: { nome: true, cliente: { select: { nome: true } } } }, tipoEquipamento: { select: { nome: true } }, qrcode: { select: { codigo: true } } },
      });
      return [["Nome", "Tipo", "Marca", "Modelo", "Nº de série", "Patrimônio", "Capacidade", "Cliente", "Local", "Setor", "Localização", "Garantia até", "QR Code", "Situação"],
        ...rs.map((r) => [r.nome ?? "", r.tipoEquipamento?.nome ?? "", r.marca, r.modelo, r.numeroSerie ?? "", r.patrimonio ?? "", r.capacidade ?? "", r.unidade.cliente.nome, r.unidade.nome,
          r.setor ?? "", r.localizacao ?? "", d(r.garantiaAte), r.qrcode?.codigo ?? "", r.ativo ? "Ativo" : "Inativo"])];
    }
    case "clientes": {
      const rs = await prisma.cliente.findMany({
        where, orderBy: { nome: "asc" },
        select: { nome: true, nomeFantasia: true, cpfCnpj: true, email: true, telefone: true, celular: true, contato: true, segmento: true, cidade: true, estado: true, ativo: true, criadoEm: true },
      });
      return [["Nome / Razão social", "Nome fantasia", "CPF/CNPJ", "E-mail", "Telefone", "Celular", "Contato", "Segmento", "Cidade", "UF", "Situação", "Cadastrado em"],
        ...rs.map((r) => [r.nome, r.nomeFantasia ?? "", r.cpfCnpj, r.email ?? "", r.telefone ?? "", r.celular ?? "", r.contato ?? "", r.segmento ? LABELS_SEGMENTO[r.segmento] ?? r.segmento : "",
          r.cidade ?? "", r.estado ?? "", r.ativo ? "Ativo" : "Inativo", d(r.criadoEm)])];
    }
    case "orcamentos": {
      const rs = await prisma.orcamento.findMany({
        where, orderBy: { criadoEm: "desc" },
        select: { codigo: true, nome: true, tipo: true, status: true, totalGeral: true, validadeEm: true, criadoEm: true, enviadoEm: true, assinadoEm: true, cliente: { select: { nome: true } } },
      });
      return [["Código", "Nome", "Cliente", "Tipo", "Status", "Total (R$)", "Criado em", "Enviado em", "Validade", "Aprovado em"],
        ...rs.map((r) => [r.codigo, r.nome, r.cliente.nome, r.tipo, LABELS_STATUS_ORCAMENTO[r.status] ?? r.status, n(r.totalGeral), d(r.criadoEm), d(r.enviadoEm), d(r.validadeEm), d(r.assinadoEm)])];
    }
    case "contratos": {
      const rs = await prisma.contrato.findMany({
        where, orderBy: { dataInicio: "desc" },
        select: { numero: true, tipo: true, status: true, periodicidade: true, valorMensal: true, dataInicio: true, dataFim: true, cliente: { select: { nome: true } } },
      });
      return [["Número", "Cliente", "Tipo", "Status", "Periodicidade", "Valor mensal (R$)", "Início", "Fim"],
        ...rs.map((r) => [r.numero, r.cliente.nome, r.tipo, r.status, r.periodicidade, n(r.valorMensal), d(r.dataInicio), d(r.dataFim)])];
    }
    case "veiculos": {
      const rs = await prisma.veiculo.findMany({
        where, orderBy: { placa: "asc" },
        select: { placa: true, marca: true, modelo: true, ano: true, tipo: true, status: true, quilometragemAtual: true, proximaRevisaoData: true, seguroVencimento: true,
          responsavel: { select: { nome: true } }, equipe: { select: { nome: true } } },
      });
      return [["Placa", "Marca", "Modelo", "Ano", "Tipo", "Status", "Km atual", "Próxima revisão", "Seguro vence", "Responsável", "Equipe"],
        ...rs.map((r) => [r.placa, r.marca ?? "", r.modelo, r.ano ?? "", r.tipo, r.status, r.quilometragemAtual != null ? String(r.quilometragemAtual) : "", d(r.proximaRevisaoData), d(r.seguroVencimento),
          r.responsavel?.nome ?? "", r.equipe?.nome ?? ""])];
    }
    case "colaboradores": {
      // Sem salário, CPF/RG e endereço: a exportação da lista traz só o que a lista mostra
      const rs = await prisma.tecnico.findMany({
        where, orderBy: { nome: "asc" },
        select: { nome: true, tipo: true, telefone: true, email: true, dataAdmissao: true, ativo: true, statusColaborador: true, especialidades: true,
          cargo: { select: { nome: true } }, equipesMembro: { select: { nome: true } } },
      });
      return [["Nome", "Função", "Cargo", "Telefone", "E-mail", "Equipes", "Especialidades", "Admissão", "Situação"],
        ...rs.map((r) => [r.nome, LABELS_FUNCAO[r.tipo] ?? r.tipo, r.cargo?.nome ?? "", r.telefone, r.email ?? "", r.equipesMembro.map((e) => e.nome).join(", "),
          r.especialidades.join(", "), d(r.dataAdmissao), r.ativo ? r.statusColaborador : "INATIVO"])];
    }
    case "produtos": case "servicos": case "cargos": case "categorias-financeiras":
      return linhasCadastro(entidade, ids, empresaId);
  }
}

/** CSV para o Excel brasileiro (`;` + BOM). Células que começam com = + - @ ganham ' (anti-injeção de fórmula). */
export function gerarCsvExportacao(linhas: string[][]) {
  const campo = (v: string) => {
    let s = v ?? "";
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(campo).join(";")).join("\r\n") + "\r\n";
}
