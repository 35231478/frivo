/**
 * Cadastro de equipamento em campo — regras PURAS (as mesmas no aparelho e no servidor):
 * o formato da gravação, como o equipamento novo aparece antes de sincronizar, a conferência de série
 * que dá para fazer sem sinal e a entrada dele na OS pela fila do aparelho.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_FOTOS_CADASTRO, MSG_TIPO_OBRIGATORIO, apresentarCadastro, cadastroEquipamentoSchema, mesmaSerie, montarCapacidade, seriesNoAparelho, type TipoCadastro,
} from "@/lib/tecnico/cadastro-equipamento";
import { CONFIG_APP_PADRAO, configAppParaPayload, normalizarConfigApp } from "@/lib/tecnico/config-app";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import { operacaoSchema } from "@/lib/tecnico/sync";
import type { OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const ID = "3f2b8c1e-5d47-4a0b-9c6e-1a2b3c4d5e6f";
const TIPOS: TipoCadastro[] = [
  { valor: "AR_CONDICIONADO_SPLIT", nome: "Split Hi-Wall", tipoEquipamentoId: "te1" },
  { valor: "custom:teCam", nome: "Câmara fria", tipoEquipamentoId: "teCam" },
  { valor: "CHILLER", nome: "Chiller", tipoEquipamentoId: null }, // tipo padrão ainda sem cadastro (sem checklist)
];
const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

describe("formato do cadastro em campo", () => {
  it("só o tipo é obrigatório (além do id gerado no aparelho); o resto é opcional", () => {
    expect(cadastroEquipamentoSchema.safeParse({ id: ID, tipo: "AR_CONDICIONADO_SPLIT" }).success).toBe(true);
    const semTipo = cadastroEquipamentoSchema.safeParse({ id: ID, tipo: "  " });
    expect(semTipo.success).toBe(false);
    expect(!semTipo.success && semTipo.error.issues[0].message).toBe(MSG_TIPO_OBRIGATORIO);
    expect(cadastroEquipamentoSchema.safeParse({ tipo: "CHILLER" }).success).toBe(false);
    expect(cadastroEquipamentoSchema.safeParse({ id: "eq-123", tipo: "CHILLER" }).success).toBe(false); // o id tem de ser uuid
  });

  it("cliente e unidade NÃO vêm do aparelho (são os da OS): campo a mais é recusado", () => {
    for (const extra of [{ unidadeId: "un9" }, { clienteId: "c9" }, { empresaId: "e9" }, { ativo: false }])
      expect(cadastroEquipamentoSchema.safeParse({ id: ID, tipo: "CHILLER", ...extra }).success).toBe(false);
  });

  it("limites: até 3 fotos; textos aparados e com tamanho máximo", () => {
    expect(MAX_FOTOS_CADASTRO).toBe(3);
    expect(cadastroEquipamentoSchema.safeParse({ id: ID, tipo: "CHILLER", fotos: [FOTO, FOTO, FOTO] }).success).toBe(true);
    expect(cadastroEquipamentoSchema.safeParse({ id: ID, tipo: "CHILLER", fotos: [FOTO, FOTO, FOTO, FOTO] }).success).toBe(false);
    expect(cadastroEquipamentoSchema.safeParse({ id: ID, tipo: "CHILLER", numeroSerie: "x".repeat(81) }).success).toBe(false);
    expect(cadastroEquipamentoSchema.parse({ id: ID, tipo: " CHILLER ", numeroSerie: "  ABC123 " })).toMatchObject({ tipo: "CHILLER", numeroSerie: "ABC123" });
  });

  it("é uma operação da MESMA fila de sincronização; o id do equipamento vai dentro de `dados`", () => {
    const op = { id: "11111111-1111-4111-8111-111111111111", atividadeId: "a1", tipo: "cadastrarEquipamento", dados: { id: ID, tipo: "CHILLER" } };
    expect(operacaoSchema.safeParse(op).success).toBe(true);
    // com `equipamentoId` no topo o servidor exigiria um vínculo que ainda não existe: não é aceito
    expect(operacaoSchema.safeParse({ ...op, equipamentoId: ID }).success).toBe(false);
  });

  it("capacidade: número + unidade; vazio fica sem capacidade", () => {
    expect(montarCapacidade("12000", "BTU/h")).toBe("12000 BTU/h");
    expect(montarCapacidade(" 5 ", "TR")).toBe("5 TR");
    expect(montarCapacidade("  ", "BTU/h")).toBeUndefined();
  });
});

describe("como o equipamento novo aparece antes de sincronizar", () => {
  it("título, fabricante e local saem pelas mesmas regras do servidor (a tela não muda quando o retrato chega)", () => {
    const e = apresentarCadastro({ id: ID, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4-W12JA3AA", numeroSerie: " LG24K ", capacidade: "12000 BTU/h", setor: "2º andar", ambiente: "Sala 201" }, TIPOS);
    expect(e).toMatchObject({
      id: ID, titulo: "Split Hi-Wall — 12.000 BTU/h", fabricante: "LG S4-W12JA3AA", numeroSerie: "LG24K", local: "Sala 201 · 2º andar",
      tag: null, unidade: null, ativo: true, tipo: { id: "te1", nome: "Split Hi-Wall" }, tipoEquipamentoId: "te1",
    });
  });

  it("sem marca, modelo, capacidade e local: só o tipo; tipo personalizado usa o nome dele", () => {
    expect(apresentarCadastro({ id: ID, tipo: "custom:teCam" }, TIPOS)).toMatchObject({ titulo: "Câmara fria", fabricante: "", local: null, numeroSerie: null, tipoEquipamentoId: "teCam" });
    expect(apresentarCadastro({ id: ID, tipo: "CHILLER", setor: "Cobertura" }, TIPOS)).toMatchObject({ titulo: "Chiller", local: "Cobertura", tipo: null, tipoEquipamentoId: null });
  });
});

describe("conferência de série SEM sinal (o que o aparelho tem)", () => {
  const daUnidade = [
    { id: "eqA", titulo: "Split Recepção", local: "Recepção", numeroSerie: "ABC123XYZ" },
    { id: "eqB", titulo: "Split Sala 2", local: null, numeroSerie: null },
  ];
  const naFila = [{ id: "novo1", titulo: "Split Hi-Wall · LG", local: "Sala 9", numeroSerie: " abc123xyz " }];

  it("mesma etiqueta: sem ligar para maiúsculas e espaços; curta demais ou vazia nunca é a mesma", () => {
    expect(mesmaSerie(" abc123xyz", "ABC123XYZ ")).toBe(true);
    expect(mesmaSerie("ABC123", "ABC123XYZ")).toBe(false);
    expect([mesmaSerie("AB", "ab"), mesmaSerie("", ""), mesmaSerie(null, undefined)]).toEqual([false, false, false]);
  });

  it("acha nos equipamentos da unidade e nos cadastros da fila — os da fila primeiro; ignora o próprio", () => {
    expect(seriesNoAparelho("abc123xyz", daUnidade, naFila)).toEqual([
      { id: "novo1", titulo: "Split Hi-Wall · LG", local: "Sala 9", origem: "fila" },
      { id: "eqA", titulo: "Split Recepção", local: "Recepção", origem: "unidade" },
    ]);
    expect(seriesNoAparelho("abc123xyz", daUnidade, naFila, "novo1").map((s) => s.id)).toEqual(["eqA"]);
    expect(seriesNoAparelho("OUTRA-1", daUnidade, naFila)).toEqual([]);
    expect(seriesNoAparelho("ab", daUnidade, naFila)).toEqual([]);
  });

  it("o mesmo equipamento na fila e já na unidade (acabou de sincronizar) aparece uma vez só", () => {
    expect(seriesNoAparelho("ABC123XYZ", [{ id: "novo1", titulo: "Split", local: null, numeroSerie: "ABC123XYZ" }], naFila)).toHaveLength(1);
  });
});

describe("na fila do aparelho: o equipamento novo entra na OS", () => {
  const item = (id: string, texto: string) => ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null });
  const retrato = (cadastro: RetratoAtividade["cadastro"]): RetratoAtividade => ({
    cartao: {} as never,
    execucao: {
      atividade: { id: "a1", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os1", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false, equipamentos: [], adicionais: [], conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null } as never,
    },
    equipamentosUnidade: [], checklistsPorTipo: { te1: [item("i1", "Limpeza dos filtros")], teCam: [item("iCam", "Vedação da porta")] }, cadastro, geradoEm: "2026-12-04T12:00:00.000Z",
  });
  const op = (seq: number, extra: Record<string, unknown>): OperacaoFila =>
    ({ id: `op${seq}`, seq, atividadeId: "a1", criadoEm: "", estado: "pendente", tentativas: 0, ...extra }) as unknown as OperacaoFila;
  const cadastro = { unidadeId: "un1", tipos: TIPOS, setores: [], ambientes: [] };

  it("aparece vinculado (ainda não atendido), marcado 'no aparelho', com o checklist do TIPO escolhido — mesmo de tipo que não havia na unidade", () => {
    const x = estadoDaAtividade(retrato(cadastro), [op(1, { tipo: "cadastrarEquipamento", dados: { id: ID, tipo: "custom:teCam", marca: "Elgin" } })]);
    expect(x.equipamentos).toHaveLength(1);
    expect(x.equipamentos[0]).toMatchObject({ vinculoId: null, feito: false, pendente: true, equipamento: { id: ID, titulo: "Câmara fria", fabricante: "Elgin" } });
    expect(x.equipamentos[0].itens.map((i) => i.texto)).toEqual(["Vedação da porta"]);
  });

  it("as gravações seguintes já caem nele: responder o checklist o deixa atendido e conta na conclusão", () => {
    const x = estadoDaAtividade(retrato(cadastro), [
      op(1, { tipo: "cadastrarEquipamento", dados: { id: ID, tipo: "AR_CONDICIONADO_SPLIT" } }),
      op(2, { tipo: "resposta", equipamentoId: ID, itemId: "i1", dados: { status: "OK" } }),
    ]);
    expect(x.equipamentos[0]).toMatchObject({ feito: true, completo: true });
    expect(x.equipamentos[0].respostas.i1.status).toBe("OK");
    expect(x.conclusao.atendidos).toBe(1);
  });

  it("a mesma gravação duas vezes na fila não duplica o equipamento; tipo sem cadastro entra sem checklist", () => {
    const duas = estadoDaAtividade(retrato(cadastro), [1, 2].map((s) => op(s, { tipo: "cadastrarEquipamento", dados: { id: ID, tipo: "CHILLER" } })));
    expect(duas.equipamentos).toHaveLength(1);
    expect(duas.equipamentos[0].itens).toEqual([]);
    expect(duas.equipamentos[0].equipamento.titulo).toBe("Chiller");
  });

  it("retrato antigo (sem a lista de tipos): o equipamento ainda aparece — nada se perde", () => {
    const x = estadoDaAtividade(retrato(undefined), [op(1, { tipo: "cadastrarEquipamento", dados: { id: ID, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG" } })]);
    expect(x.equipamentos[0].equipamento).toMatchObject({ id: ID, fabricante: "LG" });
  });
});

describe("permissão 'Permitir cadastrar equipamento em campo'", () => {
  it("nasce LIGADA; vai e volta da configuração; empresa sem linha ou coluna vazia = padrão (ligada)", () => {
    expect(CONFIG_APP_PADRAO.cadastrarEquipamento).toBe(true);
    expect(normalizarConfigApp(null).cadastrarEquipamento).toBe(true);
    expect(normalizarConfigApp({}).cadastrarEquipamento).toBe(true);
    expect(normalizarConfigApp({ appCadastrarEquipamento: false }).cadastrarEquipamento).toBe(false);
    expect(configAppParaPayload({ ...CONFIG_APP_PADRAO, cadastrarEquipamento: false }).appCadastrarEquipamento).toBe(false);
  });
});
