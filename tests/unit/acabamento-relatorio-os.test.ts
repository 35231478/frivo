/**
 * Acabamento do Tema 4 — relatório da OS e os números da OS:
 *  - as "Fotos do serviço" tiradas no app entram no relatório: no bloco do equipamento ATENDIDO, ou
 *    na seção "Fotos do serviço" (as gerais e as de equipamento não atendido);
 *  - o cabeçalho da OS conta equipamento DISTINTO (a mesma regra do card e do relatório).
 * (A prova com banco real — inclusive o card "Fotos" só com as da execução — está em os-fotos-anexos-pg.)
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blocosAtendidos, fotosServicoDe, LEGENDA_FOTO_SERVICO, montarRelatorioOs, type AtividadeParaBlocos, type OsParaRelatorio } from "@/lib/relatorio-os/dados";
import { CONFIG_RELATORIO_PADRAO } from "@/lib/relatorio-os/config";
import { RelatorioOsDocumento, SecaoFotosServico } from "@/components/relatorio/relatorio-os-documento";
import { AtividadeDocumento } from "@/components/relatorio/atividade-documento";
import { centralDaOs, type OsCentralEntrada } from "@/lib/os/central";
import { contarEquipamentosAtendidos } from "@/lib/os/equipamentos-atendidos";

const IMG = (s: string) => `data:image/png;base64,${s}`;
const equip = (id: string, nome: string) => ({ id, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", numeroSerie: null, patrimonio: null, nome, capacidade: null, setor: null, localizacao: null, tipoEquipamento: null });
const A = equip("eqA", "Split da recepção"), B = equip("eqB", "Split do auditório");
const ativ = (id: string, status: string, extra: Partial<AtividadeParaBlocos> = {}): AtividadeParaBlocos => ({
  id, titulo: `Atividade ${id}`, status, criadoEm: new Date("2026-11-01T12:00:00Z"), dataAgendada: null, duracaoMin: null, observacao: null, resumo: null,
  respostas: [], equipamentos: [], respostasEquipamento: [], ...extra,
});
const foto = (marca: string, legenda: string | null, e: typeof A | null) => ({ conteudo: IMG(marca), legenda, equipamentoId: e?.id ?? null, equipamento: e });

describe("fotos do serviço (app) no relatório", () => {
  const ativs = [
    ativ("a1", "CONCLUIDA", {
      equipamentos: [{ feito: true, equipamento: A }, { feito: false, equipamento: B }],
      fotosAtendimento: [{ id: "f1", equipamentoId: "eqA", url: IMG("antes"), momento: "ANTES" }],
      anexosOs: [foto("dreno", "Dreno desobstruído", A), foto("quadro", "Quadro elétrico", null), foto("semacesso", "Sem acesso", B), foto("semlegenda", "  ", null)],
    }),
    ativ("a2", "EM_ANDAMENTO", { anexosOs: [foto("outra-atividade", "Filtro trocado", A)] }),
    ativ("a3", "CANCELADA", { anexosOs: [foto("cancelada", "Não vale", A), foto("cancelada-geral", "Não vale", null)] }),
  ];

  it("a foto de um equipamento ATENDIDO vai para o bloco dele, depois das do checklist, com a legenda do técnico", () => {
    const { blocos } = blocosAtendidos(ativs, "Matriz");
    expect(blocos.map((b) => b.id)).toEqual(["eqA"]);
    expect(blocos[0].fotos).toEqual([
      { url: IMG("antes"), legenda: "Antes do serviço" },
      { url: IMG("dreno"), legenda: "Dreno desobstruído" },
      { url: IMG("outra-atividade"), legenda: "Filtro trocado" }, // tirada em outra atividade da OS: é do mesmo equipamento
    ]);
  });

  it("as gerais da OS e as de equipamento NÃO atendido vão para 'Fotos do serviço' (a do equipamento leva o nome dele)", () => {
    const { fotosServico } = blocosAtendidos(ativs, "Matriz");
    expect(fotosServico).toEqual([
      { url: IMG("quadro"), legenda: "Quadro elétrico" },
      { url: IMG("semacesso"), legenda: "Sem acesso — Split do auditório" },
      { url: IMG("semlegenda"), legenda: LEGENDA_FOTO_SERVICO }, // foto antiga sem legenda: não sai sem texto
    ]);
  });

  it("atividade cancelada não leva foto; o que não é imagem (documento) nunca vira foto", () => {
    const tudo = JSON.stringify(blocosAtendidos(ativs, "Matriz"));
    expect(tudo).not.toContain(IMG("cancelada"));
    const doc = { conteudo: "data:application/pdf;base64,JVBERi0=", legenda: "Laudo", equipamentoId: null, equipamento: null };
    const r = fotosServicoDe([ativ("x", "CONCLUIDA", { anexosOs: [doc] })], new Set());
    expect(r.gerais).toEqual([]);
    expect(r.doEquipamento.size).toBe(0);
  });

  it("sem foto do serviço nada muda: o relatório sai igual (e a seção não aparece)", () => {
    const { blocos, fotosServico } = blocosAtendidos([ativ("a1", "CONCLUIDA", { equipamentos: [{ feito: true, equipamento: A }] })], "Matriz");
    expect(fotosServico).toEqual([]);
    expect(blocos[0].fotos).toEqual([]);
    expect(renderToStaticMarkup(createElement(SecaoFotosServico, { fotos: [] }))).toBe("");
  });

  const os = (): OsParaRelatorio => ({
    numero: "OS-501", status: "CONCLUIDA", descricao: "Preventiva", observacoes: null,
    criadoEm: new Date("2026-11-01T12:00:00Z"), dataInicio: null, dataConclusao: null, previsaoConclusao: null,
    empresa: { nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "11222333000181", email: null, telefone: null, logo: null } as any,
    cliente: { nome: "Hospital Santa Luzia", nomeFantasia: null, cpfCnpj: "12345678000199" } as any,
    unidade: { nome: "Matriz", logradouro: null, numero: null, bairro: null, cidade: null, estado: null, cep: null },
    contrato: null, equipamento: null, atividades: ativs,
  });

  it("no documento: a seção 'Fotos do serviço (3)' aparece na versão do cliente, e a foto do equipamento dentro do bloco dele", () => {
    const dados = montarRelatorioOs(os(), null);
    expect(dados.fotosServico).toHaveLength(3);
    const html = renderToStaticMarkup(createElement(RelatorioOsDocumento, { dados, config: CONFIG_RELATORIO_PADRAO, versao: "cliente" }));
    const secao = html.slice(html.indexOf('data-secao="fotosServico"'));
    expect(secao).toContain("Fotos do serviço (3)");
    expect(secao).toContain("Quadro elétrico");
    expect(secao).toContain("Sem acesso — Split do auditório");
    const bloco = html.slice(html.indexOf('data-secao="equipamentos"'), html.indexOf('data-secao="fotosServico"'));
    expect(bloco).toContain("Dreno desobstruído");
    expect(bloco).toContain(IMG("dreno"));
    expect(html).not.toContain(IMG("cancelada"));
  });

  it("com a seção 'Fotos' desligada na configuração do relatório, nenhuma foto do serviço sai", () => {
    const dados = montarRelatorioOs(os(), null);
    const config = { ...CONFIG_RELATORIO_PADRAO, fotos: { ativo: false, cliente: false } };
    const html = renderToStaticMarkup(createElement(RelatorioOsDocumento, { dados, config, versao: "interna" }));
    expect(html).not.toContain('data-secao="fotosServico"');
    expect(html).not.toContain(IMG("quadro"));
    expect(html).not.toContain(IMG("dreno"));
  });

  it("relatório da ATIVIDADE também mostra as fotos do serviço dela", () => {
    const { blocos, fotosServico } = blocosAtendidos([ativs[0]], "Matriz");
    const html = renderToStaticMarkup(createElement(AtividadeDocumento, {
      empresa: os().empresa, os: { numero: "OS-501", criadoEm: new Date("2026-11-01T12:00:00Z"), cliente: os().cliente }, numero: "REL-9",
      atividade: { ...ativs[0], tecnico: null, tipoOs: null } as any, equipamentos: blocos, fotosServico,
    }));
    expect(html).toContain("Fotos do serviço (3)");
    expect(html).toContain(IMG("quadro"));
    expect(html).toContain(IMG("dreno")); // no bloco do equipamento
  });
});

describe("cabeçalho da OS: 'Equipamentos atendidos' conta equipamento DISTINTO", () => {
  const base = (extra: Partial<OsCentralEntrada>): OsCentralEntrada => ({
    status: "EM_ANDAMENTO", statusManual: false, previsaoConclusao: null, atividades: [], medicoes: [], itensOrcamento: [], orcamentos: [], ...extra,
  });
  const at = (id: string, status: string, equipamentos: { feito: boolean; equipamentoId?: string }[]) =>
    ({ id, titulo: id, status, dataAgendada: null, prazo: null, equipamentos });

  it("o mesmo equipamento atendido em duas atividades conta UMA vez (antes contava 2)", () => {
    const c = centralDaOs(base({ atividades: [
      at("a1", "CONCLUIDA", [{ feito: true, equipamentoId: "eqA" }, { feito: true, equipamentoId: "eqB" }]),
      at("a2", "EM_ANDAMENTO", [{ feito: true, equipamentoId: "eqA" }, { feito: false, equipamentoId: "eqC" }]),
    ] }));
    expect(c.equipamentosAtendidos).toBe(2);
  });

  it("atividade cancelada não atendeu ninguém; vinculado sem atender não conta", () => {
    const c = centralDaOs(base({ atividades: [
      at("a1", "CANCELADA", [{ feito: true, equipamentoId: "eqA" }]),
      at("a2", "AGENDADA", [{ feito: false, equipamentoId: "eqB" }]),
    ] }));
    expect(c.equipamentosAtendidos).toBe(0);
  });

  it("OS antiga concluída sem equipamento vinculado: o principal era o atendido (igual ao card e ao relatório)", () => {
    expect(centralDaOs(base({ status: "CONCLUIDA", equipamentoId: "eqP", atividades: [at("a1", "CONCLUIDA", [])] })).equipamentosAtendidos).toBe(1);
    expect(centralDaOs(base({ status: "EM_ANDAMENTO", equipamentoId: "eqP", atividades: [at("a1", "EM_ANDAMENTO", [])] })).equipamentosAtendidos).toBe(0);
  });

  it("cabeçalho, card e relatório dão o MESMO número para a mesma OS", () => {
    const atividades = [
      { status: "CONCLUIDA", equipamentos: [{ feito: true, equipamento: A }, { feito: true, equipamento: B }] },
      { status: "CONCLUIDA", equipamentos: [{ feito: true, equipamento: A }] },
      { status: "CANCELADA", equipamentos: [{ feito: true, equipamento: equip("eqC", "Cancelado") }] },
    ];
    const card = contarEquipamentosAtendidos(atividades);
    const cabecalho = centralDaOs(base({ atividades: atividades.map((a, i) => at(`a${i}`, a.status, a.equipamentos.map((v) => ({ feito: v.feito, equipamentoId: v.equipamento.id })))) })).equipamentosAtendidos;
    const relatorio = blocosAtendidos(atividades.map((a, i) => ativ(`a${i}`, a.status, { equipamentos: a.equipamentos })), null).blocos.length;
    expect([cabecalho, card, relatorio]).toEqual([2, 2, 2]);
  });
});
