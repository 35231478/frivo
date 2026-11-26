/**
 * Checklist de veículo obrigatório no app (o "porteiro") — regras puras (lib/checklist-diario/regras).
 */
import { describe, expect, it } from "vitest";
import {
  CONFIG_DIARIO_PADRAO, chaveValida, colaboradorObrigado, decidirGravacao, diaAceito, diaDaSemana, diaExigeChecklist, diasValidos,
  horarioDoToque, hojeBR, linhasDoHistorico, normalizarConfigDiario, porteiroAberto, situacaoNoHistorico, somarDias, veiculoEmUso,
  type ResumoPorteiro, type RegistroHistorico,
} from "@/lib/checklist-diario/regras";

const LIGADO = { ativo: true, dias: [1, 2, 3, 4, 5], templateId: "tpl", todos: true, tecnicos: [] };
// 2027-01-04 = segunda; 2027-01-09 = sábado; 2027-01-10 = domingo
const SEG = "2027-01-04", SAB = "2027-01-09", DOM = "2027-01-10";

describe("configuração", () => {
  it("padrão: desligado, segunda a sexta, todos, sem modelo", () => {
    expect(CONFIG_DIARIO_PADRAO).toEqual({ ativo: false, dias: [1, 2, 3, 4, 5], templateId: null, todos: true, tecnicos: [] });
    expect(normalizarConfigDiario(null)).toEqual(CONFIG_DIARIO_PADRAO);
    expect(normalizarConfigDiario(null).dias).not.toBe(CONFIG_DIARIO_PADRAO.dias); // cópia, não a mesma lista
  });
  it("lê as colunas: só `true` liga; dias válidos sem repetir; todos só desliga com false", () => {
    expect(normalizarConfigDiario({ checklistDiarioAtivo: true, checklistDiarioDias: [5, 1, 1, 9, -1], checklistDiarioTemplateId: "t", checklistDiarioTodos: false, checklistDiarioTecnicos: ["a", "a", ""] }))
      .toEqual({ ativo: true, dias: [1, 5], templateId: "t", todos: false, tecnicos: ["a"] });
    expect(normalizarConfigDiario({ checklistDiarioAtivo: null, checklistDiarioTodos: null, checklistDiarioTemplateId: "" })).toMatchObject({ ativo: false, todos: true, templateId: null, dias: [1, 2, 3, 4, 5] });
    expect(diasValidos([6, 0, 3.5, "2", null])).toEqual([0, 2, 6]);
    expect(diasValidos(undefined)).toEqual([]);
  });
});

describe("dias (fuso de Brasília)", () => {
  it("dia da semana pela chave; hoje em Brasília (23h de domingo em Brasília já é segunda em UTC)", () => {
    expect([diaDaSemana(SEG), diaDaSemana(SAB), diaDaSemana(DOM)]).toEqual([1, 6, 0]);
    expect(hojeBR(Date.parse("2027-01-11T02:30:00Z"))).toBe("2027-01-10"); // 23h30 de domingo em Brasília
    expect(hojeBR(Date.parse("2027-01-11T03:30:00Z"))).toBe("2027-01-11");
  });
  it("somar dias atravessa mês e ano; chave válida", () => {
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2027-03-01", -1)).toBe("2027-02-28");
    expect([chaveValida("2027-01-04"), chaveValida("04/01/2027"), chaveValida("2027-13-40"), chaveValida(null)]).toEqual([true, false, false, false]);
  });
  it("o dia exige checklist: ligado + modelo + dia da semana escolhido", () => {
    expect(diaExigeChecklist(LIGADO, SEG)).toBe(true);
    expect(diaExigeChecklist(LIGADO, SAB)).toBe(false);
    expect(diaExigeChecklist({ ...LIGADO, dias: [6] }, SAB)).toBe(true);
    expect(diaExigeChecklist({ ...LIGADO, ativo: false }, SEG)).toBe(false);
    expect(diaExigeChecklist({ ...LIGADO, templateId: null }, SEG)).toBe(false);
  });
  it("quem é obrigado: todos com veículo padrão, ou só os escolhidos", () => {
    expect(colaboradorObrigado(LIGADO, "x")).toBe(true);
    expect(colaboradorObrigado({ ...LIGADO, todos: false, tecnicos: ["a"] }, "a")).toBe(true);
    expect(colaboradorObrigado({ ...LIGADO, todos: false, tecnicos: ["a"] }, "b")).toBe(false);
  });
  it("veículo em uso: inativo ou em manutenção não dá porteiro", () => {
    expect([veiculoEmUso({ status: "ATIVO" }), veiculoEmUso({ status: "MANUTENCAO" }), veiculoEmUso({ status: "INATIVO" }), veiculoEmUso(null)]).toEqual([true, false, false, false]);
  });
});

describe("porteiroAberto — o app trava hoje?", () => {
  const R = (registro: ResumoPorteiro["registro"] = null, dias = [1, 2, 3, 4, 5]): ResumoPorteiro => ({
    dias, diaServidor: SEG, registro, veiculo: { id: "v", placa: "ABC1D23", modelo: "Strada" }, modelo: { id: "tpl", nome: "Diário", itens: [] },
  });
  it("sem resumo (não obrigado, opção ou Frota desligada…) nunca trava", () => {
    expect(porteiroAberto(null, SEG)).toBe(false);
    expect(porteiroAberto(undefined, SEG)).toBe(false);
  });
  it("dia de checklist sem registro: trava", () => { expect(porteiroAberto(R(), SEG)).toBe(true); });
  it("fora dos dias escolhidos: não trava", () => { expect(porteiroAberto(R(), SAB)).toBe(false); });
  it("feito ou 'não vou usar' hoje, no servidor ou só no aparelho (ainda sem subir): libera", () => {
    expect(porteiroAberto(R({ dia: SEG, situacao: "FEITO" }), SEG)).toBe(false);
    expect(porteiroAberto(R({ dia: SEG, situacao: "NAO_VAI_USAR" }), SEG)).toBe(false);
    expect(porteiroAberto(R(), SEG, [SEG])).toBe(false);
  });
  it("o registro de ONTEM não vale para hoje (renova no próximo dia de checklist)", () => {
    const terca = somarDias(SEG, 1);
    expect(porteiroAberto(R({ dia: SEG, situacao: "FEITO" }), terca)).toBe(true);
    expect(porteiroAberto(R(), terca, [SEG])).toBe(true);
  });
  it("chave de hoje inválida (relógio estranho): não trava", () => { expect(porteiroAberto(R(), "lixo")).toBe(false); });
});

describe("decidirGravacao — um registro por colaborador por dia", () => {
  it("nada ainda: cria", () => { expect(decidirGravacao(null, { situacao: "FEITO", clientId: "a" })).toBe("criar"); });
  it("o mesmo envio de novo (perdeu a resposta): repetido, não duplica", () => {
    expect(decidirGravacao({ situacao: "FEITO", clientId: "a" }, { situacao: "FEITO", clientId: "a" })).toBe("repetido");
    expect(decidirGravacao({ situacao: "NAO_VAI_USAR", clientId: "a" }, { situacao: "NAO_VAI_USAR", clientId: "a" })).toBe("repetido");
  });
  it("mudou de ideia: 'não vou usar' vira 'feito' (troca)", () => {
    expect(decidirGravacao({ situacao: "NAO_VAI_USAR", clientId: "a" }, { situacao: "FEITO", clientId: "b" })).toBe("trocar");
  });
  it("o feito nunca volta a 'não vou usar'; segundo feito (outro aparelho) não cria outro", () => {
    expect(decidirGravacao({ situacao: "FEITO", clientId: "a" }, { situacao: "NAO_VAI_USAR", clientId: "b" })).toBe("manter");
    expect(decidirGravacao({ situacao: "FEITO", clientId: "a" }, { situacao: "FEITO", clientId: "b" })).toBe("manter");
    expect(decidirGravacao({ situacao: "NAO_VAI_USAR", clientId: "a" }, { situacao: "NAO_VAI_USAR", clientId: "b" })).toBe("manter");
  });
});

describe("horário do toque e o dia aceito", () => {
  const chegada = new Date("2027-01-04T12:00:00Z");
  it("enviado na hora: o toque vale, não é 'sem sinal'", () => {
    expect(horarioDoToque("2027-01-04T11:58:00Z", chegada)).toEqual({ feitoEm: new Date("2027-01-04T11:58:00Z"), offline: false });
  });
  it("chegou bem depois do toque: enviado sem sinal", () => {
    expect(horarioDoToque("2027-01-04T07:10:00Z", chegada)).toEqual({ feitoEm: new Date("2027-01-04T07:10:00Z"), offline: true });
    expect(horarioDoToque("2027-01-04T11:54:59Z", chegada).offline).toBe(true);
    expect(horarioDoToque("2027-01-04T11:55:00Z", chegada).offline).toBe(false);
  });
  it("aparelho adiantado (toque no futuro) ou sem horário: vale a chegada", () => {
    expect(horarioDoToque("2027-01-04T13:00:00Z", chegada)).toEqual({ feitoEm: chegada, offline: false });
    expect(horarioDoToque("2027-01-04T12:04:00Z", chegada).feitoEm).toEqual(new Date("2027-01-04T12:04:00Z"));
    expect(horarioDoToque(null, chegada)).toEqual({ feitoEm: chegada, offline: false });
    expect(horarioDoToque("lixo", chegada)).toEqual({ feitoEm: chegada, offline: false });
  });
  it("dia aceito: até hoje (servidor) e até 30 dias atrás", () => {
    expect(diaAceito(SEG, SEG)).toBe(true);
    expect(diaAceito(somarDias(SEG, 1), SEG)).toBe(false);
    expect(diaAceito(somarDias(SEG, -30), SEG)).toBe(true);
    expect(diaAceito(somarDias(SEG, -31), SEG)).toBe(false);
    expect(diaAceito("04/01/2027", SEG)).toBe(false);
  });
});

describe("histórico do gestor", () => {
  it("situação: feito, com alertas, não vai usar; sem registro = 'Sem registro' (passado) ou 'Ainda não fez' (hoje)", () => {
    expect(situacaoNoHistorico({ situacao: "FEITO" }, SEG, SEG)).toBe("FEITO");
    expect(situacaoNoHistorico({ situacao: "FEITO", comAlertas: true }, SEG, SEG)).toBe("COM_ALERTAS");
    expect(situacaoNoHistorico({ situacao: "NAO_VAI_USAR", comAlertas: true }, SEG, SEG)).toBe("NAO_VAI_USAR");
    expect(situacaoNoHistorico(null, SEG, somarDias(SEG, 1))).toBe("SEM_REGISTRO");
    expect(situacaoNoHistorico(null, SEG, SEG)).toBe("PENDENTE");
  });

  const reg = (tecnicoId: string, nome: string, dia: string, extra: Partial<RegistroHistorico> = {}): RegistroHistorico => ({
    id: `r-${tecnicoId}-${dia}`, tecnicoId, nome, dia, situacao: "FEITO", comAlertas: false, veiculo: "ABC1D23", feitoEm: `${dia}T10:00:00Z`,
    enviadoOffline: false, motivo: null, checklistId: "c", situacaoAnterior: null, trocadoEm: null, ...extra,
  });
  const OBRIGADOS = [{ tecnicoId: "a", nome: "Ana", veiculo: "ABC1D23" }, { tecnicoId: "b", nome: "Bruno", veiculo: "XYZ9K87" }];

  it("registros + 'Sem registro' de quem era obrigado nos dias de checklist; fim de semana fora; dias futuros fora", () => {
    // seg 04 a seg 11; hoje = qua 06 → só até 06 (07+ é futuro); sábado/domingo não exigem
    const linhas = linhasDoHistorico({
      config: LIGADO, obrigados: OBRIGADOS, de: SEG, ate: somarDias(SEG, 7), hoje: somarDias(SEG, 2),
      registros: [reg("a", "Ana", SEG), reg("b", "Bruno", SEG, { situacao: "NAO_VAI_USAR", checklistId: null }), reg("a", "Ana", somarDias(SEG, 2), { comAlertas: true })],
    });
    expect(linhas.map((l) => [l.dia, l.nome, l.situacao])).toEqual([
      ["2027-01-06", "Ana", "COM_ALERTAS"], ["2027-01-06", "Bruno", "PENDENTE"],
      ["2027-01-05", "Ana", "SEM_REGISTRO"], ["2027-01-05", "Bruno", "SEM_REGISTRO"],
      ["2027-01-04", "Ana", "FEITO"], ["2027-01-04", "Bruno", "NAO_VAI_USAR"],
    ]);
  });

  it("registro num dia que não é de checklist (config mudou) também aparece; fora do período, não", () => {
    const linhas = linhasDoHistorico({ config: LIGADO, obrigados: [], de: SAB, ate: DOM, hoje: "2027-01-20", registros: [reg("a", "Ana", SAB), reg("a", "Ana", "2027-01-15")] });
    expect(linhas.map((l) => [l.dia, l.situacao])).toEqual([["2027-01-09", "FEITO"]]);
  });

  it("opção desligada: só o que foi registrado (nada de 'Sem registro')", () => {
    const linhas = linhasDoHistorico({ config: { ...LIGADO, ativo: false }, obrigados: OBRIGADOS, de: SEG, ate: SEG, hoje: "2027-01-20", registros: [] });
    expect(linhas).toEqual([]);
  });
});
