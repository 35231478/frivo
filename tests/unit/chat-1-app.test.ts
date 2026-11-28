/**
 * CHAT-1 no app do técnico — as regras PURAS da tela Chat (lib/tecnico/chat):
 *  - a mensagem que ainda está na fila do aparelho vira balão (pendente; recusada = "Não enviada" com o motivo), só a
 *    das atividades desta conversa e só as do tipo "comentario";
 *  - quando recarregar a conversa para o ✓ aparecer (confirmada na fila, ou saiu dela sem a conversa ter);
 *  - o contador da barra, as conversas guardadas no aparelho (limite), a resposta válida e o cliente escondido.
 */
import { describe, expect, it } from "vitest";
import {
  chaveConversa, confirmadasForaDaConversa, conversaValida, dicaNaoLidas, lembrarConversa, listaValida, mensagensDaFila, mensagensSumidas,
  rotuloNaoLidas, semCliente, urlConversaApi, urlFotoApp,
} from "@/lib/tecnico/chat";
import { juntarComFila, estadoDaMensagem, type ConversaResumo } from "@/lib/chat/regras";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const op = (seq: number, atividadeId: string, clientId: string, extra: Partial<OperacaoFila> = {}, dados: Record<string, unknown> = {}): OperacaoFila => ({
  seq, id: `op${seq}`, em: "2026-11-12T15:00:00.000Z", criadoEm: `2026-11-12T15:0${seq}:00.000Z`, estado: "pendente", tentativas: 0,
  tipo: "comentario", atividadeId, dados: { clientId, texto: ` Msg ${seq} `, ...dados }, ...extra,
} as OperacaoFila);
const srv = (clientId: string | null, id = `s-${clientId}`): ComentarioTela => ({ id, clientId, texto: "x", autor: "João", origem: "APP", criadoEm: "2026-11-12T14:00:00.000Z", meu: true });

describe("mensagensDaFila", () => {
  const fila = [
    op(1, "aA", "k1"),
    op(2, "aB", "k2"),
    op(3, "aX", "k3"), // outra OS
    { ...op(4, "aA", "k4"), tipo: "iniciar", dados: undefined } as unknown as OperacaoFila, // não é mensagem
    op(5, "aA", "k5", { estado: "erro", erro: "OS bloqueada para mensagens." }),
    op(6, "aA", "k6", { estado: "erro", erro: null }),
    op(7, "aB", "k7", {}, { foto: "data:image/jpeg;base64,AAA", miniatura: "data:image/jpeg;base64,MIN" }),
  ];
  const m = mensagensDaFila(fila, ["aA", "aB"], "João");
  it("só as do tipo comentario das atividades desta conversa, na ordem da fila", () => {
    expect(m.map((x) => x.clientId)).toEqual(["k1", "k2", "k5", "k6", "k7"]);
  });
  it("pendente = Enviando…; recusada = Não enviada com o motivo (sem motivo: o padrão)", () => {
    expect(m[0]).toMatchObject({ id: null, texto: "Msg 1", autor: "João", origem: "APP", meu: true, pendente: true, falhou: null, criadoEm: "2026-11-12T15:01:00.000Z" });
    expect(estadoDaMensagem(m[0])).toBe("enviando");
    expect(m[2]).toMatchObject({ falhou: "OS bloqueada para mensagens.", pendente: false });
    expect(estadoDaMensagem(m[2])).toBe("falhou");
    expect(m[3].falhou).toBe("Recusada pelo servidor.");
  });
  it("a foto vai no balão pela miniatura (a inteira ainda não tem id)", () => {
    expect(m[4].foto).toEqual({ id: null, miniatura: "data:image/jpeg;base64,MIN" });
    expect(m[0].foto).toBeUndefined();
  });
  it("com juntarComFila: a que o servidor já tem (mesmo clientId) não aparece duas vezes", () => {
    const junto = juntarComFila([srv("k1")], m);
    expect(junto.map((x) => x.clientId)).toEqual(["k1", "k2", "k5", "k6", "k7"]);
    expect(junto[0].id).toBe("s-k1");
  });
});

describe("quando recarregar a conversa (o ✓ depois do envio)", () => {
  it("confirmada pelo servidor (enviada) e a conversa ainda não tem: recarregar", () => {
    const fila = [op(1, "aA", "k1", { estado: "enviada" }), op(2, "aA", "k2", { estado: "enviada" }), op(3, "aA", "k3"), op(4, "aZ", "k4", { estado: "enviada" })];
    expect(confirmadasForaDaConversa(fila, ["aA"], [srv("k2")])).toEqual(["k1"]);
  });
  it("saiu da fila sem a conversa ter (confirmada, ou recusada que foi reenviada/descartada): recarregar", () => {
    const antes = mensagensDaFila([op(1, "aA", "k1"), op(2, "aA", "k2"), op(3, "aA", "k3", { estado: "erro", erro: "x" }), op(4, "aA", "k4")], ["aA"], "João");
    const agora = mensagensDaFila([op(4, "aA", "k4")], ["aA"], "João");
    const saiu = mensagensSumidas(antes, agora, [srv("k2")]);
    expect(saiu.map((x) => x.clientId)).toEqual(["k1", "k3"]);
    // a tela segura como "Enviando…" só a que estava enviando (a recusada pode ter sido descartada)
    expect(saiu.filter((m) => !m.falhou).map((x) => x.clientId)).toEqual(["k1"]);
  });
});

describe("contador, guardadas, resposta e cliente", () => {
  it("contador da barra: nada com zero; até 99; depois 99+", () => {
    expect([rotuloNaoLidas(0), rotuloNaoLidas(-1), rotuloNaoLidas(1), rotuloNaoLidas(99), rotuloNaoLidas(100)]).toEqual(["", "", "1", "99", "99+"]);
    expect([dicaNaoLidas(1), dicaNaoLidas(3)]).toEqual(["1 mensagem não lida", "3 mensagens não lidas"]);
  });
  it("conversas guardadas no aparelho: a aberta vai para a frente; as que passam do limite saem", () => {
    expect(lembrarConversa(null, "a")).toEqual({ lista: ["a"], sair: [] });
    expect(lembrarConversa(["b", "a", "c"], "a")).toEqual({ lista: ["a", "b", "c"], sair: [] });
    expect(lembrarConversa(["b", "c", "d"], "a", 3)).toEqual({ lista: ["a", "b", "c"], sair: ["d"] });
  });
  it("só vale a resposta do chat (outra coisa guardada ou erro: não)", () => {
    expect(listaValida({ conversas: [], naoLidas: 0 })).toBe(true);
    expect(listaValida({ tecnico: null, atividades: [] })).toBe(false);
    expect(listaValida(null)).toBe(false);
    expect(conversaValida({ conversa: { osId: "x" }, mensagens: [] })).toBe(true);
    expect(conversaValida({ erro: "Conversa não encontrada." })).toBe(false);
  });
  it("sem 'Exibir dados do cliente', o nome do cliente some (e não entra na busca)", () => {
    const c = { osId: "o", osNumero: "OS-1", cliente: "Hospital", status: "ABERTA", tecnicos: [], ultima: null, naoLidas: 0 } as ConversaResumo;
    expect(semCliente(c, true).cliente).toBe("Hospital");
    expect(semCliente(c, false).cliente).toBe("");
  });
  it("endereços e chaves", () => {
    expect(urlConversaApi("os 1")).toBe("/api/tecnico/conversas/os%201");
    expect(urlFotoApp("f1")).toBe("/api/tecnico/conversas/fotos/f1");
    expect(chaveConversa("osA")).toBe("conversa:osA");
  });
});
