/**
 * App de campo, leva 1 — REGRAS PURAS:
 *  - QR do equipamento pelo Meu dia: para onde leva (equipamento na OS de hoje · incluir na atividade · ficha);
 *  - a ficha que vai para o app: sem valores, sem decisão de cobrança, sem link com token, sem agendamento futuro;
 *  - materiais usados: validação, separação que o uso consome, ajuste pela diferença (nunca baixa duas vezes),
 *    baixa direta, busca no catálogo do aparelho e o que a tela mostra antes de sincronizar.
 */
import { describe, expect, it } from "vitest";
import { destinoDoQr, lerValorQr, paraFicha, qrConfere, LIMITE_HISTORICO_APP, type AtividadeDoDia } from "@/lib/tecnico/qr-campo";
import {
  aplicarMaterial, buscarNoCatalogo, identificado, deltaBaixaDireta, escolherSeparacao, materialRemoverSchema, materialSchema, planoAjusteConsumo,
  quantidadeSchema, removerMaterialDaLista, textoQuantidade, type MaterialTela, type ProdutoCatalogo, type SeparacaoCandidata,
} from "@/lib/tecnico/materiais";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import type { EventoHistorico } from "@/lib/equipamento-historico";
import type { OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

/* ───────── apoio ───────── */
const info = (id: string, titulo: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin", tag: null, numeroSerie: null, local: null, unidade: "Matriz", ativo: true, tipo: null });
const unid = (id: string, titulo: string, codigo: string | null) => ({ ...info(id, titulo), tipoEquipamentoId: null, qr: codigo ? { tokenPublico: `tok-${id}`, codigo } : null });
function retrato(id: string, status: string, vinculados: string[], unidade: ReturnType<typeof unid>[]): RetratoAtividade {
  return {
    cartao: {} as never,
    execucao: {
      atividade: { id, titulo: "Preventiva", status, tipoOs: null }, os: { id: `os-${id}`, numero: `OS-${id}`, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: status === "CONCLUIDA", adicionais: [],
      equipamentos: vinculados.map((v) => ({ vinculoId: `v-${v}`, feito: false, observacao: null, equipamento: info(v, v), itens: [], respostas: {}, fotos: [], formulario: null, faltas: { semResposta: [], semFoto: [], semObservacao: [], formulario: null }, completo: false })),
      conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null },
    },
    equipamentosUnidade: unidade, checklistsPorTipo: {}, geradoEm: "2026-11-12T12:00:00Z",
  } as unknown as RetratoAtividade;
}
const dia = (r: RetratoAtividade, status = r.execucao.atividade.status): AtividadeDoDia => ({ retrato: r, status, vinculados: r.execucao.equipamentos.map((e) => e.equipamento.id) });
const UNIDADE = [unid("eqA", "Split Sala 1", "QR-1"), unid("eqB", "Split Sala 2", "QR-2"), unid("eqC", "Split Sala 3", "QR-3"), unid("eqS", "Sem QR", null)];

describe("QR: o que a etiqueta traz", () => {
  it("URL pública (…/qr/<token>), token puro ou código — com espaços em volta", () => {
    expect(lerValorQr(" https://app.frivo.com.br/qr/abc123?x=1 ")).toEqual({ token: "abc123", codigo: "https://app.frivo.com.br/qr/abc123?x=1" });
    expect(lerValorQr("QR-2026-0003")).toEqual({ token: "QR-2026-0003", codigo: "QR-2026-0003" });
    expect(qrConfere({ tokenPublico: "tok-eqA", codigo: "QR-1" }, "https://x/qr/tok-eqA")).toBe(true);
    expect(qrConfere({ tokenPublico: "tok-eqA", codigo: "QR-1" }, "QR-1")).toBe(true);
    expect(qrConfere({ tokenPublico: "tok-eqA", codigo: "QR-1" }, "QR-11")).toBe(false);
    expect(qrConfere(null, "QR-1")).toBe(false);
    expect(qrConfere({ tokenPublico: "", codigo: "" }, "   ")).toBe(false);
  });
});

describe("QR pelo Meu dia: para onde leva", () => {
  const aAgendada = retrato("aA", "AGENDADA", ["eqA"], UNIDADE);
  const aAndamento = retrato("aB", "EM_ANDAMENTO", ["eqA", "eqB"], UNIDADE);
  const aConcluida = retrato("aC", "CONCLUIDA", ["eqC"], UNIDADE);

  it("equipamento numa atividade de hoje: abre DENTRO dela; em andamento vence agendada (em qualquer ordem da lista)", () => {
    expect(destinoDoQr("QR-1", [dia(aAgendada), dia(aAndamento)])).toEqual({ tipo: "naAtividade", atividadeId: "aB", equipamentoId: "eqA", titulo: "Split Sala 1" });
    expect(destinoDoQr("https://x/qr/tok-eqA", [dia(aAndamento), dia(aAgendada)])).toMatchObject({ tipo: "naAtividade", atividadeId: "aB" });
    expect(destinoDoQr("QR-1", [dia(aAgendada)])).toMatchObject({ tipo: "naAtividade", atividadeId: "aA", equipamentoId: "eqA" });
  });
  it("concluída só se for a ÚNICA onde ele está (abre para leitura)", () => {
    expect(destinoDoQr("QR-3", [dia(aConcluida)])).toMatchObject({ tipo: "naAtividade", atividadeId: "aC", equipamentoId: "eqC" });
  });
  it("o que o técnico já gravou no aparelho conta: status local e equipamento vinculado sem sinal", () => {
    // A agendada que ele já iniciou vence a outra agendada
    const outra = retrato("aZ", "AGENDADA", ["eqA"], UNIDADE);
    expect(destinoDoQr("QR-1", [dia(outra), dia(aAgendada, "EM_ANDAMENTO")])).toMatchObject({ atividadeId: "aA" });
    // Vinculado no aparelho (ainda não no retrato)
    expect(destinoDoQr("QR-2", [{ ...dia(aAgendada), vinculados: ["eqA", "eqB"] }])).toMatchObject({ tipo: "naAtividade", atividadeId: "aA", equipamentoId: "eqB" });
  });
  it("da unidade de uma atividade ABERTA, fora dela: pergunta se inclui (não cria nada sozinho)", () => {
    expect(destinoDoQr("QR-2", [dia(aAgendada)])).toEqual({ tipo: "naUnidade", atividadeId: "aA", equipamentoId: "eqB", titulo: "Split Sala 2" });
    // Em andamento vence a agendada também aqui
    expect(destinoDoQr("QR-3", [dia(aAgendada), dia(aAndamento)])).toMatchObject({ tipo: "naUnidade", atividadeId: "aB" });
  });
  it("só concluída (ou cancelada) na unidade: não oferece incluir — vai para a ficha", () => {
    expect(destinoDoQr("QR-1", [dia(aConcluida)])).toEqual({ tipo: "ficha", valor: "QR-1" });
    expect(destinoDoQr("QR-1", [dia(retrato("aX", "CANCELADA", ["eqA"], UNIDADE))])).toEqual({ tipo: "ficha", valor: "QR-1" });
  });
  it("não está em nada de hoje (ou o dia está vazio): ficha, com o valor lido sem espaços", () => {
    expect(destinoDoQr(" QR-999 ", [dia(aAgendada), dia(aAndamento)])).toEqual({ tipo: "ficha", valor: "QR-999" });
    expect(destinoDoQr("QR-1", [])).toEqual({ tipo: "ficha", valor: "QR-1" });
  });
});

describe("a ficha que vai para o app", () => {
  const ev = (chave: string, status: string, data: string, extra: Partial<EventoHistorico> = {}): EventoHistorico => ({
    chave, data, titulo: "Preventiva", tipoServico: { nome: "Manutenção preventiva", cor: "#000" }, tecnico: "João", status, origemStatus: "ATIVIDADE",
    equipamentoFeito: true, checklist: { ok: 10, atencao: 1, naoSeAplica: 2, total: 13, itensAtencao: ["Dreno"] }, fotos: ["/api/fotos-atendimento/f1", "/api/fotos-atendimento/f2"],
    observacao: "Filtro trocado", medicoes: [{ texto: "Sucção", valor: 132, unidade: "psi" }], audios: [{ texto: "x", url: "/api/a" }],
    adicionais: [{ descricao: "Troca do controle", statusCobranca: "COBRAR", fotos: ["/f"] }], resumo: "ok", os: { id: "os1", numero: "OS-1", status: "CONCLUIDA" },
    atividadeId: "a1", linkRelatorio: "/relatorio/atividade/a1?t=SEGREDO", formularios: [], ...extra,
  });
  const AGORA = new Date("2026-11-26T12:00:00Z");

  it("leva o que foi feito; nunca decisão de cobrança, link com token, endereço de foto ou áudio", () => {
    const [f] = paraFicha([ev("a1", "CONCLUIDA", "2026-11-10T12:00:00Z")], 20, AGORA);
    expect(f).toEqual({
      chave: "a1", data: "2026-11-10T12:00:00Z", titulo: "Preventiva", tipoServico: "Manutenção preventiva", tecnico: "João", status: "CONCLUIDA",
      checklist: { ok: 10, atencao: 1, naoSeAplica: 2, itensAtencao: ["Dreno"] }, medicoes: [{ texto: "Sucção", valor: 132, unidade: "psi" }],
      observacao: "Filtro trocado", resumo: "ok", adicionais: ["Troca do controle"], fotos: 2, osNumero: "OS-1",
    });
    const txt = JSON.stringify(f);
    for (const proibido of ["COBRAR", "SEGREDO", "relatorio", "/api/", "statusCobranca", "linkRelatorio", "valorUnit", "custo"]) expect(txt).not.toContain(proibido);
  });
  it("agendamento futuro não é histórico; o de hoje que já passou e o em andamento ficam", () => {
    const f = paraFicha([
      ev("fut", "AGENDADA", "2026-12-10T12:00:00Z"), ev("hojeAntes", "AGENDADA", "2026-11-26T11:00:00Z"),
      ev("and", "EM_ANDAMENTO", "2026-12-30T12:00:00Z"), ev("ok", "CONCLUIDA", "2026-11-01T12:00:00Z"),
    ], 20, AGORA);
    expect(f.map((e) => e.chave)).toEqual(["hojeAntes", "and", "ok"]);
  });
  it("no máximo LIMITE_HISTORICO_APP atendimentos (o completo fica no escritório); sem checklist = null", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ev(`e${i}`, "CONCLUIDA", "2026-01-01T00:00:00Z", { checklist: null }));
    const f = paraFicha(muitos, undefined, AGORA);
    expect(f).toHaveLength(LIMITE_HISTORICO_APP);
    expect(LIMITE_HISTORICO_APP).toBe(20);
    expect(f[0].checklist).toBeNull();
    expect(paraFicha([ev("x", "CONCLUIDA", "2026-01-01T00:00:00Z", { tipoServico: null })], 20, AGORA)[0].tipoServico).toBeNull();
  });
});

describe("material: o que a fila aceita", () => {
  const base = { clientId: "c1", quantidade: 2 };
  it("linha nova: do catálogo (produto) ou descrita (fora do catálogo, ≥ 2 letras); correção: só clientId + quantidade", () => {
    expect(materialSchema.safeParse({ ...base, produtoId: "p1" }).success).toBe(true);
    expect(materialSchema.safeParse({ ...base, produtoId: null, descricao: "Fita" }).success).toBe(true);
    expect(materialSchema.safeParse({ ...base }).success).toBe(true); // a correção da quantidade passa
    expect(identificado({ produtoId: "p1" })).toBe(true);
    expect(identificado({ produtoId: null, descricao: "Fita" })).toBe(true);
    expect(identificado({ descricao: "ab" })).toBe(true);
    expect(identificado({ descricao: " a " })).toBe(false);
    expect(identificado({})).toBe(false);
    expect(identificado({ produtoId: "", descricao: "" })).toBe(false);
  });
  it("quantidade: > 0, até 99.999, no máximo 3 casas; nada de campo extra (ex.: preço)", () => {
    expect(quantidadeSchema.safeParse(0.001).success).toBe(true);
    expect(quantidadeSchema.safeParse(99_999).success).toBe(true);
    for (const q of [0, -1, 100_000, 1.0001, Number.NaN, Infinity]) expect(quantidadeSchema.safeParse(q).success, String(q)).toBe(false);
    expect(quantidadeSchema.safeParse(0).error?.issues[0].message).toBe("A quantidade precisa ser maior que zero.");
    expect(quantidadeSchema.safeParse(1.0001).error?.issues[0].message).toBe("Use no máximo 3 casas decimais.");
    expect(materialSchema.safeParse({ ...base, produtoId: "p1", valorUnit: 10 }).success).toBe(false);
    expect(materialSchema.safeParse({ ...base, produtoId: "p1", descricao: "x".repeat(161) }).success).toBe(false);
  });
  it("remover pede qual (id ou clientId)", () => {
    expect(materialRemoverSchema.safeParse({}).success).toBe(false);
    expect(materialRemoverSchema.safeParse({ clientId: "c1" }).success).toBe(true);
    expect(materialRemoverSchema.safeParse({ id: "m1" }).success).toBe(true);
  });
});

describe("baixa: nunca duas vezes", () => {
  it("dentro do separado: a reserva vira saída (líquido zero no saldo)", () => {
    expect(planoAjusteConsumo(5, 0, 3)).toEqual({ reserva: 3, saida: 3 });
    expect(planoAjusteConsumo(5, 3, 5)).toEqual({ reserva: 2, saida: 2 });
  });
  it("passou do separado: só o excedente baixa a mais", () => {
    const p = planoAjusteConsumo(5, 0, 8);
    expect(p).toEqual({ reserva: 5, saida: 8 });
    expect(p.reserva - p.saida).toBe(-3); // efeito no saldo: −3 (o excedente)
    expect(planoAjusteConsumo(5, 5, 8)).toEqual({ reserva: 0, saida: 3 });
  });
  it("diminuir/estornar devolve à reserva o que cabe nela e estorna a saída", () => {
    expect(planoAjusteConsumo(5, 8, 3)).toEqual({ reserva: -2, saida: -5 });
    expect(planoAjusteConsumo(5, 3, 0)).toEqual({ reserva: -3, saida: -3 });
    expect(planoAjusteConsumo(5, 4, 4)).toEqual({ reserva: 0, saida: 0 });
  });
  it("ajustar em passos dá o mesmo que de uma vez (soma dos planos = plano direto)", () => {
    const a = planoAjusteConsumo(5, 0, 2), b = planoAjusteConsumo(5, 2, 9), c = planoAjusteConsumo(5, 9, 4);
    const d = planoAjusteConsumo(5, 0, 4);
    expect(+(a.reserva + b.reserva + c.reserva).toFixed(3)).toBe(d.reserva);
    expect(+(a.saida + b.saida + c.saida).toFixed(3)).toBe(d.saida);
  });
  it("separação zerada: tudo é saída; decimais arredondados em 3 casas", () => {
    expect(planoAjusteConsumo(0, 0, 2.5)).toEqual({ reserva: 0, saida: 2.5 });
    expect(planoAjusteConsumo(0.1, 0, 0.3)).toEqual({ reserva: 0.1, saida: 0.3 });
  });
  it("baixa direta: a diferença entre o que deve e o que já baixou", () => {
    expect(deltaBaixaDireta(0, 2)).toBe(2);
    expect(deltaBaixaDireta(2, 3.5)).toBe(1.5);
    expect(deltaBaixaDireta(3.5, 0)).toBe(-3.5);
    expect(deltaBaixaDireta(2, 2)).toBe(0);
  });
});

describe("qual separação o uso consome", () => {
  const m = (id: string, x: Partial<SeparacaoCandidata> = {}): SeparacaoCandidata => ({ id, produtoId: "p1", estadoSeparacao: "SEPARADO", quantidadeSeparada: 4, quantidadeConsumida: 0, ordem: 0, doCampo: false, ...x });
  it("a SEPARADA do mesmo produto (a primeira na ordem da OS)", () => {
    expect(escolherSeparacao([m("b", { ordem: 2 }), m("a", { ordem: 1 })], "p1")).toBe("a");
    expect(escolherSeparacao([m("b", { ordem: 1 }), m("a", { ordem: 1 })], "p1")).toBe("a"); // empate: id
    expect(escolherSeparacao([m("a", { produtoId: "p2" })], "p1")).toBeNull();
  });
  it("consumida pelo CAMPO continua valendo; pelo escritório, devolvida ou não separada, não", () => {
    expect(escolherSeparacao([m("a", { estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 2, doCampo: true })], "p1")).toBe("a");
    expect(escolherSeparacao([m("a", { estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 2, doCampo: false })], "p1")).toBeNull();
    expect(escolherSeparacao([m("a", { estadoSeparacao: "DEVOLVIDO", doCampo: true })], "p1")).toBeNull();
    expect(escolherSeparacao([m("a", { estadoSeparacao: null, quantidadeSeparada: 0 })], "p1")).toBeNull();
    expect(escolherSeparacao([m("a", { quantidadeSeparada: 0 })], "p1")).toBeNull();
    // SEPARADO mas com consumo já informado (estado inconsistente): não arrisca baixar de novo
    expect(escolherSeparacao([m("a", { quantidadeConsumida: 1 })], "p1")).toBeNull();
  });
  it("material fora do catálogo nunca consome separação", () => {
    expect(escolherSeparacao([m("a", { produtoId: null })], null)).toBeNull();
  });
});

describe("catálogo no aparelho", () => {
  const C: ProdutoCatalogo[] = [
    { id: "p1", codigo: 104, nome: "Capacitor 35+5 µF 440 V", unidade: "un" },
    { id: "p2", codigo: 105, nome: "Capacitor 45 µF 440 V", unidade: "un" },
    { id: "p3", codigo: 115, nome: "Cabo PP 4 x 2,5 mm² (m)", unidade: "m" },
    { id: "p4", codigo: 7, nome: "Válvula de serviço 1/4", unidade: "un" },
    { id: "p5", codigo: null, nome: "Fita isolante", unidade: "rl" },
  ];
  it("todas as palavras, sem acento e sem caixa; nome ou código", () => {
    expect(buscarNoCatalogo(C, "capacitor 45").map((p) => p.id)).toEqual(["p2"]);
    expect(buscarNoCatalogo(C, "VALVULA").map((p) => p.id)).toEqual(["p4"]);
    expect(buscarNoCatalogo(C, "115").map((p) => p.id)).toEqual(["p3"]);
    expect(buscarNoCatalogo(C, "  ")).toEqual([]);
    expect(buscarNoCatalogo(C, "inexistente")).toEqual([]);
  });
  it("código exato primeiro, depois quem começa com o termo, depois o resto (alfabético)", () => {
    expect(buscarNoCatalogo([...C, { id: "p6", codigo: 1, nome: "Kit 7 peças", unidade: "un" }], "7").map((p) => p.id)).toEqual(["p4", "p6"]);
    expect(buscarNoCatalogo([{ id: "x", codigo: null, nome: "Suporte para cabo", unidade: "un" }, ...C], "cabo").map((p) => p.id)).toEqual(["p3", "x"]);
  });
  it("limite de resultados", () => {
    const muitos = Array.from({ length: 50 }, (_, i) => ({ id: `q${i}`, codigo: i + 1000, nome: `Parafuso ${i}`, unidade: "un" }));
    expect(buscarNoCatalogo(muitos, "parafuso")).toHaveLength(30);
    expect(buscarNoCatalogo(muitos, "parafuso", 5)).toHaveLength(5);
  });
});

describe("a tela antes de sincronizar", () => {
  const lista: MaterialTela[] = [{ id: "m1", clientId: "c1", produtoId: "p1", descricao: "Capacitor", unidade: "un", quantidade: 1, equipamentoId: "eqA", meu: true, criadoPor: "João" }];
  it("lançar: entra na hora, como do técnico e pendente (nome e unidade vindos do catálogo)", () => {
    const n = aplicarMaterial(lista, { clientId: "c2", produtoId: "p3", descricao: " Cabo PP ", unidade: "m", quantidade: 3.5, equipamentoId: null });
    expect(n[1]).toEqual({ id: null, clientId: "c2", produtoId: "p3", descricao: "Cabo PP", unidade: "m", quantidade: 3.5, equipamentoId: null, meu: true, criadoPor: null, pendente: true });
    expect(aplicarMaterial([], { clientId: "c3", descricao: "Fita", quantidade: 1 })[0]).toMatchObject({ unidade: "un", produtoId: null, equipamentoId: null });
    expect(aplicarMaterial([], { clientId: "c3", descricao: "Fita", unidade: "  ", quantidade: 1 })[0].unidade).toBe("un");
  });
  it("a mesma linha de novo (clientId) corrige a quantidade e o equipamento — não duplica", () => {
    const n = aplicarMaterial(lista, { clientId: "c1", quantidade: 4, equipamentoId: null });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ quantidade: 4, equipamentoId: null, pendente: true, descricao: "Capacitor" });
    expect(aplicarMaterial(lista, { clientId: "c1", quantidade: 4 })[0].equipamentoId).toBe("eqA"); // equipamento não informado: fica
  });
  it("remover por id ou por clientId", () => {
    expect(removerMaterialDaLista(lista, { id: "m1" })).toEqual([]);
    expect(removerMaterialDaLista(lista, { clientId: "c1" })).toEqual([]);
    expect(removerMaterialDaLista(lista, { clientId: "outro" })).toHaveLength(1);
    expect(removerMaterialDaLista(lista, {})).toHaveLength(1);
  });
  it("quantidade com vírgula e unidade", () => {
    expect(textoQuantidade(2.5, "m")).toBe("2,5 m");
    expect(textoQuantidade(1, "un")).toBe("1 un");
  });
  it("na fila do aparelho: material e materialRemover mudam a tela; a ordem vale", () => {
    const r = retrato("aA", "EM_ANDAMENTO", ["eqA"], UNIDADE);
    r.execucao.materiais = lista;
    const op = (seq: number, o: Record<string, unknown>) => ({ seq, criadoEm: "", estado: "pendente", tentativas: 0, id: `o${seq}`, atividadeId: "aA", ...o }) as unknown as OperacaoFila;
    const x = estadoDaAtividade(r, [
      op(1, { tipo: "material", dados: { clientId: "c2", produtoId: "p3", descricao: "Cabo", unidade: "m", quantidade: 2 } }),
      op(2, { tipo: "material", dados: { clientId: "c2", quantidade: 5 } }),
      op(3, { tipo: "materialRemover", dados: { id: "m1" } }),
    ]);
    expect(x.materiais!.map((m) => [m.clientId, m.quantidade])).toEqual([["c2", 5]]);
    // Retrato antigo (sem a lista): começa vazia
    const velho = retrato("aA", "EM_ANDAMENTO", [], UNIDADE);
    expect(estadoDaAtividade(velho, [op(1, { tipo: "material", dados: { clientId: "c9", descricao: "Fita", quantidade: 1 } })]).materiais).toHaveLength(1);
    // Operação de outra atividade não entra
    expect(estadoDaAtividade(velho, [{ ...op(1, { tipo: "material", dados: { clientId: "c9", descricao: "Fita", quantidade: 1 } }), atividadeId: "outra" }]).materiais).toEqual([]);
  });
});
