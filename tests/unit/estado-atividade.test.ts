/**
 * "EM DESLOCAMENTO" — o estado visível da atividade (lib/os/estado-atividade), derivado do que o app já
 * grava em atividade_avisos, sem status novo no banco:
 *  - AGENDADA + "A caminho" HOJE (dia de Brasília) e sem "Cheguei" hoje = EM_DESLOCAMENTO;
 *  - "Cheguei" hoje encerra o deslocamento (a atividade volta ao status gravado — logo EM_ANDAMENTO, pelo app);
 *  - status que não é AGENDADA nunca muda; um "A caminho" de ontem (ou de amanhã) não vale hoje;
 *  - o dia é o de Brasília: 02:30Z é ainda a noite anterior.
 *  - rótulo e tom únicos para todo lugar que mostra o estado.
 */
import { describe, expect, it } from "vitest";
import { ROTULO_ESTADO_ATIVIDADE, TOM_ESTADO_ATIVIDADE, estadoVisivelDaAtividade, tocouHoje } from "@/lib/os/estado-atividade";

const AGORA = new Date("2026-11-26T17:00:00Z"); // 26/11 14:00 em Brasília
const aviso = (evento: string, registradoEm: string) => ({ evento, registradoEm });
const HOJE_CEDO = "2026-11-26T11:40:00Z"; // 08:40 BR
const ONTEM = "2026-11-25T20:00:00Z";
const AMANHA = "2026-11-27T12:00:00Z";
const NOITE_DE_ONTEM_EM_UTC_DE_HOJE = "2026-11-26T02:30:00Z"; // 25/11 23:30 em Brasília

describe("estadoVisivelDaAtividade", () => {
  it("AGENDADA com 'A caminho' de hoje e sem 'Cheguei' = EM_DESLOCAMENTO", () => {
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", HOJE_CEDO)] }, AGORA)).toBe("EM_DESLOCAMENTO");
    // o horário do toque pode ser um Date
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [{ evento: "A_CAMINHO", registradoEm: new Date(HOJE_CEDO) }] }, AGORA)).toBe("EM_DESLOCAMENTO");
  });
  it("'Cheguei' de hoje encerra o deslocamento: volta ao status gravado (AGENDADA até o app iniciar)", () => {
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", HOJE_CEDO), aviso("CHEGOU", "2026-11-26T12:30:00Z")] }, AGORA)).toBe("AGENDADA");
    // só o "Cheguei" (sem ter tocado "A caminho"): também não é deslocamento
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("CHEGOU", HOJE_CEDO)] }, AGORA)).toBe("AGENDADA");
  });
  it("status que não é AGENDADA nunca muda, com ou sem toque", () => {
    for (const status of ["EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"]) {
      expect(estadoVisivelDaAtividade({ status, avisosCliente: [aviso("A_CAMINHO", HOJE_CEDO)] }, AGORA)).toBe(status);
      expect(estadoVisivelDaAtividade({ status, avisosCliente: [] }, AGORA)).toBe(status);
    }
  });
  it("sem toque, sem lista ou com toque de OUTRO dia: AGENDADA", () => {
    expect(estadoVisivelDaAtividade({ status: "AGENDADA" }, AGORA)).toBe("AGENDADA");
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: null }, AGORA)).toBe("AGENDADA");
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [] }, AGORA)).toBe("AGENDADA");
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", ONTEM)] }, AGORA)).toBe("AGENDADA");
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", AMANHA)] }, AGORA)).toBe("AGENDADA");
    // um "Cheguei" de ONTEM não apaga o "A caminho" de HOJE
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("CHEGOU", ONTEM), aviso("A_CAMINHO", HOJE_CEDO)] }, AGORA)).toBe("EM_DESLOCAMENTO");
    // evento desconhecido não conta
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("OUTRO", HOJE_CEDO)] }, AGORA)).toBe("AGENDADA");
  });
  it("o dia é o de Brasília: 02:30Z de hoje ainda é a noite de ontem; e o 'hoje' muda com o relógio", () => {
    expect(tocouHoje([aviso("A_CAMINHO", NOITE_DE_ONTEM_EM_UTC_DE_HOJE)], "A_CAMINHO", AGORA)).toBe(false);
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", NOITE_DE_ONTEM_EM_UTC_DE_HOJE)] }, AGORA)).toBe("AGENDADA");
    // o mesmo toque, visto ainda na noite de 25/11 (23:50 BR): é de hoje
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", NOITE_DE_ONTEM_EM_UTC_DE_HOJE)] }, new Date("2026-11-26T02:50:00Z"))).toBe("EM_DESLOCAMENTO");
    // o toque de hoje, visto amanhã: já não vale
    expect(estadoVisivelDaAtividade({ status: "AGENDADA", avisosCliente: [aviso("A_CAMINHO", HOJE_CEDO)] }, new Date("2026-11-27T12:00:00Z"))).toBe("AGENDADA");
  });
  it("tocouHoje olha só o evento pedido", () => {
    expect(tocouHoje([aviso("CHEGOU", HOJE_CEDO)], "A_CAMINHO", AGORA)).toBe(false);
    expect(tocouHoje([aviso("CHEGOU", HOJE_CEDO)], "CHEGOU", AGORA)).toBe(true);
    expect(tocouHoje(undefined, "CHEGOU", AGORA)).toBe(false);
  });
});

describe("vocabulário e tom únicos", () => {
  it("'Em deslocamento' com tom próprio; os quatro status gravados com os rótulos e tons de sempre", () => {
    expect(ROTULO_ESTADO_ATIVIDADE).toEqual({ AGENDADA: "Agendada", EM_DESLOCAMENTO: "Em deslocamento", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" });
    expect(TOM_ESTADO_ATIVIDADE).toEqual({ AGENDADA: "acento", EM_DESLOCAMENTO: "deslocamento", EM_ANDAMENTO: "atencao", CONCLUIDA: "ok", CANCELADA: "atrasado" });
  });
});
