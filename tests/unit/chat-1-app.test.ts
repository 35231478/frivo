/**
 * CHAT-1 no app do técnico (a conversa "Escritório", por pessoa) — as regras PURAS da tela Chat (lib/tecnico/chat) e o
 * motor da fila com a mensagem SEM OS:
 *  - a mensagem que ainda está na fila do aparelho vira balão (pendente; recusada = "Não enviada" com o motivo), de
 *    qualquer atividade (e sem OS), com a etiqueta da OS certa (a atividade → a OS pelas OS do dia e pelos retratos);
 *  - quando recarregar a conversa para o ✓ aparecer (confirmada na fila, ou saiu dela sem a conversa ter);
 *  - o seletor: começa na OS padrão (só OS do dia), fica na escolha; por qual atividade a mensagem sobe (SEM_OS);
 *  - o tempo real: recarrega quando chega mensagem ou alguém lê, NÃO pela leitura do próprio técnico (sem laço);
 *  - o motor: a mensagem sem OS sobe, sai da fila sem baixar retrato nem "Minhas despesas"; a despesa sem OS segue igual.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  atividadeDaOs, atividadeDoEnvio, CHAVE_CONVERSA, confirmadasForaDaConversa, conversaValida, dicaNaoLidas, mapaDeAtividades, mensagensDaFila,
  mensagensSumidas, osDoSeletor, precisaRecarregar, rotuloNaoLidas, semCliente, URL_CONVERSA_APP, urlFotoApp, type RespostaConversa,
} from "@/lib/tecnico/chat";
import { juntarComFila, estadoDaMensagem, type OsDoDia } from "@/lib/chat/regras";
import { SEM_OS } from "@/lib/tecnico/despesas";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const op = (seq: number, atividadeId: string, clientId: string, extra: Partial<OperacaoFila> = {}, dados: Record<string, unknown> = {}): OperacaoFila => ({
  seq, id: `op${seq}`, em: "2026-11-12T15:00:00.000Z", criadoEm: `2026-11-12T15:0${seq}:00.000Z`, estado: "pendente", tentativas: 0,
  tipo: "comentario", atividadeId, dados: { clientId, texto: ` Msg ${seq} `, ...dados }, ...extra,
} as OperacaoFila);
const srv = (clientId: string | null, id = `s-${clientId}`): ComentarioTela => ({ id, clientId, texto: "x", autor: "João", origem: "APP", criadoEm: "2026-11-12T14:00:00.000Z", meu: true });
const DIA: OsDoDia[] = [
  { osId: "osA", numero: "OS-1", cliente: "Hospital Central", emAndamento: true, atividadeId: "aA" },
  { osId: "osB", numero: "OS-2", cliente: "Mercado Bom Preço", emAndamento: false, atividadeId: "aB" },
];
const ATIVIDADES = mapaDeAtividades(DIA, [{ atividadeId: "aVelha", osId: "osV", osNumero: "OS-9", cliente: "Escola" }, { atividadeId: "aA", osId: "osX", osNumero: "errado", cliente: "" }]);

describe("de que OS é cada atividade", () => {
  it("as OS do dia valem sobre o retrato guardado; o retrato cobre a OS de outro dia", () => {
    expect(ATIVIDADES.get("aA")).toEqual({ id: "osA", numero: "OS-1", cliente: "Hospital Central" });
    expect(ATIVIDADES.get("aVelha")).toEqual({ id: "osV", numero: "OS-9", cliente: "Escola" });
    expect(ATIVIDADES.has(SEM_OS)).toBe(false);
  });
  it("abrir a OS pela etiqueta: a atividade do dia; senão a guardada; senão nenhuma (sem link)", () => {
    expect(atividadeDaOs("osB", DIA, ATIVIDADES)).toBe("aB");
    expect(atividadeDaOs("osV", DIA, ATIVIDADES)).toBe("aVelha");
    expect(atividadeDaOs("osZ", DIA, ATIVIDADES)).toBeNull();
    expect(atividadeDaOs("osA", DIA)).toBe("aA");
  });
});

describe("mensagensDaFila", () => {
  const fila = [
    op(1, "aA", "k1"),
    op(2, SEM_OS, "k2"),
    op(3, "aVelha", "k3"), // escrita dentro de uma OS de outro dia
    { ...op(4, "aA", "k4"), tipo: "iniciar", dados: undefined } as unknown as OperacaoFila, // não é mensagem
    { ...op(5, SEM_OS, "k5"), tipo: "despesa" } as unknown as OperacaoFila, // despesa sem OS não é mensagem
    op(6, "aB", "k6", { estado: "erro", erro: "OS bloqueada para mensagens." }),
    op(7, "aA", "k7", { estado: "erro", erro: null }),
    op(8, "aB", "k8", {}, { foto: "data:image/jpeg;base64,AAA", miniatura: "data:image/jpeg;base64,MIN" }),
  ];
  const m = mensagensDaFila(fila, ATIVIDADES, "João");
  it("toda mensagem da fila (qualquer atividade e sem OS), só as do tipo comentario, na ordem da fila", () => {
    expect(m.map((x) => x.clientId)).toEqual(["k1", "k2", "k3", "k6", "k7", "k8"]);
  });
  it("a etiqueta da OS pela atividade; SEM_OS = sem OS", () => {
    expect(m.map((x) => x.os?.numero ?? null)).toEqual(["OS-1", null, "OS-9", "OS-2", "OS-1", "OS-2"]);
    expect(m[0].os).toEqual({ id: "osA", numero: "OS-1", cliente: "Hospital Central" });
    expect(m[1].os).toBeNull();
  });
  it("pendente = Enviando…; recusada = Não enviada com o motivo (sem motivo: o padrão)", () => {
    expect(m[0]).toMatchObject({ id: null, texto: "Msg 1", autor: "João", origem: "APP", meu: true, pendente: true, falhou: null, criadoEm: "2026-11-12T15:01:00.000Z" });
    expect(estadoDaMensagem(m[0])).toBe("enviando");
    expect(m[3]).toMatchObject({ falhou: "OS bloqueada para mensagens.", pendente: false });
    expect(estadoDaMensagem(m[3])).toBe("falhou");
    expect(m[4].falhou).toBe("Recusada pelo servidor.");
  });
  it("a foto vai no balão pela miniatura (a inteira ainda não tem id)", () => {
    expect(m[5].foto).toEqual({ id: null, miniatura: "data:image/jpeg;base64,MIN", equipamento: null, origemEquipamento: null });
    expect(m[0].foto).toBeUndefined();
  });
  it("com juntarComFila: a que o servidor já tem (mesmo clientId) não aparece duas vezes", () => {
    const junto = juntarComFila([srv("k1")], m);
    expect(junto.map((x) => x.clientId)).toEqual(["k1", "k2", "k3", "k6", "k7", "k8"]);
    expect(junto[0].id).toBe("s-k1");
  });
});

describe("quando recarregar a conversa", () => {
  it("confirmada pelo servidor (enviada) e a conversa ainda não tem: recarregar (com ou sem OS)", () => {
    const fila = [op(1, "aA", "k1", { estado: "enviada" }), op(2, "aA", "k2", { estado: "enviada" }), op(3, "aA", "k3"), op(4, SEM_OS, "k4", { estado: "enviada" })];
    expect(confirmadasForaDaConversa(fila, [srv("k2")])).toEqual(["k1", "k4"]);
  });
  it("saiu da fila sem a conversa ter (confirmada, ou recusada que foi reenviada/descartada): recarregar", () => {
    const antes = mensagensDaFila([op(1, "aA", "k1"), op(2, SEM_OS, "k2"), op(3, "aA", "k3", { estado: "erro", erro: "x" }), op(4, "aA", "k4")], ATIVIDADES, "João");
    const agora = mensagensDaFila([op(4, "aA", "k4")], ATIVIDADES, "João");
    const saiu = mensagensSumidas(antes, agora, [srv("k2")]);
    expect(saiu.map((x) => x.clientId)).toEqual(["k1", "k3"]);
    // a tela segura como "Enviando…" só a que estava enviando (a recusada pode ter sido descartada)
    expect(saiu.filter((x) => !x.falhou).map((x) => x.clientId)).toEqual(["k1"]);
  });
  it("tempo real: mensagem nova (1ª parte) ou 1ª leitura (2ª parte) recarrega; a leitura do próprio técnico (3ª) não", () => {
    expect(precisaRecarregar(null, "5.0.1")).toBe(false); // a 1ª resposta: acabou de carregar
    expect(precisaRecarregar("5.0.1", "5.0.1")).toBe(false);
    expect(precisaRecarregar("5.0.1", "6.0.1")).toBe(true);
    expect(precisaRecarregar("5.0.1", "5.7.1")).toBe(true);
    expect(precisaRecarregar("5.0.1", "5.0.9")).toBe(false); // a recarga marcou como lida: sem laço
    expect(precisaRecarregar("1.0", "2.0")).toBe(true);
    expect(precisaRecarregar("lixo", "2.0")).toBe(true);
  });
});

describe("o seletor de OS e o envio", () => {
  it("começa na OS padrão do servidor; a escolha do técnico vale depois (inclusive Sem OS)", () => {
    expect(osDoSeletor(undefined, "osB", DIA)).toBe("osB");
    expect(osDoSeletor(undefined, null, DIA)).toBeNull();
    expect(osDoSeletor("osA", "osB", DIA)).toBe("osA");
    expect(osDoSeletor(null, "osB", DIA)).toBeNull();
  });
  it("só OS do dia (é por ela que a mensagem sobe): padrão ou escolha fora delas = Sem OS", () => {
    expect(osDoSeletor(undefined, "osV", DIA)).toBeNull();
    expect(osDoSeletor("osZ", "osA", DIA)).toBeNull();
    expect(osDoSeletor("osA", null, [{ ...DIA[0], atividadeId: null }])).toBeNull();
  });
  it("sobe pela atividade da OS escolhida; Sem OS = SEM_OS", () => {
    expect(atividadeDoEnvio("osB", DIA)).toBe("aB");
    expect(atividadeDoEnvio(null, DIA)).toBe(SEM_OS);
    expect(atividadeDoEnvio("osZ", DIA)).toBe(SEM_OS);
  });
});

describe("contador, resposta e cliente", () => {
  it("contador da barra: nada com zero; até 99; depois 99+", () => {
    expect([rotuloNaoLidas(0), rotuloNaoLidas(-1), rotuloNaoLidas(1), rotuloNaoLidas(99), rotuloNaoLidas(100)]).toEqual(["", "", "1", "99", "99+"]);
    expect([dicaNaoLidas(1), dicaNaoLidas(3)]).toEqual(["1 mensagem não lida", "3 mensagens não lidas"]);
  });
  it("só vale a resposta da conversa (a lista do desenho antigo guardada com a mesma chave, ou erro: não)", () => {
    expect(conversaValida({ mensagens: [], osDoDia: [], osPadrao: null })).toBe(true);
    expect(conversaValida({ conversas: [], naoLidas: 0 })).toBe(false);
    expect(conversaValida({ erro: "Sem técnico." })).toBe(false);
    expect(conversaValida(null)).toBe(false);
  });
  it("sem 'Exibir dados do cliente', o nome do cliente some das etiquetas e do seletor", () => {
    const r: RespostaConversa = { mensagens: [{ ...srv("k1"), os: { id: "osA", numero: "OS-1", cliente: "Hospital" } }, srv("k2")], osDoDia: DIA, osPadrao: "osA" };
    expect(semCliente(r, true)).toBe(r);
    const s = semCliente(r, false);
    expect(s.mensagens.map((m) => m.os?.cliente ?? null)).toEqual(["", null]);
    expect(s.osDoDia.map((o) => o.cliente)).toEqual(["", ""]);
    expect(s.osPadrao).toBe("osA");
  });
  it("endereços e chave", () => {
    expect(URL_CONVERSA_APP).toBe("/api/tecnico/conversas");
    expect(urlFotoApp("f 1")).toBe("/api/tecnico/conversas/fotos/f%201");
    expect(CHAVE_CONVERSA).toBe("conversas");
  });
});

describe("o motor com a mensagem SEM OS", () => {
  async function montar() {
    (globalThis as any).indexedDB = new IDBFactory();
    const banco = await BancoTecnico.abrir("uT");
    const pedidos: string[] = [];
    const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
    const fetchFalso = async (url: string, init?: RequestInit) => {
      pedidos.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/tecnico/sync") {
        const { operacoes } = JSON.parse(String(init!.body));
        return json({ resultados: operacoes.map((o: { id: string }) => ({ id: o.id, ok: true, status: 201 })) });
      }
      if (url === "/api/tecnico/despesas") return json({ despesas: [] });
      return json({ erro: "não existe" }, 404);
    };
    const motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => true });
    return { banco, motor, pedidos };
  }

  it("sobe com atividadeId SEM_OS, sai da fila sem baixar retrato de atividade inexistente nem 'Minhas despesas'", async () => {
    const { banco, motor, pedidos } = await montar();
    await motor.registrar([{ tipo: "comentario", atividadeId: SEM_OS, dados: { clientId: "k1", texto: "Sem OS aqui." } }]);
    await motor.aguardar();
    expect(pedidos).toEqual(["POST /api/tecnico/sync"]);
    expect(await banco.fila()).toEqual([]);
    expect(motor.atual).toMatchObject({ pendentes: 0, erros: 0, situacao: "sincronizado" });
    banco.fechar();
  });

  it("a despesa sem OS segue igual (baixa 'Minhas despesas' e sai da fila), junto com uma mensagem sem OS", async () => {
    const { banco, motor, pedidos } = await montar();
    await banco.enfileirar({ id: "00000000-0000-4000-8000-000000000001", tipo: "despesa", atividadeId: SEM_OS, dados: { clientId: "d1" }, em: "x", criadoEm: "x", estado: "pendente", tentativas: 0 } as unknown as OperacaoFila);
    await motor.registrar([{ tipo: "comentario", atividadeId: SEM_OS, dados: { clientId: "k1", texto: "E a mensagem." } }]);
    await motor.aguardar();
    expect(pedidos.filter((p) => p !== "POST /api/tecnico/sync")).toEqual(["GET /api/tecnico/despesas"]);
    expect(pedidos.some((p) => p.includes("/atividades/"))).toBe(false);
    expect(await banco.fila()).toEqual([]);
    banco.fechar();
  });
});
