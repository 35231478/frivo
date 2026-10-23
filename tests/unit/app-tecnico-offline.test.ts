/**
 * App do técnico — OFFLINE de verdade no aparelho: IndexedDB (fake-indexeddb, a mesma API do
 * navegador), a fila de gravações e o motor de sincronização contra um "servidor" de mentira que
 * responde como o real. Prova:
 *  - sem sinal: tudo grava no aparelho, a tela já mostra (inclusive o que falta para concluir) e
 *    nada se perde; nada é enviado;
 *  - volta o sinal: sobe em ordem, em lotes, e a operação só sai da fila depois do retrato novo;
 *  - resposta perdida (rede caiu no meio): reenvia com o MESMO id (o servidor não duplica);
 *  - recusa do servidor fica guardada com o motivo e SEGURA as seguintes da mesma atividade;
 *    "tentar de novo" e "descartar" (só a recusada);
 *  - sessão expirada não perde nada; dois usuários no mesmo aparelho não se misturam.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, beforeEach } from "vitest";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync, emLotes, LIMITE_LOTE_BYTES, novoId } from "@/lib/tecnico/offline/motor";
import { aplicar, equipamentoDoQr, estadoDaAtividade, proximoEquipamento } from "@/lib/tecnico/offline/estado";
import type { NovaOperacao, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const item = (id: string, texto: string, extra: Record<string, unknown> = {}) =>
  ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null, ...extra });
const ITENS = [item("i1", "Limpeza dos filtros", { pedirFoto: true }), item("i2", "Dreno e bandeja"), item("m1", "Pressão de sucção", { tipoResposta: "MEDICAO", unidade: "psi" })];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = (id: string, titulo: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin FTXS", tag: null, numeroSerie: null, local: null, unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } });

function retrato(atividadeId = "aA", status = "AGENDADA"): RetratoAtividade {
  return {
    cartao: { atividadeId, osId: "osA", osNumero: "OS-0001" } as any,
    execucao: {
      atividade: { id: atividadeId, titulo: "Preventiva", status, tipoOs: null },
      os: { id: "osA", numero: "OS-0001", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false,
      equipamentos: [
        { vinculoId: "v1", feito: false, observacao: null, equipamento: info("eqA", "Split Sala 1"), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false },
        { vinculoId: "v2", feito: false, observacao: null, equipamento: info("eqB", "Split Sala 2"), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false },
      ],
      adicionais: [],
      conclusao: { ok: false, semEquipamento: true, dispensa: null, pendencias: [], atendidos: 0, naoAtendidos: 2, mensagem: null },
    },
    equipamentosUnidade: [
      { ...info("eqA", "Split Sala 1"), tipoEquipamentoId: "te1", qr: null },
      { ...info("eqN", "Split Sala 3"), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-eqN", codigo: "QR-2026-0003" } },
    ],
    checklistsPorTipo: { te1: ITENS },
    geradoEm: new Date().toISOString(),
  };
}
const FOTO = "data:image/jpeg;base64,/9j/AAAA";

/** "Servidor" de mentira: aplica como o real (idempotente por id), recusa o que mandarmos recusar. */
function servidor() {
  const s = {
    online: true,
    aplicadas: new Map<string, unknown>(),
    lotes: [] as string[][],
    recusar: new Map<string, { status: number; erro: string }>(),
    cairNoMeio: false, // aplica e "perde" a resposta (rede cai)
    sessaoExpirada: false,
    retratos: 0,
    fetch: (async (url: string, init?: RequestInit) => {
      if (!s.online) throw new TypeError("Failed to fetch");
      if (s.sessaoExpirada) return new Response(JSON.stringify({ erro: "Não autorizado" }), { status: 401 });
      if (url.startsWith("/api/tecnico/atividades/")) {
        s.retratos += 1;
        const id = decodeURIComponent(url.split("/").pop()!);
        const r = retrato(id, "EM_ANDAMENTO");
        return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "/api/tecnico/meu-dia") return new Response(JSON.stringify({ atividades: [{ atividadeId: "aA" }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url === "/api/tecnico/sync") {
        const { operacoes } = JSON.parse(String(init!.body));
        s.lotes.push(operacoes.map((o: any) => o.tipo));
        const travadas = new Set<string>();
        const resultados = operacoes.map((o: any) => {
          if (s.aplicadas.has(o.id)) return { id: o.id, ok: true, status: 200, repetida: true };
          if (travadas.has(o.atividadeId)) return { id: o.id, ok: false, status: 0, adiada: true };
          const rec = s.recusar.get(o.tipo);
          if (rec) { travadas.add(o.atividadeId); return { id: o.id, ok: false, ...rec }; }
          s.aplicadas.set(o.id, o);
          return { id: o.id, ok: true, status: 200 };
        });
        if (s.cairNoMeio) { s.cairNoMeio = false; throw new TypeError("network error"); }
        return new Response(JSON.stringify({ resultados }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
  return s;
}

describe("estado da tela = retrato + fila (as mesmas regras do servidor)", () => {
  const op = (o: NovaOperacao, seq: number): OperacaoFila => ({ ...o, id: `op${seq}`, seq, criadoEm: "", estado: "pendente", tentativas: 0 } as OperacaoFila);
  it("TUDO OK marca só os sem resposta (medição fica); Atenção mostra o que falta; medição com número; foto de item conta", () => {
    const r = retrato();
    const x = estadoDaAtividade(r, [
      op({ tipo: "iniciar", atividadeId: "aA" }, 1),
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "i2", dados: { status: "ATENCAO" } }, 2),
      op({ tipo: "tudoOk", atividadeId: "aA", equipamentoId: "eqA" }, 3),
    ]);
    const a = x.equipamentos[0];
    expect(x.atividade.status).toBe("EM_ANDAMENTO");
    expect([a.feito, a.respostas.i1.status, a.respostas.i2.status, a.respostas.m1]).toEqual([true, "OK", "ATENCAO", undefined]);
    expect(a.faltas).toEqual({ semResposta: ["Pressão de sucção"], semFoto: ["Limpeza dos filtros", "Dreno e bandeja"], semObservacao: ["Dreno e bandeja"], formulario: null });
    const y = estadoDaAtividade(r, [
      op({ tipo: "tudoOk", atividadeId: "aA", equipamentoId: "eqA" }, 1),
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "m1", dados: { valor: 0 } }, 2),
      op({ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i1", clientId: "f1" } }, 3),
      op({ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i1", clientId: "f1" } }, 4), // repetida: não duplica
    ]);
    expect(y.equipamentos[0]).toMatchObject({ completo: true, respostas: { m1: { valor: 0, unidade: "psi", status: null } } });
    expect(y.equipamentos[0].fotos).toHaveLength(1);
    expect(y.conclusao).toMatchObject({ ok: true, atendidos: 1, naoAtendidos: 1 });
    // medição não aceita OK/Atenção; item comum não aceita número (igual ao servidor)
    const z = estadoDaAtividade(r, [
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "m1", dados: { status: "OK" } }, 1),
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "i2", dados: { valor: 3 } }, 2),
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "m1", dados: { valor: 5 } }, 3),
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "m1", dados: { status: "NAO_SE_APLICA" } }, 4),
    ]);
    expect(z.equipamentos[0].respostas).toEqual({ m1: expect.objectContaining({ status: "NAO_SE_APLICA", valor: null }) });
    // só o "OK" na medição: nada muda (o servidor recusaria)
    expect(estadoDaAtividade(r, [op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "m1", dados: { status: "OK" } }, 1)]).equipamentos[0].respostas).toEqual({});
  });

  it("áudio vale como observação; vincular pela lista/QR traz o checklist do tipo; adicional com foto; concluir trava a tela", () => {
    const r = retrato();
    const x = estadoDaAtividade(r, [
      op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "i2", dados: { status: "ATENCAO" } }, 1),
      op({ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i2", clientId: "f2" } }, 2),
      op({ tipo: "audio", atividadeId: "aA", equipamentoId: "eqA", itemId: "i2", dataUrl: "data:audio/webm;base64,GkXfow==" }, 3),
      op({ tipo: "scan", atividadeId: "aA", valor: "https://frivo.app/qr/tok-eqN" }, 4),
      op({ tipo: "adicional", atividadeId: "aA", dados: { clientId: "ad1aaaaaaa", descricao: "Troca do controle" } }, 5),
      op({ tipo: "adicionalFoto", atividadeId: "aA", dados: { servicoClientId: "ad1aaaaaaa", dataUrl: FOTO, clientId: "fa1aaaaaaa" } }, 6),
      op({ tipo: "adicional", atividadeId: "aA", dados: { clientId: "ad1aaaaaaa", descricao: "Troca do controle e pilhas" } }, 7),
    ]);
    expect(x.equipamentos[0].faltas.semObservacao).toEqual([]);
    expect(x.equipamentos[0].respostas.i2).toMatchObject({ audio: true, audioLocal: expect.stringContaining("audio/webm") });
    expect(x.equipamentos.map((e) => [e.equipamento.id, e.feito, e.itens.length, e.pendente ?? false])).toEqual([["eqA", true, 3, false], ["eqB", false, 3, false], ["eqN", true, 3, true]]);
    expect(x.adicionais).toEqual([expect.objectContaining({ clientId: "ad1aaaaaaa", descricao: "Troca do controle e pilhas", statusCobranca: "A_AVALIAR", fotos: [expect.objectContaining({ clientId: "fa1aaaaaaa" })] })]);
    expect(equipamentoDoQr(r, "QR-2026-0003")?.id).toBe("eqN");
    expect(equipamentoDoQr(r, "qualquer")).toBeNull();
    const c = estadoDaAtividade(r, [op({ tipo: "concluir", atividadeId: "aA", dados: {} }, 1)]);
    expect([c.atividade.status, c.bloqueada]).toEqual(["CONCLUIDA", true]);
    // operações de OUTRA atividade não entram
    expect(estadoDaAtividade(r, [op({ tipo: "iniciar", atividadeId: "aX" }, 1)]).atividade.status).toBe("AGENDADA");
    expect(aplicar(r, r.execucao, op({ tipo: "fotoRemover", atividadeId: "aA", dados: { clientId: "nada" } }, 1)).equipamentos).toHaveLength(2);
  });

  it("concluir equipamento leva ao PRÓXIMO que falta (para a frente; depois um atendido incompleto; senão volta à OS)", () => {
    const r = retrato();
    const ops = [op({ tipo: "tudoOk", atividadeId: "aA", equipamentoId: "eqA" }, 1)];
    expect(proximoEquipamento(estadoDaAtividade(r, ops), "eqA")).toBe("eqB");
    expect(proximoEquipamento(estadoDaAtividade(r, ops), "eqB")).toBe("eqA"); // eqA atendido, mas falta a medição
    const fim = [...ops, op({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId: "m1", dados: { valor: 1 } }, 2), op({ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, itemId: "i1", clientId: "x1" } }, 3)];
    expect(proximoEquipamento(estadoDaAtividade(r, fim), "eqB")).toBeNull();
    expect(proximoEquipamento(estadoDaAtividade(r, fim), null)).toBe("eqB");
  });
});

describe("motor de sincronização + IndexedDB", () => {
  let banco: BancoTecnico;
  let s: ReturnType<typeof servidor>;
  let motor: MotorSync;
  let relogio = 1_000;
  beforeEach(async () => {
    (globalThis as any).indexedDB = new IDBFactory();
    banco = await BancoTecnico.abrir("uT");
    s = servidor();
    relogio = 1_000;
    motor = new MotorSync(banco, { fetch: s.fetch, online: () => s.online, agora: () => (relogio += 10) });
  });
  const fila = () => banco.fila();
  const resposta = (itemId: string, dados: any): NovaOperacao => ({ tipo: "resposta", atividadeId: "aA", equipamentoId: "eqA", itemId, dados });

  it("SEM SINAL: grava tudo no aparelho, nada sai; a fila sobrevive a fechar e abrir o app; o estado diz offline", async () => {
    s.online = false;
    await banco.guardarRetrato(retrato(), 0);
    await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" }, { tipo: "tudoOk", atividadeId: "aA", equipamentoId: "eqA" }]);
    await motor.registrar([{ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, momento: "ANTES", clientId: "fotoantes01" } }]);
    await motor.sincronizar(true);
    expect(s.lotes).toEqual([]);
    expect(motor.atual).toMatchObject({ situacao: "offline", pendentes: 3, erros: 0 });
    banco.fechar();
    const reaberto = await BancoTecnico.abrir("uT");
    const ops = await reaberto.fila();
    expect(ops.map((o) => [o.tipo, o.estado])).toEqual([["iniciar", "pendente"], ["tudoOk", "pendente"], ["foto", "pendente"]]);
    expect(new Set(ops.map((o) => o.id)).size).toBe(3);
    // a tela, sem sinal, já mostra o que foi feito
    const x = estadoDaAtividade((await reaberto.retrato("aA"))!.retrato, ops);
    expect([x.atividade.status, x.equipamentos[0].respostas.i1.status, x.equipamentos[0].fotos[0].momento]).toEqual(["EM_ANDAMENTO", "OK", "ANTES"]);
    // dois usuários no mesmo aparelho: bancos separados
    const outro = await BancoTecnico.abrir("uT2");
    expect(await outro.fila()).toEqual([]);
  });

  it("VOLTA O SINAL: sobe em ordem; a operação confirmada só sai da fila quando chega o retrato novo", async () => {
    s.online = false;
    await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" }, resposta("i1", { status: "OK" }), resposta("m1", { valor: 120 })]);
    s.online = true;
    await motor.sincronizar(true);
    expect(s.lotes).toEqual([["iniciar", "resposta", "resposta"]]);
    expect(s.retratos).toBe(1);
    expect(await fila()).toEqual([]); // confirmadas + retrato novo = fora da fila
    expect(await banco.retrato("aA")).toMatchObject({ retrato: { execucao: { atividade: { status: "EM_ANDAMENTO" } } } });
    expect(motor.atual).toMatchObject({ situacao: "sincronizado", pendentes: 0 });
  });

  it("confirmada mas sem retrato novo (sinal caiu logo depois): continua aplicada na tela, não é reenviada", async () => {
    await banco.guardarRetrato(retrato(), 0);
    const fetchOriginal = s.fetch;
    let n = 0;
    (motor as any).fetch = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/tecnico/atividades/")) { n += 1; throw new TypeError("caiu"); }
      return fetchOriginal(url, init);
    }) as typeof fetch;
    await motor.registrar([resposta("i1", { status: "OK" })]);
    await motor.sincronizar(true);
    const ops = await fila();
    expect(ops.map((o) => o.estado)).toEqual(["enviada"]);
    expect(n).toBeGreaterThan(0);
    expect(estadoDaAtividade((await banco.retrato("aA"))!.retrato, ops).equipamentos[0].respostas.i1.status).toBe("OK");
    expect(motor.atual.pendentes).toBe(0);
    // próxima rodada não reenvia a enviada
    (motor as any).fetch = fetchOriginal;
    s.lotes = [];
    await motor.sincronizar(true);
    expect(s.lotes).toEqual([]);
    // o retrato novo (pedido DEPOIS da confirmação) tira da fila
    await motor.baixarRetrato("aA");
    expect(await fila()).toEqual([]);
  });

  it("retrato pedido ANTES da confirmação não tira a operação da fila (pode não contê-la)", async () => {
    const op1 = await banco.enfileirar({ tipo: "iniciar", atividadeId: "aA", id: novoId(), criadoEm: "", estado: "enviada", tentativas: 0, enviadaEm: 2_000 } as OperacaoFila);
    await banco.guardarRetrato(retrato(), 1_500); // pedido antes de o servidor confirmar
    expect((await fila()).map((o) => o.seq)).toEqual([op1.seq]);
    await banco.guardarRetrato(retrato(), 2_500); // pedido depois: já contém
    expect(await fila()).toEqual([]);
  });

  it("RESPOSTA PERDIDA (rede cai no meio): reenvia com o MESMO id e o servidor não aplica de novo", async () => {
    s.cairNoMeio = true;
    await motor.registrar([{ tipo: "foto", atividadeId: "aA", equipamentoId: "eqA", dados: { dataUrl: FOTO, clientId: "fotounica1" } }]);
    // registrar já disparou uma rodada (que caiu); a próxima reenvia
    await motor.sincronizar(true);
    expect(s.aplicadas.size).toBe(1);
    expect(s.lotes).toEqual([["foto"], ["foto"]]);
    expect(await fila()).toEqual([]);
  });

  it("RECUSA do servidor fica com o motivo e SEGURA as seguintes da mesma atividade; outra atividade segue; tentar de novo; descartar", async () => {
    s.recusar.set("resposta", { status: 409, erro: "Atividade concluída: reabra a atividade para alterar a execução." });
    await motor.registrar([resposta("i1", { status: "ATENCAO" }), { tipo: "concluir", atividadeId: "aA", dados: {} }, { tipo: "iniciar", atividadeId: "aB" }]);
    await motor.sincronizar(true);
    let ops = await fila();
    expect(ops.filter((o) => o.atividadeId === "aA").map((o) => [o.tipo, o.estado, o.erro ?? null])).toEqual([
      ["resposta", "erro", "Atividade concluída: reabra a atividade para alterar a execução."], ["concluir", "pendente", null],
    ]);
    expect(motor.atual).toMatchObject({ situacao: "erro", erros: 1, pendentes: 2 });
    expect([...s.aplicadas.values()].map((o: any) => o.tipo)).toEqual(["iniciar"]); // a da aB subiu
    // rodada seguinte: a recusada não vai sozinha, e o "concluir" atrás dela também não
    s.lotes = [];
    await motor.sincronizar(true);
    expect(s.lotes).toEqual([]);
    // o escritório reabriu: tentar de novo sobe as duas, em ordem
    s.recusar.clear();
    await motor.tentarDeNovo();
    expect(s.lotes).toEqual([["resposta", "concluir"]]);
    expect(await fila()).toEqual([]);
    // descartar: só a recusada, por decisão do técnico
    s.recusar.set("adicional", { status: 400, erro: "Equipamento de outro cliente." });
    await motor.registrar([{ tipo: "adicional", atividadeId: "aA", dados: { clientId: "adicional01", descricao: "Limpeza", equipamentoId: "eqZ" } }, resposta("i2", { status: "OK" })]);
    ops = await fila();
    const pendente = ops.find((o) => o.tipo === "resposta")!;
    expect(await motor.descartar(pendente.seq!)).toBe(false); // pendente não se descarta
    const recusada = ops.find((o) => o.tipo === "adicional")!;
    expect(await motor.descartar(recusada.seq!)).toBe(true);
    await motor.sincronizar(true);
    expect(await fila()).toEqual([]);
  });

  it("falha do servidor (5xx) não marca erro: tenta de novo sozinho, com espera crescente; sessão expirada não perde nada", async () => {
    const original = s.fetch;
    (motor as any).fetch = (async (url: string, init?: RequestInit) => (url === "/api/tecnico/sync" ? new Response("{}", { status: 503 }) : original(url, init))) as typeof fetch;
    await motor.registrar([resposta("i1", { status: "OK" })]);
    await motor.aguardar();
    expect((await fila()).map((o) => o.estado)).toEqual(["pendente"]);
    expect(motor.atual.situacao).toBe("offline");
    const espera = (motor as any).proximaTentativa;
    expect(espera).toBeGreaterThan(relogio);
    await motor.sincronizar(); // sem forçar: ainda na espera, nem tenta
    (motor as any).fetch = original;
    s.sessaoExpirada = true;
    await motor.sincronizar(true);
    expect(motor.atual.situacao).toBe("sessao");
    expect((await fila()).map((o) => o.estado)).toEqual(["pendente"]);
    s.sessaoExpirada = false;
    await motor.tentarDeNovo();
    expect(await fila()).toEqual([]);
  });

  it("lotes: ordem mantida e nenhum lote passa do limite do corpo (uma foto grande vai sozinha)", () => {
    const pequenas = Array.from({ length: 95 }, (_, i) => ({ i, t: 100 }));
    expect(emLotes(pequenas, (o) => o.t).map((l) => l.length)).toEqual([40, 40, 15]);
    const grandes = [{ t: 2_000_000 }, { t: 2_000_000 }, { t: 10 }, { t: LIMITE_LOTE_BYTES + 5 }];
    expect(emLotes(grandes, (o) => o.t).map((l) => l.map((o) => o.t))).toEqual([[2_000_000], [2_000_000, 10], [LIMITE_LOTE_BYTES + 5]]);
    expect(novoId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("Meu dia sem sinal: devolve o guardado (com a hora em que foi baixado)", async () => {
    const r1 = await motor.baixarLista<{ atividades: unknown[] }>("meuDia", "/api/tecnico/meu-dia");
    expect(r1.doAparelho).toBe(false);
    s.online = false;
    const r2 = await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    expect(r2).toEqual({ dados: r1.dados, baixadoEm: r1.baixadoEm, doAparelho: true });
  });
});
