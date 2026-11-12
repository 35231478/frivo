/**
 * PMOC — OCORRÊNCIAS: as regras (lib/pmoc-ocorrencias, puro) e a seção do documento.
 *  - o que é uma ocorrência válida: data (não futura), descrição, gravidade, situação; a resolução
 *    só existe na resolvida, com data entre a ocorrência e hoje;
 *  - a lista da tela: busca (sem acento), filtro por situação e por gravidade, as excluídas à parte,
 *    a ordem e a contagem (o número da aba);
 *  - os textos do histórico e da situação;
 *  - o DOCUMENTO: a seção "Ocorrências" (data, equipamento, descrição, gravidade, situação), na
 *    ordem do livro, lida de volta do PDF.
 * O servidor (rotas e banco) está em pmoc-ocorrencias-pg; a tela, em pmoc-ocorrencias-ui.
 */
import { describe, expect, it } from "vitest";
import { paginasDe, textoDoPdf } from "./pmoc-pdf-util";
import {
  ACAO_EXCLUIDA, ACAO_RESTAURADA, FILTRO_VAZIO, GRAVIDADES, LABELS_GRAVIDADE, LABELS_SITUACAO, ROTULO_GERAL, SITUACOES, TAMANHO_MAX_ANEXO_OCORRENCIA, TIPOS_ANEXO_OCORRENCIA,
  acaoDaMudanca, contarOcorrencias, detalheDaOcorrencia, erroDaOcorrencia, filtrarOcorrencias, ocorrenciaSchema, ordenarOcorrencias, resolucaoGravada, resumoDasOcorrencias,
  rotuloDoEquipamento, situacaoSchema, textoDaSituacao, type OcorrenciaPmoc,
} from "@/lib/pmoc-ocorrencias";
import { montarDocumento, type DadosDocumento, type OcorrenciaDoDocumento } from "@/lib/pmoc-documento";
import { gerarPdfDocumento } from "@/lib/pmoc-documento-pdf";

const HOJE = "2026-11-12";
const erroDe = (schema: { safeParse: (v: unknown) => any }, corpo: unknown) => { const r = schema.safeParse(corpo); return r.success ? null : r.error.issues[0].message; };
const VALIDA = { data: "2026-11-10", descricao: "Vazamento de água na bandeja", gravidade: "ALTA" };

/* ───────── o que é uma ocorrência válida ───────── */
describe("ocorrência do PMOC: validação do que chega", () => {
  it("gravidades e situações: as quatro e as três, com os nomes que a tela mostra", () => {
    expect(GRAVIDADES.map((g) => LABELS_GRAVIDADE[g])).toEqual(["Baixa", "Média", "Alta", "Crítica"]);
    expect(SITUACOES.map((s) => LABELS_SITUACAO[s])).toEqual(["Aberta", "Em andamento", "Resolvida"]);
    expect(ROTULO_GERAL).toBe("Geral da unidade");
  });

  it("o mínimo: data, descrição e gravidade; nasce ABERTA, sem equipamento (geral), sem OS e sem resolução", () => {
    expect(ocorrenciaSchema.parse(VALIDA)).toEqual({ ...VALIDA, situacao: "ABERTA", equipamentoId: null, ordemServicoId: null, resolvidaEm: null, resolucao: null });
    // Vazio vira "sem": a tela manda "" quando nada foi escolhido
    expect(ocorrenciaSchema.parse({ ...VALIDA, equipamentoId: "", ordemServicoId: "  ", resolucao: " ", resolvidaEm: "" })).toMatchObject({ equipamentoId: null, ordemServicoId: null, resolucao: null, resolvidaEm: null });
    expect(ocorrenciaSchema.parse({ ...VALIDA, descricao: "  Ruído anormal  ", equipamentoId: " q1 " })).toMatchObject({ descricao: "Ruído anormal", equipamentoId: "q1" });
  });

  it("cada falta tem a sua mensagem: data, descrição, gravidade e situação", () => {
    expect(erroDe(ocorrenciaSchema, { ...VALIDA, data: undefined })).toBe("Informe a data da ocorrência.");
    for (const data of ["", "12/11/2026", "2026-02-30", "2026-13-01", 20261112, null]) expect(erroDe(ocorrenciaSchema, { ...VALIDA, data }), String(data)).toBe("Informe a data da ocorrência.");
    for (const descricao of [undefined, null, "", "  ", "ab", " a "]) expect(erroDe(ocorrenciaSchema, { ...VALIDA, descricao }), String(descricao)).toBe("Descreva o problema (mín. 3 caracteres).");
    expect(erroDe(ocorrenciaSchema, { ...VALIDA, descricao: "abc" })).toBeNull();
    expect(erroDe(ocorrenciaSchema, { ...VALIDA, descricao: "x".repeat(2000) })).toBeNull();
    expect(erroDe(ocorrenciaSchema, { ...VALIDA, descricao: "x".repeat(2001) })).toBe("A descrição vai até 2.000 caracteres.");
    for (const gravidade of [undefined, "", "URGENTE", "alta", null]) expect(erroDe(ocorrenciaSchema, { ...VALIDA, gravidade }), String(gravidade)).toBe("Escolha a gravidade.");
    for (const g of GRAVIDADES) expect(erroDe(ocorrenciaSchema, { ...VALIDA, gravidade: g })).toBeNull();
    expect(erroDe(ocorrenciaSchema, { ...VALIDA, situacao: "FECHADA" })).toBe("Situação inválida.");
    expect(erroDe(ocorrenciaSchema, { ...VALIDA, resolucao: "x".repeat(2001) })).toBe("A observação da resolução vai até 2.000 caracteres.");
  });

  it("mudança rápida de situação (Resolver, Reabrir): só a situação e a resolução", () => {
    expect(situacaoSchema.parse({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-12", resolucao: " Filtro trocado " })).toEqual({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-12", resolucao: "Filtro trocado" });
    expect(situacaoSchema.parse({ situacao: "ABERTA" })).toEqual({ situacao: "ABERTA", resolvidaEm: null, resolucao: null });
    expect(erroDe(situacaoSchema, {})).toBe("Situação inválida.");
    expect(erroDe(situacaoSchema, { situacao: "EXCLUIDA" })).toBe("Situação inválida.");
  });

  it("anexo: foto (JPG ou PNG) ou PDF, até 3 MB — cabe no pedido de 4,5 MB da hospedagem mesmo em base64", () => {
    expect([...TIPOS_ANEXO_OCORRENCIA]).toEqual(["image/jpeg", "image/png", "application/pdf"]);
    expect(TAMANHO_MAX_ANEXO_OCORRENCIA).toBe(3 * 1024 * 1024);
    expect(Math.ceil(TAMANHO_MAX_ANEXO_OCORRENCIA / 3) * 4).toBeLessThan(4.5 * 1024 * 1024 - 100_000);
  });
});

describe("ocorrência do PMOC: datas e resolução", () => {
  it("a data da ocorrência não pode ser futura (hoje pode)", () => {
    expect(erroDaOcorrencia({ data: HOJE, situacao: "ABERTA" }, HOJE)).toBeNull();
    expect(erroDaOcorrencia({ data: "2026-11-11", situacao: "EM_ANDAMENTO" }, HOJE)).toBeNull();
    expect(erroDaOcorrencia({ data: "2026-11-13", situacao: "ABERTA" }, HOJE)).toBe("A data da ocorrência não pode ser futura.");
    expect(erroDaOcorrencia({ data: "2026-11-13", situacao: "RESOLVIDA", resolvidaEm: "2026-11-13" }, HOJE)).toBe("A data da ocorrência não pode ser futura.");
  });

  it("resolvida: a data da resolução fica entre a ocorrência e hoje (as pontas valem); vazia = hoje", () => {
    const r = (resolvidaEm: string | null | undefined, data = "2026-11-10") => erroDaOcorrencia({ data, situacao: "RESOLVIDA", resolvidaEm }, HOJE);
    expect(r("2026-11-10")).toBeNull();   // no mesmo dia
    expect(r("2026-11-11")).toBeNull();
    expect(r(HOJE)).toBeNull();           // hoje
    expect(r(null)).toBeNull();           // vazia: vale hoje
    expect(r(undefined)).toBeNull();
    expect(r("2026-11-09")).toBe("A resolução não pode ser antes da data da ocorrência.");
    expect(r("2026-11-13")).toBe("A data da resolução não pode ser futura.");
    expect(r("12/11/2026")).toBe("Data da resolução inválida.");
    expect(r("2026-02-30")).toBe("Data da resolução inválida.");
    // Fora da resolvida, a data da resolução nem é olhada
    expect(erroDaOcorrencia({ data: "2026-11-10", situacao: "ABERTA", resolvidaEm: "2020-01-01" }, HOJE)).toBeNull();
    expect(erroDaOcorrencia({ data: "2026-11-10", situacao: "EM_ANDAMENTO", resolvidaEm: "lixo" }, HOJE)).toBeNull();
  });

  it("o que grava: só a RESOLVIDA tem data e observação; aberta e em andamento ficam sem (reabrir limpa)", () => {
    expect(resolucaoGravada({ data: "2026-11-10", situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Filtro trocado" }, HOJE)).toEqual({ resolvidaEm: "2026-11-11", resolucao: "Filtro trocado" });
    expect(resolucaoGravada({ data: "2026-11-10", situacao: "RESOLVIDA", resolvidaEm: null, resolucao: null }, HOJE)).toEqual({ resolvidaEm: HOJE, resolucao: null });
    expect(resolucaoGravada({ data: "2026-11-10", situacao: "RESOLVIDA" }, HOJE)).toEqual({ resolvidaEm: HOJE, resolucao: null });
    for (const situacao of ["ABERTA", "EM_ANDAMENTO"] as const)
      expect(resolucaoGravada({ data: "2026-11-10", situacao, resolvidaEm: "2026-11-11", resolucao: "Filtro trocado" }, HOJE)).toEqual({ resolvidaEm: null, resolucao: null });
  });
});

/* ───────── a lista da tela ───────── */
const oc = (id: string, extra: Partial<OcorrenciaPmoc> = {}): OcorrenciaPmoc => ({
  id, data: "2026-11-10", descricao: "Vazamento de água na bandeja", gravidade: "ALTA", situacao: "ABERTA", resolvidaEm: null, resolucao: null,
  equipamento: { id: "q1", rotulo: "AC-001 · Split da recepção", tag: "AC-001" }, ordemServico: null, anexo: null, origem: "MANUAL", ativo: true, criadoEm: "2026-11-10T12:00:00.000Z", ...extra,
});
const LISTA = [
  oc("vazamento"),
  oc("ruido", { data: "2026-11-07", descricao: "Ruído anormal no compressor", gravidade: "CRITICA", situacao: "EM_ANDAMENTO", equipamento: null }),
  oc("filtro", { data: "2026-11-02", descricao: "Filtro danificado", gravidade: "MEDIA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-04", resolucao: "Trocado por um filtro novo", equipamento: { id: "q2", rotulo: "AC-002 · Split UTI 1", tag: "AC-002" } }),
  oc("corrosao", { data: "2026-10-23", descricao: "Corrosão na base", gravidade: "BAIXA", equipamento: { id: "q3", rotulo: "CH-001 · Chiller central", tag: "CH-001" }, ordemServico: { id: "os9", numero: "OS-467" } }),
  oc("engano", { descricao: "Falha elétrica registrada por engano", gravidade: "CRITICA", ativo: false }),
];
const ids = (l: { id: string }[]) => l.map((o) => o.id);
const filtrar = (f: Partial<typeof FILTRO_VAZIO>) => ids(filtrarOcorrencias(LISTA, { ...FILTRO_VAZIO, ...f }));

describe("ocorrência do PMOC: busca e filtros da lista", () => {
  it("sem filtro: só as que estão valendo; 'Excluídas' mostra só as excluídas", () => {
    expect(filtrar({})).toEqual(["vazamento", "ruido", "filtro", "corrosao"]);
    expect(filtrar({ situacao: "EXCLUIDAS" })).toEqual(["engano"]);
  });

  it("filtro por SITUAÇÃO e por GRAVIDADE, sozinhos e juntos; a excluída nunca entra por eles", () => {
    expect(filtrar({ situacao: "ABERTA" })).toEqual(["vazamento", "corrosao"]);
    expect(filtrar({ situacao: "EM_ANDAMENTO" })).toEqual(["ruido"]);
    expect(filtrar({ situacao: "RESOLVIDA" })).toEqual(["filtro"]);
    expect(filtrar({ gravidade: "CRITICA" })).toEqual(["ruido"]); // a excluída também é crítica e aberta, e não aparece
    expect(filtrar({ gravidade: "BAIXA" })).toEqual(["corrosao"]);
    expect(filtrar({ gravidade: "MEDIA" })).toEqual(["filtro"]);
    expect(filtrar({ gravidade: "ALTA" })).toEqual(["vazamento"]);
    expect(filtrar({ situacao: "ABERTA", gravidade: "BAIXA" })).toEqual(["corrosao"]);
    expect(filtrar({ situacao: "RESOLVIDA", gravidade: "ALTA" })).toEqual([]);
    expect(filtrar({ situacao: "EXCLUIDAS", gravidade: "CRITICA" })).toEqual(["engano"]);
    expect(filtrar({ situacao: "EXCLUIDAS", gravidade: "BAIXA" })).toEqual([]);
  });

  it("BUSCA: descrição, resolução, equipamento (nome e TAG), 'geral' e número da OS — sem acento nem maiúscula", () => {
    expect(filtrar({ busca: "ruido" })).toEqual(["ruido"]);
    expect(filtrar({ busca: "RUÍDO" })).toEqual(["ruido"]);
    expect(filtrar({ busca: "corrosao" })).toEqual(["corrosao"]);
    expect(filtrar({ busca: "ac-002" })).toEqual(["filtro"]);
    expect(filtrar({ busca: "chiller" })).toEqual(["corrosao"]);
    expect(filtrar({ busca: "geral" })).toEqual(["ruido"]);
    expect(filtrar({ busca: "filtro novo" })).toEqual(["filtro"]);     // está na resolução
    expect(filtrar({ busca: "os-467" })).toEqual(["corrosao"]);
    expect(filtrar({ busca: "  split   vazamento " })).toEqual(["vazamento"]); // todas as palavras, em qualquer ordem
    expect(filtrar({ busca: "split chiller" })).toEqual([]);
    expect(filtrar({ busca: "   " })).toEqual(["vazamento", "ruido", "filtro", "corrosao"]);
    expect(filtrar({ busca: "split", situacao: "RESOLVIDA" })).toEqual(["filtro"]); // busca + filtro
    expect(filtrar({ busca: "engano" })).toEqual([]);
    expect(filtrar({ busca: "engano", situacao: "EXCLUIDAS" })).toEqual(["engano"]);
  });

  it("ordem: na tela, a mais recente primeiro; no livro, a mais antiga — no mesmo dia, pela hora do registro", () => {
    const doDia = [oc("a", { criadoEm: "2026-11-10T12:00:00.000Z" }), oc("c", { data: "2026-11-11" }), oc("b", { criadoEm: "2026-11-10T15:00:00.000Z" }), oc("z", { data: "2026-10-01" })];
    expect(ids(ordenarOcorrencias(doDia))).toEqual(["c", "b", "a", "z"]);
    expect(ids(ordenarOcorrencias(doDia, "antigas"))).toEqual(["z", "a", "b", "c"]);
    expect(ids(doDia)).toEqual(["a", "c", "b", "z"]); // não mexe na lista recebida
  });

  it("contagem: o número da aba são as NÃO resolvidas que estão valendo; a excluída fica à parte", () => {
    expect(contarOcorrencias(LISTA)).toEqual({ total: 4, abertas: 2, emAndamento: 1, resolvidas: 1, pendentes: 3, excluidas: 1 });
    expect(contarOcorrencias([])).toEqual({ total: 0, abertas: 0, emAndamento: 0, resolvidas: 0, pendentes: 0, excluidas: 0 });
    expect(contarOcorrencias([{ situacao: "ABERTA" }, { situacao: "RESOLVIDA" }])).toMatchObject({ total: 2, pendentes: 1, excluidas: 0 }); // sem "ativo" (documento): todas valem
  });

  it("resumo em uma frase, só com o que há, no singular e no plural", () => {
    const r = (abertas: number, emAndamento: number, resolvidas: number) => resumoDasOcorrencias({ total: abertas + emAndamento + resolvidas, abertas, emAndamento, resolvidas });
    expect(r(0, 0, 0)).toBe("Nenhuma ocorrência registrada");
    expect(r(1, 0, 0)).toBe("1 ocorrência: 1 aberta");
    expect(r(2, 0, 0)).toBe("2 ocorrências: 2 abertas");
    expect(r(0, 1, 0)).toBe("1 ocorrência: 1 em andamento");
    expect(r(0, 0, 1)).toBe("1 ocorrência: 1 resolvida");
    expect(r(0, 0, 3)).toBe("3 ocorrências: 3 resolvidas");
    expect(r(2, 0, 2)).toBe("4 ocorrências: 2 abertas e 2 resolvidas");
    expect(r(2, 1, 1)).toBe("4 ocorrências: 2 abertas, 1 em andamento e 1 resolvida");
    expect(resumoDasOcorrencias(contarOcorrencias(LISTA))).toBe("4 ocorrências: 2 abertas, 1 em andamento e 1 resolvida");
  });
});

describe("ocorrência do PMOC: textos", () => {
  it("situação: a resolvida diz quando; as outras, só o nome", () => {
    expect(textoDaSituacao({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-04" })).toBe("Resolvida em 04/11/2026");
    expect(textoDaSituacao({ situacao: "RESOLVIDA", resolvidaEm: new Date("2026-11-04T00:00:00Z") })).toBe("Resolvida em 04/11/2026");
    expect(textoDaSituacao({ situacao: "RESOLVIDA", resolvidaEm: null })).toBe("Resolvida");
    expect(textoDaSituacao({ situacao: "ABERTA", resolvidaEm: "2026-11-04" })).toBe("Aberta");
    expect(textoDaSituacao({ situacao: "EM_ANDAMENTO" })).toBe("Em andamento");
    expect(textoDaSituacao({ situacao: "OUTRA" })).toBe("OUTRA");
  });

  it("equipamento: TAG e nome; sem nome, marca e modelo; sem TAG, só o nome", () => {
    expect(rotuloDoEquipamento({ patrimonio: "AC-001", nome: "Split da recepção", marca: "LG", modelo: "S4" })).toBe("AC-001 · Split da recepção");
    expect(rotuloDoEquipamento({ patrimonio: "AC-003", nome: null, marca: "LG", modelo: "S4" })).toBe("AC-003 · LG S4");
    expect(rotuloDoEquipamento({ patrimonio: null, nome: " Chiller ", marca: "Carrier", modelo: "30XA" })).toBe("Chiller");
    expect(rotuloDoEquipamento({ patrimonio: " ", nome: "", marca: "", modelo: "" })).toBe("Equipamento");
  });

  it("linha do histórico: gravidade, equipamento (ou geral) e a descrição numa linha, cortada em 200", () => {
    expect(detalheDaOcorrencia({ gravidade: "ALTA", descricao: "Vazamento  de água\nna bandeja ", equipamento: "AC-001 · Split da recepção" })).toBe("Alta · AC-001 · Split da recepção — Vazamento de água na bandeja");
    expect(detalheDaOcorrencia({ gravidade: "CRITICA", descricao: "Ruído anormal", equipamento: null })).toBe("Crítica · Geral da unidade — Ruído anormal");
    const longa = detalheDaOcorrencia({ gravidade: "BAIXA", descricao: "x".repeat(500) });
    expect(longa).toHaveLength(200);
    expect(longa.endsWith("…")).toBe(true);
    expect(detalheDaOcorrencia({ gravidade: "BAIXA", descricao: "x".repeat(200 - "Baixa · Geral da unidade — ".length) })).toHaveLength(200); // no limite, inteira
  });

  it("o que o histórico registra: registrada, resolvida, reaberta, alterada, excluída e restaurada", () => {
    expect(acaoDaMudanca(null, "ABERTA")).toBe("Ocorrência registrada");
    expect(acaoDaMudanca(null, "RESOLVIDA")).toBe("Ocorrência registrada");
    expect(acaoDaMudanca("ABERTA", "RESOLVIDA")).toBe("Ocorrência resolvida");
    expect(acaoDaMudanca("EM_ANDAMENTO", "RESOLVIDA")).toBe("Ocorrência resolvida");
    expect(acaoDaMudanca("RESOLVIDA", "ABERTA")).toBe("Ocorrência reaberta");
    expect(acaoDaMudanca("RESOLVIDA", "EM_ANDAMENTO")).toBe("Ocorrência reaberta");
    expect(acaoDaMudanca("RESOLVIDA", "RESOLVIDA")).toBe("Ocorrência alterada");
    expect(acaoDaMudanca("ABERTA", "EM_ANDAMENTO")).toBe("Ocorrência alterada");
    expect(acaoDaMudanca("ABERTA", "ABERTA")).toBe("Ocorrência alterada");
    expect([ACAO_EXCLUIDA, ACAO_RESTAURADA]).toEqual(["Ocorrência excluída", "Ocorrência restaurada"]);
  });
});

/* ───────── o documento ───────── */
const AGORA = new Date("2026-11-12T15:00:00.000Z");
function dados(ocorrencias?: OcorrenciaDoDocumento[]): DadosDocumento {
  const pmoc = { nome: "PMOC 2027 — Hospital Santa Clara", descricao: null, status: "PUBLICADO", ativo: true, dataInicio: "2026-08-14", dataExpiracao: "2027-08-13", rtNome: "Eng. Roberto Mendes", rtCrea: "5012345-D/SP", artNumero: "28027230241234567", artArquivoNome: null };
  const equipamento = { id: "q1", ativo: true, patrimonio: "AC-001", nome: "Split da recepção", marca: "LG", modelo: "S4", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: null, tipoNome: "Split", capacidade: "48000", setor: "Térreo", localizacao: "Recepção", unidadeId: "u1", unidadeNome: "Matriz" };
  return {
    empresa: { nome: "Clima Total" }, pmoc, cliente: { nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: null }, unidade: { nome: "Matriz" },
    equipamentos: [equipamento],
    estado: { pmoc: { status: pmoc.status, ativo: true, dataInicio: pmoc.dataInicio, dataExpiracao: pmoc.dataExpiracao }, itens: [], equipamentos: [{ id: "q1", ativo: true, unidadeId: "u1", tipoEquipamentoId: null, tipo: "AR_CONDICIONADO_SPLIT" }], tipos: [], execucoes: [] },
    itens: [], atividades: [], geradoEm: AGORA, ...(ocorrencias ? { ocorrencias } : {}),
  };
}
const SPLIT = { patrimonio: "AC-001", nome: "Split da recepção", marca: "LG", modelo: "S4" };
const DO_LIVRO: OcorrenciaDoDocumento[] = [
  { data: "2026-11-12", criadoEm: "2026-11-12T12:00:00.000Z", equipamento: SPLIT, descricao: "Vazamento de água na bandeja da evaporadora", gravidade: "ALTA", situacao: "ABERTA", resolvidaEm: null, resolucao: null },
  { data: "2026-11-07", criadoEm: "2026-11-12T13:00:00.000Z", equipamento: null, descricao: "Ruído anormal no compressor", gravidade: "CRITICA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Coxins do compressor trocados" },
  { data: "2026-10-23", criadoEm: "2026-11-12T14:00:00.000Z", equipamento: { patrimonio: null, nome: null, marca: "Carrier", modelo: "30XA" }, descricao: "Corrosão na base", gravidade: "MEDIA", situacao: "EM_ANDAMENTO", resolvidaEm: "2026-11-01", resolucao: "Texto que sobrou de antes" },
  { data: "2026-11-07", criadoEm: "2026-11-12T12:30:00.000Z", equipamento: SPLIT, descricao: "Filtro danificado", gravidade: "BAIXA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-08", resolucao: null },
];

describe("documento do PMOC: a seção de ocorrências", () => {
  it("o livro em ordem de data (no mesmo dia, pela ordem do registro), com equipamento, gravidade e situação por extenso", () => {
    const m = montarDocumento(dados(DO_LIVRO));
    expect(m.ocorrencias).toEqual([
      { data: "23/10/2026", equipamento: "Carrier 30XA", descricao: "Corrosão na base", resolucao: "", gravidade: "Média", situacao: "Em andamento" },
      { data: "07/11/2026", equipamento: "AC-001 · Split da recepção", descricao: "Filtro danificado", resolucao: "", gravidade: "Baixa", situacao: "Resolvida em 08/11/2026" },
      { data: "07/11/2026", equipamento: "Geral da unidade", descricao: "Ruído anormal no compressor", resolucao: "Coxins do compressor trocados", gravidade: "Crítica", situacao: "Resolvida em 11/11/2026" },
      { data: "12/11/2026", equipamento: "AC-001 · Split da recepção", descricao: "Vazamento de água na bandeja da evaporadora", resolucao: "", gravidade: "Alta", situacao: "Aberta" },
    ]);
    expect(m.resumoOcorrencias).toBe("4 ocorrências: 1 aberta, 1 em andamento e 2 resolvidas");
    expect(DO_LIVRO[0].data).toBe("2026-11-12"); // não mexe no que recebeu
  });

  it("plano sem ocorrência (ou cadastro que não as traz): a seção existe e diz que não há", () => {
    for (const d of [dados(), dados([])]) {
      const m = montarDocumento(d);
      expect(m.ocorrencias).toEqual([]);
      expect(m.resumoOcorrencias).toBe("Nenhuma ocorrência registrada");
    }
  });

  it("PDF: a seção '5. Ocorrências' vem depois do planejamento e antes das assinaturas, com a tabela e a resolução", async () => {
    const pdf = await gerarPdfDocumento(montarDocumento(dados(DO_LIVRO)));
    const texto = await textoDoPdf(pdf.bytes);
    for (const trecho of [
      "5. Ocorrências", "Não conformidades encontradas na manutenção dos equipamentos do plano. 4 ocorrências: 1 aberta, 1 em andamento e 2",
      "DATA", "EQUIPAMENTO", "DESCRIÇÃO", "GRAVIDADE", "SITUAÇÃO",
      "23/10/2026", "Carrier 30XA", "Corrosão na base", "Média", "Em andamento",
      "07/11/2026", "Geral da unidade", "Ruído anormal no compressor", "Resolução: Coxins do compressor trocados", "Crítica", "Resolvida em", "11/11/2026",
      "12/11/2026", "Vazamento de água na bandeja da", "Alta", "Aberta",
    ]) expect(texto, trecho).toContain(trecho);
    expect(texto).not.toContain("Texto que sobrou de antes"); // resolução de ocorrência que não está resolvida não sai
    const ordem = ["4. Planejamento das atividades", "5. Ocorrências", "Corrosão na base", "Filtro danificado", "Ruído anormal no compressor", "Vazamento de água na bandeja da", "Responsável pelo estabelecimento"].map((t) => texto.indexOf(t));
    expect(ordem.every((p) => p >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it("PDF sem ocorrência: a seção sai com a frase, e o documento não ganha página", async () => {
    const [sem, com] = await Promise.all([gerarPdfDocumento(montarDocumento(dados())), gerarPdfDocumento(montarDocumento(dados(DO_LIVRO)))]);
    const texto = await textoDoPdf(sem.bytes);
    expect(texto).toContain("5. Ocorrências");
    expect(texto).toContain("Nenhuma ocorrência registrada neste plano até a emissão deste documento.");
    expect(texto).not.toContain("GRAVIDADE");
    expect(sem.paginas).toBe(com.paginas);
    expect(texto.indexOf("5. Ocorrências")).toBeLessThan(texto.indexOf("Responsável pelo estabelecimento"));
  });

  it("livro grande (120 ocorrências, textos longos): a tabela quebra de folha repetindo o cabeçalho e nada se perde", async () => {
    const muitas: OcorrenciaDoDocumento[] = Array.from({ length: 120 }, (_, i) => ({
      data: `2026-${String(8 + Math.floor(i / 40)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, criadoEm: `2026-11-12T12:00:${String(i % 60).padStart(2, "0")}.000Z`,
      equipamento: i % 3 ? SPLIT : null, descricao: `Ocorrência número ${i + 1}: ${"vazamento na linha de sucção com formação de gelo ".repeat(1 + (i % 4))}`.trim(),
      gravidade: GRAVIDADES[i % 4], situacao: SITUACOES[i % 3], resolvidaEm: i % 3 === 2 ? "2026-11-10" : null, resolucao: i % 3 === 2 ? "Carga de gás refeita e teste de estanqueidade" : null,
    }));
    const [pequeno, grande] = await Promise.all([gerarPdfDocumento(montarDocumento(dados(DO_LIVRO))), gerarPdfDocumento(montarDocumento(dados(muitas)))]);
    const texto = await textoDoPdf(grande.bytes);
    expect(grande.paginas).toBeGreaterThan(pequeno.paginas + 3);
    expect(await paginasDe(grande.bytes)).toHaveLength(grande.paginas);
    const cabecalhos = texto.split("\n").filter((l) => l === "GRAVIDADE").length;
    expect(cabecalhos).toBeGreaterThanOrEqual(grande.paginas - pequeno.paginas + 1); // um por folha da tabela
    for (const n of [1, 60, 120]) expect(texto, String(n)).toContain(`Ocorrência número ${n}:`);
    expect(texto.replace(/\n/g, " ")).toContain("120 ocorrências: 40 abertas, 40 em andamento e 40 resolvidas."); // a frase quebra de linha no PDF
    expect(texto).toContain(`Página ${grande.paginas} de ${grande.paginas}`);
  });
});
