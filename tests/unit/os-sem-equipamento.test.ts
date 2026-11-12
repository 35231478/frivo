/**
 * OS sem equipamento — regras puras da trava de equipamento com as saídas: tipo que não exige,
 * OS recorrente sem equipamento e exceção justificada. A saída só dispensa o "pelo menos 1 atendido":
 * o equipamento que for atendido continua exigindo o checklist completo.
 */
import { describe, expect, it } from "vitest";
import { recalcular } from "@/lib/tecnico/offline/estado";
import {
  MSG_SAIDAS_SEM_EQUIPAMENTO, MSG_SEM_EQUIPAMENTO, textoDispensa, verificarConclusao,
  type DispensaEquipamento, type EquipamentoParaPendencia,
} from "@/lib/execucao/pendencias";

const ITENS = [
  { id: "i1", texto: "Limpeza dos filtros", pedirFoto: false, pedirObservacao: false, ativo: true, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null },
];
const equip = (extra: Partial<EquipamentoParaPendencia> = {}): EquipamentoParaPendencia => ({
  equipamentoId: "eqA", titulo: "Split Sala 1", feito: true, itens: ITENS, respostas: {}, fotosPorItem: {}, formulario: null, ...extra,
});
const OK = { i1: { status: "OK" as const, observacao: null, valor: null, unidade: null, audio: false } };
const TIPO: DispensaEquipamento = { motivo: "TIPO", texto: textoDispensa("TIPO", "Visita Técnica") };

describe("trava de equipamento com saídas", () => {
  it("sem saída: nenhum atendido trava, e a mensagem termina com as saídas", () => {
    const r = verificarConclusao([]);
    expect(r).toMatchObject({ ok: false, semEquipamento: true, dispensa: null });
    expect(r.mensagem).toBe(`${MSG_SEM_EQUIPAMENTO} ${MSG_SAIDAS_SEM_EQUIPAMENTO}`);
    expect(r.mensagem).toContain("tipo de OS que não exige equipamento");
    expect(r.mensagem).toContain("justificando o motivo");
  });

  it("com saída e nenhum atendido: conclui, sem pendência, dizendo por quê", () => {
    for (const dispensa of [TIPO, { motivo: "RECORRENTE" as const, texto: "x" }, { motivo: "JUSTIFICADA" as const, texto: "y" }]) {
      const r = verificarConclusao([], dispensa);
      expect(r).toEqual({ ok: true, semEquipamento: false, dispensa, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null });
    }
    // vinculado e não atendido também passa (sai como "não atendido")
    expect(verificarConclusao([equip({ feito: false })], TIPO)).toMatchObject({ ok: true, naoAtendidos: 1, dispensa: TIPO });
  });

  it("a saída NÃO afrouxa o checklist: atendido incompleto trava; completo conclui (e não marca dispensa)", () => {
    const incompleto = verificarConclusao([equip()], TIPO);
    expect(incompleto).toMatchObject({ ok: false, semEquipamento: false, dispensa: null });
    expect(incompleto.mensagem).toMatch(/Split Sala 1 — 1 item sem resposta/);
    expect(verificarConclusao([equip({ respostas: OK })], TIPO)).toMatchObject({ ok: true, dispensa: null, atendidos: 1 });
  });

  it("textos das saídas", () => {
    expect(textoDispensa("TIPO", "Vistoria")).toBe("O tipo de OS “Vistoria” não exige equipamento: pode concluir sem equipamento atendido.");
    expect(textoDispensa("TIPO")).toBe("O tipo de OS não exige equipamento: pode concluir sem equipamento atendido.");
    expect(textoDispensa("RECORRENTE")).toBe("OS recorrente do contrato sem equipamento vinculado: pode concluir sem equipamento atendido.");
    expect(textoDispensa("JUSTIFICADA", "Só avaliação")).toBe("Conclusão sem equipamento autorizada: “Só avaliação”.");
  });
});

describe("app do técnico (offline): recalcula a conclusão com a saída que veio do servidor", () => {
  const tela = (dispensaEquipamento?: DispensaEquipamento | null) => ({
    atividade: { id: "a1", titulo: "Visita", status: "EM_ANDAMENTO", tipoOs: null },
    os: { id: "os1", numero: "OS-1", status: "EM_ANDAMENTO", clienteId: "c1", unidadeId: null },
    bloqueada: false, equipamentos: [], adicionais: [],
    conclusao: verificarConclusao([]), ...(dispensaEquipamento !== undefined && { dispensaEquipamento }),
  });
  it("com dispensa: pronto para concluir sem equipamento; sem (ou retrato antigo sem o campo): trava", () => {
    expect(recalcular(tela(TIPO) as any).conclusao).toMatchObject({ ok: true, dispensa: TIPO });
    expect(recalcular(tela(null) as any).conclusao).toMatchObject({ ok: false, semEquipamento: true });
    expect(recalcular(tela() as any).conclusao).toMatchObject({ ok: false, semEquipamento: true });
  });
});
