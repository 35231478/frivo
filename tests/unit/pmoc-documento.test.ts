/**
 * PMOC — Etapa 3: o DOCUMENTO do plano.
 *  - o que o documento DIZ (lib/pmoc-documento, puro): identificação, RT e ART, texto técnico (do plano,
 *    da empresa ou do sistema), equipamentos cobertos e — o mais importante — o CRONOGRAMA mês a mês já
 *    com a substituição (o serviço que realmente vale) e as datas ajustadas pelo fim de semana;
 *  - como ele é DESENHADO (lib/pmoc-documento-pdf): um PDF de verdade, pequeno, paginado, com a ART
 *    anexada (PDF ou imagem) e com saída segura quando o arquivo não cabe ou não pode ser lido.
 * O texto do PDF é lido de volta (as instruções de desenho são descomprimidas) para conferir o que saiu.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PNG, paginasDe, pdfDeTeste, textoDoPdf } from "./pmoc-pdf-util";
import { DESCRICAO_PADRAO_PMOC } from "@/lib/pmoc";
import type { EstadoCronograma, ItemCronograma } from "@/lib/pmoc-cronograma";
import {
  capacidadeDoc, codigosDosServicos, enderecoDoc, localDoc, mesesDoPlano, montarDocumento, nomeArquivoDocumento, paragrafos, rotuloMes, textoTecnico,
  type DadosDocumento, type EquipamentoDoDocumento, type ModeloDocumento,
} from "@/lib/pmoc-documento";
import { MESES_POR_TABELA, TAMANHO_MAX_DOCUMENTO, gerarPdfDocumento } from "@/lib/pmoc-documento-pdf";

const AGORA = new Date("2026-11-12T15:00:00.000Z"); // 12/11/2026, 12:00 em Brasília

/* ───────── exemplos ───────── */
const equip = (id: string, extra: Partial<EquipamentoDoDocumento> = {}): EquipamentoDoDocumento => ({
  id, ativo: true, patrimonio: `AC-00${id.slice(1)}`, nome: `Split ${id}`, marca: "LG", modelo: "S4", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "teSplit",
  tipoNome: "Split", capacidade: "48000", setor: "Térreo", localizacao: "Recepção", unidadeId: "u1", unidadeNome: "Matriz", ...extra,
});
const item = (id: string, extra: Partial<ItemCronograma> = {}): ItemCronograma => ({
  id, ativo: true, tipoEquipamentoId: null, equipamentoId: null, tipoOsId: "toLeve", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25,
  fimSemana: "MANTER", criadoEm: "2026-11-01T12:00:00.000Z", ...extra,
});
/** A leve mensal em todos + a química semestral a partir de abril/2027 */
const LEVE = item("iLeve");
const QUIMICA = item("iQuimica", { tipoOsId: "toQuimica", intervaloMeses: 6, dataInicio: "2027-04-01", criadoEm: "2026-11-02T12:00:00.000Z" });
const NOMES = [
  { id: "iLeve", tipoOsNome: "Manutenção Preventiva", tipoEquipamentoNome: null, equipamentoRotulo: null },
  { id: "iQuimica", tipoOsNome: "Limpeza Química", tipoEquipamentoNome: null, equipamentoRotulo: null },
];
function dados(extra: Partial<Omit<DadosDocumento, "pmoc" | "estado">> & { pmoc?: Partial<DadosDocumento["pmoc"]>; itens0?: ItemCronograma[]; equipamentos?: EquipamentoDoDocumento[] } = {}): DadosDocumento {
  const equipamentos = extra.equipamentos ?? [equip("q1"), equip("q2", { patrimonio: "AC-002", nome: "Split UTI 1", capacidade: "36000 BTU/h", setor: "2º andar", localizacao: "UTI 1" })];
  const pmoc = { nome: "PMOC 2027 — Hospital Santa Clara", descricao: null, status: "PUBLICADO", ativo: true, dataInicio: "2026-11-12", dataExpiracao: "2027-11-11", rtNome: "Eng. Roberto Mendes", rtCrea: "5012345-D/SP", artNumero: "28027230241234567", artArquivoNome: null, ...extra.pmoc };
  const estado: EstadoCronograma = {
    pmoc: { status: pmoc.status, ativo: pmoc.ativo, dataInicio: pmoc.dataInicio, dataExpiracao: pmoc.dataExpiracao },
    itens: extra.itens0 ?? [LEVE, QUIMICA],
    equipamentos: equipamentos.map((e) => ({ id: e.id, ativo: e.ativo, unidadeId: e.unidadeId, tipoEquipamentoId: e.tipoEquipamentoId, tipo: e.tipo })),
    tipos: [{ id: "teSplit", chaveEnum: "AR_CONDICIONADO_SPLIT" }, { id: "teChiller", chaveEnum: "CHILLER" }],
    execucoes: [],
  };
  return {
    empresa: { nome: "Clima Total", cnpj: "12345678000190", telefone: "(11) 4000-1000", email: "contato@climatotal.com.br", site: "climatotal.com.br", endereco: "Av. Paulista, 1000", cidade: "São Paulo", estado: "SP", logo: null },
    cliente: { nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "11222333000181" },
    unidade: { nome: "Matriz", logradouro: "Rua das Flores", numero: "250", complemento: "Bloco B", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01000-000" },
    itens: NOMES,
    atividades: [{
      tipoEquipamentoId: "teSplit", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT",
      checklist: ["Limpar os filtros de ar", "Verificar o dreno e a bandeja de condensado", "Medir a corrente do compressor"],
      formularios: [{ tipoOsId: "toQuimica", nome: "Laudo de limpeza química", campos: ["Produto utilizado", "Diluição"] }, { tipoOsId: "toFora", nome: "Formulário de outro serviço", campos: ["x"] }],
    }],
    textoPadrao: null, geradoEm: AGORA,
    ...extra, pmoc, estado, equipamentos,
  } as DadosDocumento;
}
const linha = (m: ModeloDocumento, tag: string) => m.cronograma.find((l) => l.tag === tag)!;
const codigos = (m: ModeloDocumento, tag: string) => linha(m, tag).celulas.map((c) => c?.codigo ?? "—");
const campo = (m: ModeloDocumento, rotulo: string) => m.identificacao.flatMap((g) => g.campos).find((c) => c.rotulo === rotulo)?.valor;

/* ───────── o que o documento diz ───────── */
describe("documento do PMOC: identificação, RT, ART e texto", () => {
  it("capa e identificação: plano, cliente, unidade com endereço, vigência, situação, RT com CREA e número da ART", () => {
    const m = montarDocumento(dados());
    expect(m).toMatchObject({ nome: "PMOC 2027 — Hospital Santa Clara", status: "VIGENTE", statusRotulo: "Vigente", vigencia: "12/11/2026 a 11/11/2027", geradoEm: "12/11/2026" });
    expect(campo(m, "Cliente")).toBe("Hospital Santa Clara (Hospital Santa Clara Ltda)");
    expect(campo(m, "CNPJ/CPF")).toBe("11.222.333/0001-81");
    expect(campo(m, "Unidade")).toBe("Matriz");
    expect(campo(m, "Endereço")).toBe("Rua das Flores, 250 — Bloco B — Centro — São Paulo/SP — 01000-000");
    expect(campo(m, "Vigência")).toBe("12/11/2026 a 11/11/2027");
    expect(campo(m, "Situação")).toBe("Vigente — expira em 11/11/2027");
    expect(campo(m, "Equipamentos cobertos")).toBe("2");
    expect(campo(m, "Responsável Técnico")).toBe("Eng. Roberto Mendes");
    expect(campo(m, "Registro CREA")).toBe("5012345-D/SP");
    expect(campo(m, "ART nº")).toBe("28027230241234567");
    expect(m.rt).toEqual({ nome: "Eng. Roberto Mendes", crea: "5012345-D/SP" });
    expect(m.nomeArquivo).toBe("PMOC 2027 — Hospital Santa Clara.pdf");
  });

  it("a situação é CALCULADA pelas datas no dia em que o documento é emitido: vigente, expirado, rascunho, inativo", () => {
    expect(montarDocumento(dados({ geradoEm: new Date("2027-11-11T15:00:00Z") }))).toMatchObject({ status: "VIGENTE" }); // o dia da expiração ainda vale
    const expirado = montarDocumento(dados({ geradoEm: new Date("2027-11-12T15:00:00Z") }));
    expect(expirado).toMatchObject({ status: "EXPIRADO", statusRotulo: "Expirado" });
    expect(campo(expirado, "Situação")).toBe("Expirado em 11/11/2027");
    expect(montarDocumento(dados({ pmoc: { status: "RASCUNHO" } }))).toMatchObject({ status: "RASCUNHO", statusRotulo: "Rascunho" });
    expect(montarDocumento(dados({ pmoc: { ativo: false } }))).toMatchObject({ status: "INATIVO", statusRotulo: "Inativo" });
  });

  it("multiempresa: a empresa que aparece é a do plano — nome, CNPJ, endereço e contato vêm do cadastro dela", () => {
    const m = montarDocumento(dados());
    expect(m.empresa).toEqual({ nome: "Clima Total", linhas: ["CNPJ 12.345.678/0001-90", "Av. Paulista, 1000 — São Paulo/SP", "(11) 4000-1000 · contato@climatotal.com.br · climatotal.com.br"], logo: null });
    expect(campo(m, "Empresa responsável")).toBe("Clima Total");
    const outra = montarDocumento(dados({ empresa: { nome: "Ar Puro Climatização", cnpj: null, logo: null } }));
    expect(outra.empresa).toEqual({ nome: "Ar Puro Climatização", linhas: [], logo: null });
    expect(JSON.stringify(outra)).not.toMatch(/Clima Total|Termofrio/i);
  });

  it("texto técnico: o do plano; sem ele, o padrão da EMPRESA; sem ele, o do sistema (com a base normativa)", () => {
    expect(textoTecnico("  Texto do plano.  ", "Texto da empresa")).toBe("Texto do plano.");
    expect(textoTecnico("", "Texto da empresa")).toBe("Texto da empresa");
    expect(textoTecnico(null, "   ")).toBe(DESCRICAO_PADRAO_PMOC);
    expect(montarDocumento(dados({ pmoc: { descricao: "Plano do Hospital.\n\nSegunda parte." } })).texto).toEqual(["Plano do Hospital.", "Segunda parte."]);
    expect(montarDocumento(dados({ textoPadrao: "Texto padrão da Clima Total." })).texto).toEqual(["Texto padrão da Clima Total."]);
    const sistema = montarDocumento(dados()).texto.join("\n");
    for (const norma of ["Lei Federal nº 13.589/2018", "Portaria nº 3.523/GM/MS", "RE nº 09/2003", "NBR 13971", "NBR 16401"]) expect(sistema, norma).toContain(norma);
    expect(sistema).not.toMatch(/Termofrio/i);
    expect(paragrafos("a\r\nb\n\n\n  c  \n")).toEqual(["a\nb", "c"]);
  });

  it("sem RT, CREA ou ART (rascunho em montagem): o documento sai e diz que não foi informado", () => {
    const m = montarDocumento(dados({ pmoc: { status: "RASCUNHO", rtNome: null, rtCrea: " ", artNumero: null } }));
    expect([campo(m, "Responsável Técnico"), campo(m, "Registro CREA"), campo(m, "ART nº")]).toEqual(["Não informado", "Não informado", "Não informada"]);
  });
});

describe("documento do PMOC: equipamentos cobertos", () => {
  it("TAG, descrição, tipo, capacidade e local vêm do cadastro; só os ATIVOS entram, em ordem de local e TAG", () => {
    const m = montarDocumento(dados({ equipamentos: [
      equip("q2", { patrimonio: "AC-010", nome: "Split UTI" }),
      equip("q1", { patrimonio: "AC-002", nome: null, marca: "Daikin", modelo: "FTXS35", capacidade: "120 TR", tipoNome: null, tipoEquipamentoId: null, tipo: "CHILLER" }),
      equip("q3", { patrimonio: null, nome: "Split do anexo", unidadeId: "u2", unidadeNome: "Anexo", setor: null, localizacao: null, capacidade: null }),
      equip("q4", { ativo: false, patrimonio: "AC-099" }),
    ] }));
    expect(m.equipamentos).toEqual([
      { tag: "—", descricao: "Split do anexo", tipo: "Split", capacidade: "—", local: "Anexo" },
      { tag: "AC-002", descricao: "Daikin FTXS35", tipo: "Chiller", capacidade: "120 TR", local: "Matriz · Térreo · Recepção" },
      { tag: "AC-010", descricao: "Split UTI", tipo: "Split", capacidade: "48.000 BTU/h", local: "Matriz · Térreo · Recepção" },
    ]);
    expect(m.inativos).toBe(1);
    expect(campo(m, "Equipamentos cobertos")).toBe("3");
    expect(m.cronograma.map((l) => l.tag)).toEqual(["—", "AC-002", "AC-010"]); // o inativo não tem linha no cronograma
  });

  it("capacidade com a mesma escrita para todos: BTU com separador de milhar; o que já tem outra unidade fica como foi digitado", () => {
    expect(["48000", "36000 BTU/h", "9000btu", "12000 BTUs/h", "120 TR", "5 TR", "", null, "200000 kcal/h"].map(capacidadeDoc))
      .toEqual(["48.000 BTU/h", "36.000 BTU/h", "9.000 BTU/h", "12.000 BTU/h", "120 TR", "5 TR", "—", "—", "200000 kcal/h"]);
    expect(localDoc({ unidadeNome: null, setor: " ", localizacao: null })).toBe("—");
    expect(enderecoDoc({ nome: "Matriz", cidade: "São Paulo", estado: "SP" })).toBe("São Paulo/SP");
    expect(enderecoDoc({ nome: "Matriz" })).toBe("");
  });
});

describe("documento do PMOC: o cronograma reflete a substituição e o fim de semana", () => {
  it("mensal + química semestral: mês a mês aparece UM serviço — a leve nos meses 1 a 5, a química no 6º (e no 12º)", () => {
    const m = montarDocumento(dados());
    expect(m.servicos).toEqual([{ tipoOsId: "toLeve", codigo: "MP", nome: "Manutenção Preventiva" }, { tipoOsId: "toQuimica", codigo: "LQ", nome: "Limpeza Química" }]);
    expect(m.meses).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    const esperado = ["MP", "MP", "MP", "MP", "MP", "LQ", "MP", "MP", "MP", "MP", "MP", "LQ"];
    expect(codigos(m, "AC-001")).toEqual(esperado);
    expect(codigos(m, "AC-002")).toEqual(esperado);
    // Nenhuma OS "fantasma": 12 execuções por equipamento (e não 14), uma por mês
    expect(m.totalExecucoes).toBe(24);
    expect(linha(m, "AC-001").celulas.every((c) => c !== null)).toBe(true);
    expect(m.observacoes[0]).toBe("Quando dois serviços coincidem no mesmo equipamento e no mesmo mês, é executado o de maior intervalo, que inclui a rotina do serviço mais frequente.");
  });

  it("é o MESMO resultado das regras que geram as OS: a química só num equipamento tira a leve só dele", () => {
    const m = montarDocumento(dados({ itens0: [LEVE, { ...QUIMICA, equipamentoId: "q2" }], itens: [NOMES[0], { ...NOMES[1], equipamentoRotulo: "AC-002 · Split UTI 1" }] }));
    expect(codigos(m, "AC-001")[5]).toBe("MP");
    expect(codigos(m, "AC-002")[5]).toBe("LQ");
    expect(m.totalExecucoes).toBe(24);
    expect(m.itens.map((i) => [i.codigo, i.servico, i.aplicaSe, i.equipamentos, i.frequencia, i.dia, i.inicio])).toEqual([
      ["MP", "Manutenção Preventiva", "Todos os equipamentos", 2, "Mensal", 25, "12/11/2026"],
      ["LQ", "Limpeza Química", "AC-002 · Split UTI 1", 1, "Semestral", 25, "01/04/2027"],
    ]);
  });

  it("desempate (mesmo intervalo): aparece o item criado primeiro, como na geração das OS", () => {
    const a = item("iA", { intervaloMeses: 6, tipoOsId: "toVistoria", criadoEm: "2026-11-01T12:00:00.000Z" });
    const b = item("iB", { intervaloMeses: 6, tipoOsId: "toHig", diaExecucao: 20, criadoEm: "2026-11-05T12:00:00.000Z" });
    const nomes = [{ id: "iA", tipoOsNome: "Vistoria", tipoEquipamentoNome: null, equipamentoRotulo: null }, { id: "iB", tipoOsNome: "Higienização", tipoEquipamentoNome: null, equipamentoRotulo: null }];
    for (const itens0 of [[a, b], [b, a]]) {
      const m = montarDocumento(dados({ itens0, itens: nomes, equipamentos: [equip("q1")] }));
      expect(m.cronograma[0].celulas.filter(Boolean).map((c) => [c!.codigo, c!.data])).toEqual([["VI", "25/11"], ["VI", "25/05"]]);
    }
  });

  it("datas JÁ AJUSTADAS pelo fim de semana: postergar leva o sábado e o domingo para a segunda; a competência não muda", () => {
    // Dia 14: 14/11/2026 é sábado, 14/12 é segunda, 14/02/2027 é domingo
    const semana = (fimSemana: ItemCronograma["fimSemana"]) => montarDocumento(dados({ itens0: [item("iLeve", { diaExecucao: 14, fimSemana })], equipamentos: [equip("q1")], pmoc: { dataExpiracao: "2027-02-28" } }))
      .cronograma[0].celulas.map((c) => c?.data);
    expect(semana("MANTER")).toEqual(["14/11", "14/12", "14/01", "14/02"]);
    expect(semana("POSTERGAR")).toEqual(["16/11", "14/12", "14/01", "15/02"]);
    expect(semana("ADIANTAR")).toEqual(["13/11", "14/12", "14/01", "12/02"]);
    // 28/02/2027 é domingo: postergado vai para 01/03, mas continua na coluna de fevereiro
    const fev = montarDocumento(dados({ itens0: [item("iLeve", { dataInicio: "2027-02-01", diaExecucao: 28, fimSemana: "POSTERGAR" })], equipamentos: [equip("q1")], pmoc: { dataInicio: "2027-02-01", dataExpiracao: "2027-03-20" } }));
    expect(fev.meses).toEqual(["2027-02"]);
    expect(fev.cronograma[0].celulas).toEqual([{ codigo: "MP", data: "01/03", iso: "2027-03-01" }]);
    expect(fev.observacoes).toContain("As datas que cairiam em sábado ou domingo já estão ajustadas para o dia útil definido em cada serviço. Feriados não são considerados.");
    expect(montarDocumento(dados({ itens0: [LEVE] })).observacoes.some((o) => /sábado ou domingo/.test(o))).toBe(false); // tudo em "manter": sem a observação
  });

  it("é o PLANO, não a agenda: o documento é o mesmo antes e depois de as OS existirem, no início ou no fim da vigência", () => {
    const base = montarDocumento(dados());
    const noFim = montarDocumento(dados({ geradoEm: new Date("2027-10-30T15:00:00Z") }));
    expect(noFim.cronograma).toEqual(base.cronograma); // meses que já passaram continuam no documento
    const d = dados();
    d.estado.execucoes = [{ id: "x1", cronogramaId: "iLeve", equipamentoId: "q1", periodo: "2027-04", dataPrevista: "2027-04-25T15:00:00.000Z", os: null }];
    expect(montarDocumento(d).cronograma).toEqual(base.cronograma); // uma execução antiga da leve em abril não "ressuscita" no documento
  });

  it("as colunas vão do primeiro ao último mês COM execução; antes do início do plano e item excluído não entram", () => {
    // trimestral a partir de janeiro: novembro e dezembro (sem nada) não viram coluna, nem o fim vazio da vigência
    const tri = montarDocumento(dados({ itens0: [item("iLeve", { intervaloMeses: 3, dataInicio: "2027-01-01" })], equipamentos: [equip("q1")] }));
    expect(tri.meses).toEqual(["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(codigos(tri, "AC-001")).toEqual(["MP", "—", "—", "MP", "—", "—", "MP", "—", "—", "MP"]);
    // item que começou antes do plano: só conta da data de início do plano em diante
    const antigo = montarDocumento(dados({ itens0: [item("iLeve", { dataInicio: "2026-06-01" })], equipamentos: [equip("q1")] }));
    expect(antigo.meses[0]).toBe("2026-11");
    expect(antigo.totalExecucoes).toBe(12);
    // no MÊS do início, o dia de execução que cai antes do início do plano (dia 5, plano começa dia 12) fica de fora
    const dia5 = montarDocumento(dados({ itens0: [item("iLeve", { dataInicio: "2026-06-01", diaExecucao: 5 })], equipamentos: [equip("q1")] }));
    expect(dia5.meses[0]).toBe("2026-12");
    expect(linha(dia5, "AC-001").celulas[0]).toMatchObject({ codigo: "MP", data: "05/12", iso: "2026-12-05" });
    expect(dia5.totalExecucoes).toBe(12); // dezembro/2026 a novembro/2027 (05/11/2027 ainda está na vigência)
    // item excluído (inativo) e plano sem itens
    const semItem = montarDocumento(dados({ itens0: [{ ...LEVE, ativo: false }] }));
    expect(semItem).toMatchObject({ itens: [], servicos: [], meses: [], totalExecucoes: 0, observacoes: [] });
    expect(mesesDoPlano("2026-11-12", "2027-01-05")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect([rotuloMes("2026-11"), rotuloMes("2027-01")]).toEqual(["nov/26", "jan/27"]);
  });

  it("códigos dos serviços: iniciais do tipo de OS, sem acento, sem repetir", () => {
    expect(codigosDosServicos([
      { tipoOsId: "a", nome: "Manutenção Preventiva" }, { tipoOsId: "b", nome: "Limpeza Química" }, { tipoOsId: "c", nome: "Higienização" },
      { tipoOsId: "d", nome: "Manutenção Preditiva" }, { tipoOsId: "e", nome: "Troca de filtros G4" }, { tipoOsId: "f", nome: "" },
    ]).map((s) => s.codigo)).toEqual(["MP", "LQ", "HI", "MP2", "TF", "SV"]);
  });
});

describe("documento do PMOC: planejamento das atividades", () => {
  it("por tipo de equipamento coberto: o checklist do tipo e os formulários dos serviços DESTE plano", () => {
    const m = montarDocumento(dados());
    expect(m.planejamento).toEqual([{
      tipo: "Split", equipamentos: 2,
      atividades: ["Limpar os filtros de ar", "Verificar o dreno e a bandeja de condensado", "Medir a corrente do compressor"],
      formularios: [{ servico: "Limpeza Química", nome: "Laudo de limpeza química", campos: ["Produto utilizado", "Diluição"] }], // o de outro serviço não entra
    }]);
  });

  it("cadastro antigo (só o tipo do enum) entra pelo tipo equivalente; tipo sem checklist aparece mesmo assim", () => {
    const m = montarDocumento(dados({ equipamentos: [
      equip("q1"), equip("q2", { tipoEquipamentoId: null, tipoNome: null }), // antigo: Split pelo enum
      equip("q3", { tipoEquipamentoId: "teChiller", tipoNome: "Chiller", tipo: "CHILLER" }),
      equip("q4", { tipoEquipamentoId: null, tipoNome: null, tipo: "VRF" }),
    ] }));
    expect(m.planejamento.map((p) => [p.tipo, p.equipamentos, p.atividades.length])).toEqual([["Chiller", 1, 0], ["Split", 2, 3], ["VRF/VRV", 1, 0]]);
  });
});

/* ───────── como ele é desenhado ───────── */
describe("documento do PMOC: o PDF", () => {
  it("é um PDF de verdade, leve (sem fonte nem imagem embutida), com capa em retrato e cronograma em paisagem", async () => {
    const pdf = await gerarPdfDocumento(montarDocumento(dados()));
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf).toMatchObject({ art: null, artFora: null, nomeArquivo: "PMOC 2027 — Hospital Santa Clara.pdf" });
    expect(pdf.bytes.length).toBeLessThan(60_000);
    const paginas = await paginasDe(pdf.bytes);
    expect(paginas).toHaveLength(pdf.paginas);
    expect(paginas[0]).toEqual([595, 842]);              // capa: A4 em pé
    expect(paginas).toContainEqual([842, 595]);          // cronograma: A4 deitado
    const info = await PDFDocument.load(pdf.bytes);
    expect([info.getTitle(), info.getAuthor(), info.getCreator()]).toEqual(["PMOC 2027 — Hospital Santa Clara", "Clima Total", "Frivo"]);
  });

  it("traz tudo o que o documento diz: identificação, RT/CREA, ART, base normativa, equipamentos, cronograma e planejamento", async () => {
    const texto = await textoDoPdf((await gerarPdfDocumento(montarDocumento(dados()))).bytes);
    for (const trecho of [
      "Plano de Manutenção, Operação e Controle", "PMOC 2027 — Hospital Santa Clara", "Vigente · 12/11/2026 a 11/11/2027",
      "Hospital Santa Clara (Hospital Santa Clara Ltda)", "11.222.333/0001-81", "Eng. Roberto Mendes", "5012345-D/SP", "28027230241234567",
      "1. Apresentação e base normativa", "2. Equipamentos cobertos", "3. Cronograma de manutenção", "4. Planejamento das atividades",
      "AC-001", "48.000 BTU/h", "36.000 BTU/h", "Matriz · Térreo · Recepção", "Limpeza Química", "Manter na data original",
      "NOV/26", "OUT/27", "25/04", "Limpar os filtros de ar", "Laudo de limpeza química", "Responsável pelo estabelecimento", "CREA 5012345-D/SP",
      "Clima Total · Documento eletrônico — Frivo", "Emitido em 12/11/2026", "Página 1 de",
    ]) expect(texto, trecho).toContain(trecho);
    expect(texto).toMatch(/13\.589\/2018[\s\S]*3\.523\/GM\/MS[\s\S]*RE nº 09\/2003[\s\S]*NBR 13971[\s\S]*NBR 16401/);
    // No cronograma desenhado: 20 células da leve e 4 da química (2 equipamentos) — e nenhuma a mais
    const celulas = (codigo: string) => texto.split("\n").filter((l) => l === codigo).length;
    expect(celulas("LQ")).toBe(4 + 2); // 4 células + a linha do serviço na tabela + a legenda
    expect(celulas("MP")).toBe(20 + 2);
  });

  it("ART em PDF: as páginas dela entram no fim do documento, como são; ART em imagem: vira uma página do documento", async () => {
    const m = montarDocumento(dados({ pmoc: { artArquivoNome: "ART.pdf" } }));
    const sem = await gerarPdfDocumento(m);
    const comPdf = await gerarPdfDocumento(m, { nome: "ART.pdf", bytes: await pdfDeTeste(2) });
    expect(comPdf).toMatchObject({ art: "PDF", artFora: null, paginas: sem.paginas + 2 });
    const paginas = await paginasDe(comPdf.bytes);
    expect(paginas.slice(-2)).toEqual([[300, 400], [300, 400]]); // as duas páginas da ART, no tamanho original
    expect(await textoDoPdf(comPdf.bytes)).toContain(`Página 1 de ${sem.paginas}`); // a numeração é a do documento

    const comImagem = await gerarPdfDocumento(m, { nome: "art.png", bytes: PNG });
    expect(comImagem).toMatchObject({ art: "IMAGEM", artFora: null, paginas: sem.paginas + 1 });
    expect(await textoDoPdf(comImagem.bytes)).toContain("Anexo — ART nº 28027230241234567");
  });

  it("ART que não cabe ou não pode ser lida: o documento sai mesmo assim e diz que o arquivo segue separado", async () => {
    const m = montarDocumento(dados());
    const sem = await gerarPdfDocumento(m);
    const art = await pdfDeTeste(3);
    const grande = await gerarPdfDocumento(m, { nome: "ART.pdf", bytes: art }, sem.bytes.length + 100); // limite menor que documento + ART
    expect(grande).toMatchObject({ art: null, artFora: "GRANDE", paginas: sem.paginas + 1 });
    expect(grande.bytes.length).toBeLessThanOrEqual(sem.bytes.length + 2000);
    expect(await textoDoPdf(grande.bytes)).toContain("é grande demais para ser incluído neste documento");

    const quebrado = new Uint8Array(Buffer.from("%PDF-1.4 isto não é um PDF de verdade"));
    const ilegivel = await gerarPdfDocumento(m, { nome: "ART.pdf", bytes: quebrado });
    expect(ilegivel).toMatchObject({ art: null, artFora: "ILEGIVEL" });
    expect(await textoDoPdf(ilegivel.bytes)).toContain("não pôde ser incluído neste documento");
    const html = await gerarPdfDocumento(m, { nome: "ART.pdf", bytes: new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>")) });
    expect(html).toMatchObject({ art: null, artFora: "ILEGIVEL" });
    expect(TAMANHO_MAX_DOCUMENTO).toBeLessThan(4.5 * 1024 * 1024); // abaixo do limite de resposta da hospedagem
  });

  it("logo da empresa: PNG pequena entra; logo grande demais, de outro formato ou quebrada fica de fora sem derrubar o documento", async () => {
    const url = (bytes: Uint8Array, tipo = "image/png") => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
    const comLogo = (logo: string | null) => gerarPdfDocumento(montarDocumento(dados({ empresa: { nome: "Clima Total", logo } })));
    const semLogo = (await comLogo(null)).bytes.length;
    expect((await comLogo(url(PNG))).bytes.length).toBeGreaterThan(semLogo); // a imagem foi embutida
    const grande = new Uint8Array(700_000); grande.set(PNG);
    for (const logo of [url(grande), url(new Uint8Array(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp"), "data:image/png;base64,AAAA", "https://exemplo.com/logo.png"]) {
      const pdf = await comLogo(logo);
      expect(Math.abs(pdf.bytes.length - semLogo), logo.slice(0, 30)).toBeLessThan(200);
    }
  });

  it("texto fora do alfabeto do PDF (seta, emoji, travessão, aspas) não derruba o documento", async () => {
    const m = montarDocumento(dados({
      pmoc: { nome: "PMOC → Hospital “Santa Clara” ✓ 😀", descricao: "Temperatura ≤ 24 °C → conforto.\tLinha com tabulação.\n\nSeção 2 — itens: • um • dois…" },
      equipamentos: [equip("q1", { nome: "Split “recepção” 12.000 BTU → térreo ✓", localizacao: "Sala 𝟙" })],
    }));
    const pdf = await gerarPdfDocumento(m);
    const texto = await textoDoPdf(pdf.bytes);
    expect(texto).toContain("PMOC -> Hospital “Santa Clara”");
    expect(texto).toContain("Temperatura <= 24 °C -> conforto. Linha com tabulação.");
    expect(texto).toContain("• um • dois…");
    expect(m.nomeArquivo).toBe("PMOC → Hospital “Santa Clara” ✓ 😀.pdf");
    expect(nomeArquivoDocumento('Hospital: ala "B" / 2027?')).toBe("PMOC Hospital ala B 2027.pdf");
  });

  it("plano grande: 60 equipamentos e 24 meses — as tabelas quebram de folha repetindo o cabeçalho, em duas tabelas de 12 meses", async () => {
    const equipamentos = Array.from({ length: 60 }, (_, i) => equip(`q${i + 1}`, { patrimonio: `AC-${String(i + 1).padStart(3, "0")}`, nome: `Split da sala ${i + 1}` }));
    const m = montarDocumento(dados({ equipamentos, pmoc: { dataExpiracao: "2028-11-11" } }));
    expect(m.meses).toHaveLength(24);
    expect(m.totalExecucoes).toBe(60 * 24);
    const pdf = await gerarPdfDocumento(m);
    expect(pdf.paginas).toBeGreaterThan(8);
    expect(pdf.bytes.length).toBeLessThan(400_000);
    const texto = await textoDoPdf(pdf.bytes);
    expect(texto).toContain("AC-060");
    expect(texto).toContain("nov/26 a out/27");
    expect(texto).toContain("nov/27 a out/28");
    expect(MESES_POR_TABELA).toBe(12);
    // o cabeçalho "EQUIPAMENTO" se repete em cada folha do cronograma
    expect(texto.split("\n").filter((l) => l === "EQUIPAMENTO").length).toBeGreaterThan(4);
    expect(texto).toContain(`Página ${pdf.paginas} de ${pdf.paginas}`);
  });

  it("plano sem cronograma, sem equipamento ativo e sem execução na vigência: cada seção diz o que falta, sem página quebrada", async () => {
    const semItens = await textoDoPdf((await gerarPdfDocumento(montarDocumento(dados({ itens0: [] })))).bytes);
    expect(semItens).toContain("Este plano ainda não tem cronograma cadastrado.");
    const semEquip = await textoDoPdf((await gerarPdfDocumento(montarDocumento(dados({ equipamentos: [equip("q1", { ativo: false })] })))).bytes);
    expect(semEquip).toContain("Nenhum equipamento ativo neste plano.");
    expect(semEquip).toContain("1 equipamento do plano está inativo no cadastro e não entra no cronograma.");
    expect(semEquip).toContain("Nenhum equipamento ativo no plano.");
    const foraDaVigencia = await textoDoPdf((await gerarPdfDocumento(montarDocumento(dados({ itens0: [item("iLeve", { dataInicio: "2027-11-01", intervaloMeses: 12 })] })))).bytes);
    expect(foraDaVigencia).toContain("Nenhuma execução prevista dentro da vigência do plano com este cronograma.");
  });
});
