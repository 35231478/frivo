/**
 * CHAT-1.1 — a FOTO do chat VINCULADA ao equipamento: as regras PURAS (servidor, aparelho e testes).
 *  - as 4 regras, NESTA ordem: a OS tem um só; a atividade em andamento; o QR code (mesmo cliente); a escolha;
 *  - a escolha explícita de quem envia vale acima das automáticas; "Sem equipamento" também é escolha;
 *  - QR de outro cliente: sugere, não vincula; foto do escritório: só as regras 1 e 4; sem OS: nada;
 *  - a trilha da correção (de → para); a fila do app mostra a escolha e a correção na hora.
 */
import { describe, expect, it } from "vitest";
import { equipamentoEmAndamento, trilhaDaCorrecao, vinculoDaFoto, ROTULO_SEM_EQUIPAMENTO } from "@/lib/chat/equipamento-foto";
import { comentarioSchema, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { aplicarCorrecoesDaFila, mensagensDaFila } from "@/lib/tecnico/chat";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const app = (o: Partial<Parameters<typeof vinculoDaFoto>[0]> = {}) => vinculoDaFoto({ origem: "APP", temOs: true, equipamentosDaOs: ["eA", "eB"], ...o });

describe("as 4 regras, nesta ordem", () => {
  it("1. a OS tem UM equipamento: ele (mesmo com atividade em andamento ou QR apontando outro)", () => {
    expect(app({ equipamentosDaOs: ["eA"] })).toEqual({ equipamentoId: "eA", origem: "UNICO", sugeridoId: null, precisaEscolher: false });
    expect(app({ equipamentosDaOs: ["eA"], emAndamento: "eA", qr: { equipamentoId: "eZ", mesmoCliente: true } }).origem).toBe("UNICO");
  });

  it("2. a atividade em andamento do técnico ligada a um equipamento da OS: ele (antes do QR)", () => {
    expect(app({ emAndamento: "eB" })).toMatchObject({ equipamentoId: "eB", origem: "ANDAMENTO" });
    expect(app({ emAndamento: "eB", qr: { equipamentoId: "eA", mesmoCliente: true } })).toMatchObject({ equipamentoId: "eB", origem: "ANDAMENTO" });
    // em andamento num equipamento que não é da OS: não vale
    expect(app({ emAndamento: "eZ" }).equipamentoId).toBeNull();
  });

  it("3. o QR code na foto: do mesmo cliente vincula (mesmo se ainda não está na OS); de outro, só sugere", () => {
    expect(app({ qr: { equipamentoId: "eA", mesmoCliente: true } })).toMatchObject({ equipamentoId: "eA", origem: "QR", sugeridoId: null });
    expect(app({ qr: { equipamentoId: "eN", mesmoCliente: true } })).toMatchObject({ equipamentoId: "eN", origem: "QR" });
    expect(app({ qr: { equipamentoId: "eC", mesmoCliente: false } })).toEqual({ equipamentoId: null, origem: null, sugeridoId: "eC", precisaEscolher: true });
    // a sugestão acompanha mesmo quando outra regra vincula
    expect(app({ equipamentosDaOs: ["eA"], qr: { equipamentoId: "eC", mesmoCliente: false } })).toMatchObject({ equipamentoId: "eA", sugeridoId: "eC" });
  });

  it("4. vários e nada indica: sem vínculo, a escolha fica com a pessoa; a OS sem equipamento nem pede", () => {
    expect(app()).toEqual({ equipamentoId: null, origem: null, sugeridoId: null, precisaEscolher: true });
    expect(app({ equipamentosDaOs: [] })).toEqual({ equipamentoId: null, origem: null, sugeridoId: null, precisaEscolher: false });
  });

  it("a escolha explícita vale acima das automáticas; \"Sem equipamento\" também; equipamento de fora não vale", () => {
    expect(app({ escolha: "eA", emAndamento: "eB" })).toMatchObject({ equipamentoId: "eA", origem: "ESCOLHA" });
    expect(app({ equipamentosDaOs: ["eA"], escolha: null })).toEqual({ equipamentoId: null, origem: null, sugeridoId: null, precisaEscolher: false });
    expect(app({ escolha: "eZ" })).toMatchObject({ equipamentoId: null, precisaEscolher: true });
    expect(app({ escolha: "eN", qr: { equipamentoId: "eN", mesmoCliente: true } })).toMatchObject({ equipamentoId: "eN", origem: "ESCOLHA" });
  });

  it("foto do escritório: só as regras 1 e 4 (nem atividade em andamento, nem QR); sem OS: nada", () => {
    const esc = (o: Partial<Parameters<typeof vinculoDaFoto>[0]> = {}) => vinculoDaFoto({ origem: "ESCRITORIO", temOs: true, equipamentosDaOs: ["eA", "eB"], ...o });
    expect(esc({ equipamentosDaOs: ["eA"] }).origem).toBe("UNICO");
    expect(esc({ emAndamento: "eB", qr: { equipamentoId: "eA", mesmoCliente: true } })).toEqual({ equipamentoId: null, origem: null, sugeridoId: null, precisaEscolher: true });
    expect(esc({ escolha: "eB" }).origem).toBe("ESCOLHA");
    expect(vinculoDaFoto({ origem: "APP", temOs: false, equipamentosDaOs: ["eA"], escolha: "eA" }).equipamentoId).toBeNull();
  });

  it("a atividade em andamento: um equipamento só; entre vários, o único ainda não atendido", () => {
    expect(equipamentoEmAndamento([{ equipamentoId: "eA", feito: true }])).toBe("eA");
    expect(equipamentoEmAndamento([{ equipamentoId: "eA", feito: true }, { equipamentoId: "eB", feito: false }])).toBe("eB");
    expect(equipamentoEmAndamento([{ equipamentoId: "eA", feito: false }, { equipamentoId: "eB", feito: false }])).toBeNull();
    expect(equipamentoEmAndamento([])).toBeNull();
  });
});

describe("a correção e a fila", () => {
  it("a trilha: vincular, corrigir e remover (de → para); o mesmo de novo não registra nada", () => {
    const A = { id: "eA", nome: "Split sala 3" }, B = { id: "eB", nome: "Split sala 4" };
    expect(trilhaDaCorrecao(null, A)).toEqual({ acao: "Foto do chat vinculada ao equipamento", detalhes: `${ROTULO_SEM_EQUIPAMENTO} → Split sala 3` });
    expect(trilhaDaCorrecao(A, B)).toEqual({ acao: "Equipamento da foto do chat corrigido", detalhes: "Split sala 3 → Split sala 4" });
    expect(trilhaDaCorrecao(B, null)).toEqual({ acao: "Vínculo da foto do chat removido", detalhes: `Split sala 4 → ${ROTULO_SEM_EQUIPAMENTO}` });
    expect(trilhaDaCorrecao(A, { id: "eA", nome: "outro nome" })).toBeNull();
    expect(trilhaDaCorrecao(null, null)).toBeNull();
  });

  it("o envio: equipamento e QR só com foto", () => {
    const foto = { foto: "data:image/jpeg;base64,AA==", miniatura: "data:image/jpeg;base64,AA==" };
    expect(comentarioSchema.safeParse({ clientId: "c", texto: "", ...foto, equipamentoId: "eA", qr: "https://x/qr/t" }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c", texto: "", ...foto, equipamentoId: null }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c", texto: "Oi", equipamentoId: "eA" }).success).toBe(false);
    expect(comentarioSchema.safeParse({ clientId: "c", texto: "Oi", qr: "x" }).success).toBe(false);
  });

  const EQUIP = { os1: { equipamentos: [{ id: "eA", titulo: "Split sala 3" }, { id: "eB", titulo: "Split sala 4" }], emAndamento: null } };
  const op = (o: Partial<OperacaoFila> & { tipo: string; dados: unknown }) => ({ id: "o", atividadeId: "a1", criadoEm: "2026-11-12T12:00:00.000Z", estado: "pendente", tentativas: 0, ...o }) as unknown as OperacaoFila;

  it("na fila: a foto mostra o equipamento escolhido já; o automático vem quando o servidor confirmar", () => {
    const atividades = new Map([["a1", { id: "os1", numero: "OS-1", cliente: "" }]]);
    const foto = { foto: "data:image/jpeg;base64,AA==", miniatura: "data:image/jpeg;base64,MI==" };
    const [escolhida, auto] = mensagensDaFila([op({ tipo: "comentario", dados: { clientId: "c1", texto: "", ...foto, equipamentoId: "eB" } }),
      op({ tipo: "comentario", dados: { clientId: "c2", texto: "", ...foto } })], atividades, "João", EQUIP);
    expect(escolhida.foto).toMatchObject({ equipamento: { id: "eB", titulo: "Split sala 4" }, origemEquipamento: "ESCOLHA" });
    expect(auto.foto).toMatchObject({ equipamento: null });
  });

  it("a correção na fila vale na tela (a última de cada foto); a recusada não", () => {
    const m = (id: string): ComentarioTela => ({ id, clientId: `c-${id}`, texto: "", autor: "João", origem: "APP", criadoEm: "2026-11-12T12:00:00.000Z", meu: true,
      os: { id: "os1", numero: "OS-1", cliente: "" }, foto: { id: `f-${id}`, miniatura: "x", equipamento: { id: "eA", titulo: "Split sala 3" }, origemEquipamento: "UNICO" } });
    const fila = [
      op({ tipo: "fotoChatEquipamento", dados: { comentario: { id: "m1" }, equipamentoId: "eA" } }),
      op({ tipo: "fotoChatEquipamento", dados: { comentario: { id: "m1" }, equipamentoId: "eB" } }),
      op({ tipo: "fotoChatEquipamento", dados: { comentario: { clientId: "c-m2" }, equipamentoId: null } }),
      op({ tipo: "fotoChatEquipamento", estado: "erro", dados: { comentario: { id: "m3" }, equipamentoId: "eB" } }),
    ];
    const [a, b, c] = aplicarCorrecoesDaFila([m("m1"), m("m2"), m("m3")], fila, EQUIP);
    expect(a.foto).toMatchObject({ equipamento: { id: "eB" }, origemEquipamento: "CORRIGIDO" });
    expect(b.foto).toMatchObject({ equipamento: null, origemEquipamento: "CORRIGIDO" });
    expect(c.foto).toMatchObject({ equipamento: { id: "eA" }, origemEquipamento: "UNICO" });
  });
});
