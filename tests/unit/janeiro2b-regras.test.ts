/**
 * App pronto pra janeiro 2 · PR B — as regras puras.
 *  - D4: a legenda das fotos antes/depois (o schema do sync e a tela antes de sincronizar);
 *  - D5: o saldo disponível para o uso (catálogo + separado para a OS − o que está na fila) e o aviso "vai ficar negativo";
 *  - D14: equipamentos começados × completos.
 */
import { describe, expect, it } from "vitest";
import { avisoSemSaldo, disponivelParaUso, separadoParaUso, textoSaldo, type SeparacaoCandidata } from "@/lib/tecnico/materiais";
import { contarAndamento, resumoEquipamentos } from "@/lib/tecnico/topo-os";
import { operacaoSchema } from "@/lib/tecnico/sync";
import { aplicar } from "@/lib/tecnico/offline/estado";

describe("D5: saldo disponível para o uso", () => {
  const sep = (o: Partial<SeparacaoCandidata>): SeparacaoCandidata => ({ id: "m1", produtoId: "pGas", estadoSeparacao: "SEPARADO", quantidadeSeparada: 4, quantidadeConsumida: 0, ordem: 0, doCampo: false, ...o });
  it("separado: a mesma separação que o lançamento consome (a primeira candidata), inteira ou o que sobrou do campo", () => {
    expect(separadoParaUso([sep({})], "pGas")).toBe(4);
    expect(separadoParaUso([sep({ estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 3, doCampo: true })], "pGas")).toBe(1);
    expect(separadoParaUso([sep({ estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 6, doCampo: true })], "pGas")).toBe(0);
    // consumida pelo escritório (não é do campo) e devolvida: não conta
    expect(separadoParaUso([sep({ estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 3, doCampo: false })], "pGas")).toBe(0);
    expect(separadoParaUso([sep({ estadoSeparacao: "DEVOLVIDO" })], "pGas")).toBe(0);
    expect(separadoParaUso([sep({ produtoId: "pCap" })], "pGas")).toBe(0);
    expect(separadoParaUso([sep({})], null)).toBe(0);
    // duas separações do mesmo produto: só a primeira (pela ordem) entra neste uso
    expect(separadoParaUso([sep({ id: "m2", ordem: 1, quantidadeSeparada: 9 }), sep({ id: "m1", ordem: 0, quantidadeSeparada: 2 })], "pGas")).toBe(2);
  });
  it("disponível = saldo + separado − o que está na fila; sem saldo (não controla estoque) = null", () => {
    expect(disponivelParaUso(10, 0, 0)).toBe(10);
    expect(disponivelParaUso(0, 4, 0)).toBe(4);
    expect(disponivelParaUso(5, 2, 3)).toBe(4);
    expect(disponivelParaUso(1, 0, 3)).toBe(-2);
    expect(disponivelParaUso(0.3, 0.1, 0.2)).toBe(0.2); // sem o erro do ponto flutuante
    expect(disponivelParaUso(null, 4, 0)).toBeNull();
    expect(disponivelParaUso(undefined, 4, 0)).toBeNull();
    expect(disponivelParaUso(Number.NaN, 0, 0)).toBeNull();
  });
  it("o aviso: só quando passa do disponível; mostra o saldo (nunca negativo) e segue", () => {
    expect(avisoSemSaldo(3, 3, "un")).toBeNull();
    expect(avisoSemSaldo(3.5, 1, "m")).toBe("Saldo disponível: 1 m. Vai ficar negativo; o escritório será avisado.");
    expect(avisoSemSaldo(1, -2, "un")).toBe("Saldo disponível: 0 un. Vai ficar negativo; o escritório será avisado.");
    expect(avisoSemSaldo(0.30000000000000004, 0.3, "kg")).toBeNull();
    expect(avisoSemSaldo(0, 0, "un")).toBeNull();
    expect(avisoSemSaldo(-1, 0, "un")).toBeNull();
    expect(avisoSemSaldo(5, null, "un")).toBeNull();
  });
  it("a linha do saldo, com o separado para a OS quando houver", () => {
    expect(textoSaldo(12, 0, "un")).toBe("Saldo disponível: 12 un");
    expect(textoSaldo(5.5, 4, "kg")).toBe("Saldo disponível: 5,5 kg (4 kg separado para esta OS)");
    expect(textoSaldo(null, 4, "kg")).toBeNull();
  });
});

describe("D14: começados × completos", () => {
  const eq = (o: { feito?: boolean; respostas?: number; fotos?: number; completo?: boolean }) =>
    ({ feito: !!o.feito, respostas: Object.fromEntries(Array.from({ length: o.respostas ?? 0 }, (_, i) => [`i${i}`, { status: "OK" }])), fotos: Array.from({ length: o.fotos ?? 0 }, () => ({})), completo: !!o.completo }) as any;
  it("começado = mexeu (feito, resposta ou foto); completo = mexeu e está completo", () => {
    expect(contarAndamento([eq({ respostas: 1 }), eq({}), eq({ fotos: 1 }), eq({ feito: true, completo: true }), eq({ completo: true })]))
      .toEqual({ comecados: 3, completos: 1 });
    expect(contarAndamento([])).toEqual({ comecados: 0, completos: 0 });
  });
  it("o texto", () => {
    expect(resumoEquipamentos(2, 1, 0)).toBe("2 equipamentos · 1 começado · 0 completos");
  });
});

describe("D4: legenda das fotos antes/depois", () => {
  const base = { id: "7b1c2f0e-1d4a-4c39-9a51-2f6c3e8b9d10", atividadeId: "a1", em: "2026-11-28T12:00:00.000Z" };
  it("o schema do sync: pelo id ou pelo id do aparelho; vazia vale (volta à do sistema); nada além disso; limite de tamanho", () => {
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { id: "f1", legenda: "Serpentina suja" } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { clientId: "c1", legenda: "" } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { id: "f1", legenda: "x".repeat(201) } }).success).toBe(false);
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { id: "f1", legenda: "ok", url: "x" } }).success).toBe(false);
  });
  it("a tela antes de sincronizar: a foto (pelo id ou pelo clientId) já mostra a legenda; vazia volta a null", () => {
    const x = { equipamentos: [{ fotos: [{ id: "f1", clientId: null, legenda: null }, { id: null, clientId: "c2", legenda: "Velha" }, { id: "f3", clientId: null, legenda: "Fica" }] }] } as any;
    const op = (dados: Record<string, unknown>) => ({ ...base, tipo: "fotoLegenda", dados }) as any;
    let y = aplicar({} as any, x, op({ id: "f1", legenda: "  Antes da limpeza " }));
    y = aplicar({} as any, y, op({ clientId: "c2", legenda: "" }));
    expect(y.equipamentos[0].fotos.map((f: any) => f.legenda)).toEqual(["Antes da limpeza", null, "Fica"]);
  });
});

describe("D7: corrigir e excluir a despesa (regras)", async () => {
  const { despesaEdicaoSchema, despesaExclusaoSchema, mudancasDaDespesa, resumoDaDespesa, podeCorrigirDespesa } = await import("@/lib/tecnico/despesas");
  const { minhasDespesas } = await import("@/components/tecnico/despesas");
  const base = { categoria: "COMBUSTIVEL" as const, valor: 187.4, data: "2026-11-10", pagamento: "PROPRIO" as const, descricao: "Van" };
  it("o que mudou, campo a campo (a foto só 'trocada'); nada mudou = []", () => {
    expect(mudancasDaDespesa(base, base)).toEqual([]);
    expect(mudancasDaDespesa(base, { ...base, descricao: "  Van " })).toEqual([]);
    expect(mudancasDaDespesa(base, { ...base, valor: 187.40000001 })).toEqual([]);
    expect(mudancasDaDespesa(base, { categoria: "PEDAGIO", valor: 1234.5, data: "2026-11-09", pagamento: "EMPRESA", descricao: null }, true)).toEqual([
      "Tipo: Combustível → Pedágio", "Valor: R$ 187,40 → R$ 1.234,50", "Dia: 10/11/2026 → 09/11/2026",
      "Pagamento: Do meu bolso → Cartão ou dinheiro da empresa", "Descrição: “Van” → (sem)", "Foto do cupom trocada",
    ]);
    expect(mudancasDaDespesa({ ...base, descricao: null }, base)).toEqual(["Descrição: (sem) → “Van”"]);
    expect(resumoDaDespesa(base)).toBe("Combustível · R$ 187,40 · 10/11/2026 · Do meu bolso · Van");
    expect(resumoDaDespesa({ ...base, descricao: " " })).toBe("Combustível · R$ 187,40 · 10/11/2026 · Do meu bolso");
  });
  it("o schema: os campos do lançamento, a foto opcional; Outros pede descrição; a exclusão só com o clientId", () => {
    expect(despesaEdicaoSchema.safeParse({ clientId: "c", ...base }).success).toBe(true);
    expect(despesaEdicaoSchema.safeParse({ clientId: "c", ...base, foto: "x" }).success).toBe(false);
    expect(despesaEdicaoSchema.safeParse({ clientId: "c", ...base, categoria: "OUTROS", descricao: "ab" }).success).toBe(false);
    expect(despesaEdicaoSchema.safeParse({ clientId: "c", ...base, valor: 0 }).success).toBe(false);
    expect(despesaEdicaoSchema.safeParse({ clientId: "c", ...base, status: "APROVADA" }).success).toBe(false);
    expect(despesaExclusaoSchema.safeParse({ clientId: "c" }).success).toBe(true);
    expect(despesaExclusaoSchema.safeParse({ clientId: "c", id: "x" }).success).toBe(false);
  });
  it("só a que aguarda aprovação e que subiu sem erro", () => {
    expect(podeCorrigirDespesa({ situacao: "PENDENTE" })).toBe(true);
    for (const s of ["APROVADA", "RECUSADA", "REEMBOLSADA"] as const) expect(podeCorrigirDespesa({ situacao: s })).toBe(false);
    expect(podeCorrigirDespesa({ situacao: "PENDENTE", erroEnvio: "x" })).toBe(false);
  });
  it("a lista com a fila: correção e exclusão na ordem; a recusada não se aplica e diz por quê", () => {
    const s = (clientId: string, valor: number) => ({ id: clientId, clientId, ...base, valor, osNumero: null, situacao: "PENDENTE", motivoRecusa: null }) as any;
    const op = (seq: number, tipo: string, dados: any, estado = "pendente", erro?: string) => ({ seq, tipo, atividadeId: "sem-os", dados, estado, erro }) as any;
    const l = minhasDespesas([
      op(3, "despesaEditar", { clientId: "a", ...base, valor: 50 }),
      op(1, "despesaEditar", { clientId: "a", ...base, valor: 40 }),
      op(2, "despesaExcluir", { clientId: "b" }),
      op(4, "despesaEditar", { clientId: "c", ...base, valor: 1 }, "erro", "O escritório já decidiu."),
      op(5, "despesaEditar", { clientId: "d", ...base, valor: 9 }, "enviada"),
    ], [s("a", 10), s("b", 20), s("c", 30), s("d", 9)]);
    expect(l.map((d) => [d.clientId, d.valor, !!d.corrigidaNoAparelho, d.erroCorrecao ?? null])).toEqual([
      ["a", 50, true, null], ["c", 30, false, "Correção não enviada: O escritório já decidiu."], ["d", 9, false, null],
    ]);
  });
});

describe("D13: corrigir o checklist do veículo (regras)", async () => {
  const { decidirGravacao, mudancasDoChecklist, correcaoNoPrazo } = await import("@/lib/checklist-diario/regras");
  it("a decisão: só com o pedido explícito, sobre um FEITO, com outro envio", () => {
    const feito = { situacao: "FEITO" as const, clientId: "a" };
    expect(decidirGravacao(feito, { situacao: "FEITO", clientId: "b", correcao: true })).toBe("corrigir");
    expect(decidirGravacao(feito, { situacao: "FEITO", clientId: "b" })).toBe("manter");
    expect(decidirGravacao(feito, { situacao: "FEITO", clientId: "a", correcao: true })).toBe("repetido");
    expect(decidirGravacao(feito, { situacao: "NAO_VAI_USAR", clientId: "b", correcao: true })).toBe("manter");
    expect(decidirGravacao({ situacao: "NAO_VAI_USAR", clientId: "a" }, { situacao: "FEITO", clientId: "b", correcao: true })).toBe("trocar");
    expect(decidirGravacao(null, { situacao: "FEITO", clientId: "b", correcao: true })).toBe("criar");
    expect(correcaoNoPrazo("2027-01-04", "2027-01-04")).toBe(true);
    expect(correcaoNoPrazo("2027-01-04", "2027-01-05")).toBe(false);
  });
  it("o que mudou: na ordem do modelo; foto trocada ou incluída; a observação; nada mudou = []", () => {
    const itens = [{ id: "p", descricao: "Calibragem" }, { id: "o", descricao: "Nível do óleo" }, { id: "f", descricao: "Foto do painel" }];
    const antes = { itens: { p: { valor: "OK", temFoto: false }, o: { valor: "Normal", temFoto: false }, f: { valor: null, temFoto: true } }, observacao: null };
    expect(mudancasDoChecklist(itens, antes, { itens: { p: { valor: "OK", fotoNova: false }, o: { valor: " Normal ", fotoNova: false }, f: { valor: null, fotoNova: false } }, observacao: " " })).toEqual([]);
    expect(mudancasDoChecklist(itens, antes, { itens: { o: { valor: "Baixo", fotoNova: false }, p: { valor: "OK", fotoNova: true }, f: { valor: null, fotoNova: true } }, observacao: "Pneu" })).toEqual([
      "Calibragem: foto incluída", "Nível do óleo: Normal → Baixo", "Foto do painel: foto trocada", "Observação: (sem) → “Pneu”",
    ]);
    expect(mudancasDoChecklist(itens, antes, { itens: { o: { valor: "Normal", fotoNova: false }, f: { valor: null, fotoNova: false } }, observacao: null })).toEqual(["Calibragem: OK → (sem)"]);
  });
});

describe("D8: o cartão dos primeiros dias (regra)", async () => {
  const { passoPrimeirosDias, DIAS_PRIMEIROS } = await import("@/lib/tecnico/primeiros-dias");
  const agora = Date.parse("2027-01-10T12:00:00Z");
  const g = { desde: agora - 86_400_000 };
  const p = (o: Partial<Parameters<typeof passoPrimeirosDias>[0]>) => passoPrimeirosDias({ guardado: g, agora, instalado: false, iphone: false, push: "inativo", ...o });
  it("o passo que falta, na ordem: instalar (iPhone: o do Safari) → ativar; bloqueado diz onde liberar", () => {
    expect(p({ iphone: true, push: "instalar-iphone" })).toBe("instalar-iphone");
    expect(p({})).toBe("instalar");
    expect(p({ instalado: true })).toBe("ativar");
    expect(p({ instalado: true, push: "bloqueado" })).toBe("bloqueado");
  });
  it("some quando feito, dispensado, depois dos primeiros dias ou sem notificações no servidor", () => {
    expect(p({ instalado: true, push: "ativo" })).toBeNull();
    expect(p({ instalado: true, push: "sem-suporte" })).toBeNull();
    expect(p({ guardado: { ...g, dispensado: true } })).toBeNull();
    expect(p({ guardado: null })).toBeNull();
    expect(p({ push: "desligado" })).toBeNull();
    expect(p({ guardado: { desde: agora - DIAS_PRIMEIROS * 86_400_000 } })).toBe("instalar"); // o 7º dia ainda vale
    expect(p({ guardado: { desde: agora - DIAS_PRIMEIROS * 86_400_000 - 1 } })).toBeNull();
  });
});

describe("D9 e D11: os avisos do Meu dia (regras)", async () => {
  const m = await import("@/lib/tecnico/saiu-do-dia");
  it("D9: os ids que o aparelho manda: só de hoje, sem concluídas/canceladas; o servidor só aceita formato de id", () => {
    const guardado = { dia: "2027-01-10", atividades: [{ atividadeId: "a1", status: "AGENDADA" }, { atividadeId: "a2", status: "CONCLUIDA" }, { atividadeId: "a3", status: "EM_ANDAMENTO" }] };
    expect(m.idsParaConferir(guardado, "2027-01-10")).toEqual(["a1", "a3"]);
    expect(m.idsParaConferir(guardado, "2027-01-11")).toEqual([]);
    expect(m.idsParaConferir(null, "2027-01-10")).toEqual([]);
    expect(m.idsDoAntes(Array.from({ length: 80 }, (_, i) => `id${i}`).join(","))).toHaveLength(m.MAX_IDS_SAIDA);
    expect(m.idsDoAntes(" a1,a1,a3,'; drop,,x")).toEqual(["a1", "a3", "x"]);
    expect(m.idsDoAntes("a1,a1, a3 ,<script>")).toEqual(["a1", "a3"]);
    expect(m.idsDoAntes(null)).toEqual([]);
  });
  it("D9: por que saiu; o que o próprio técnico mudou não é aviso", () => {
    const base = { status: "AGENDADA", osStatus: "ABERTA", noMeuDia: false, doTecnico: true, diaAgendado: "2027-01-12", hoje: "2027-01-10", mudouPorMim: false };
    expect(m.motivoDaSaida(base)).toBe("reagendada");
    expect(m.motivoDaSaida({ ...base, status: "CANCELADA" })).toBe("cancelada");
    expect(m.motivoDaSaida({ ...base, osStatus: "CANCELADA" })).toBe("cancelada");
    expect(m.motivoDaSaida({ ...base, doTecnico: false })).toBe("outro-tecnico");
    expect(m.motivoDaSaida({ ...base, diaAgendado: "2027-01-10" })).toBe("retirada");
    expect(m.motivoDaSaida({ ...base, mudouPorMim: true })).toBeNull();
    expect(m.motivoDaSaida({ ...base, noMeuDia: true })).toBeNull();
    const s = (motivo: any, novaData: string | null = null) => m.textoSaida({ atividadeId: "a", osNumero: "OS-2603", motivo, novaData });
    expect(s("cancelada")).toBe("Saiu do seu dia: OS-2603 (cancelada pelo escritório)");
    expect(s("reagendada", "2027-01-12")).toBe("Saiu do seu dia: OS-2603 (reagendada pelo escritório para 12/01)");
    expect(s("reagendada")).toBe("Saiu do seu dia: OS-2603 (reagendada pelo escritório, ainda sem data)");
    expect(s("outro-tecnico")).toBe("Saiu do seu dia: OS-2603 (passou para outro técnico)");
    expect(s("retirada")).toBe("Saiu do seu dia: OS-2603 (retirada do seu dia pelo escritório)");
  });
  it("D9: as faixas guardadas: junta sem repetir; outro dia zera; Entendi tira só aquela", () => {
    const s1 = { atividadeId: "a1", osNumero: "OS-1", motivo: "cancelada" as const, novaData: null };
    const s2 = { ...s1, atividadeId: "a2", osNumero: "OS-2" };
    const g1 = m.juntarSaidas(null, "2027-01-10", [s1]);
    const g2 = m.juntarSaidas(g1, "2027-01-10", [s1, s2]);
    expect(g2.itens.map((x) => x.atividadeId)).toEqual(["a1", "a2"]);
    expect(m.juntarSaidas(g2, "2027-01-11", []).itens).toEqual([]);
    expect(m.dispensarSaida(g2, "a1").itens.map((x) => x.atividadeId)).toEqual(["a2"]);
  });
  it("D11: a notícia do aparelho: só id e número válidos; guarda os 5 mais recentes; o outro com gravação, nos últimos 14 dias", () => {
    expect(m.lerNoticia("abcd-1234-efgh", "3")).toEqual({ aparelho: "abcd-1234-efgh", pendentes: 3 });
    for (const [a, f] of [["curto", "3"], ["abcd-1234-efgh", "-1"], ["abcd-1234-efgh", "x"], [null, "1"], ["abcd-1234-efgh", null]] as const) expect(m.lerNoticia(a, f)).toBeNull();
    const t = (h: number) => new Date(Date.parse("2027-01-10T12:00:00Z") + h * 3_600_000);
    let mapa = m.comNoticia(null, "aparelho-AAAA", 4, t(0));
    mapa = m.comNoticia(mapa, "aparelho-BBBB", 0, t(1));
    expect(m.pendenciaNoOutro(mapa, "aparelho-BBBB", t(2))).toEqual({ pendentes: 4, em: t(0).toISOString() });
    expect(m.pendenciaNoOutro(mapa, "aparelho-AAAA", t(2))).toBeNull(); // o outro (B) não tem nada
    expect(m.pendenciaNoOutro(mapa, "aparelho-BBBB", t(24 * 15))).toBeNull(); // notícia velha
    expect(m.pendenciaNoOutro(m.comNoticia(mapa, "aparelho-AAAA", 0, t(3)), "aparelho-BBBB", t(4))).toBeNull(); // o antigo enviou
    for (let i = 0; i < 7; i++) mapa = m.comNoticia(mapa, `aparelho-${i}000`, 1, t(10 + i));
    expect(Object.keys(mapa)).toHaveLength(5);
    expect(m.comNoticia({ lixo: 1, "aparelho-CCCC": { n: "x" } }, "aparelho-DDDD", 2, t(0))).toEqual({ "aparelho-DDDD": { n: 2, em: t(0).toISOString() } });
  });
  it("D11: o texto, com e sem 'um aparelho só'", () => {
    const h = () => "hoje às 10:42";
    expect(m.textoOutroAparelho({ pendentes: 1, em: "x", umAparelho: true }, h)).toBe("O outro aparelho tem 1 gravação que ainda não subiu (última notícia dele: hoje às 10:42). Para não perder: abra o app nele com sinal e entre de novo; ele envia sozinho (ao entrar lá, este aparelho sai).");
    expect(m.textoOutroAparelho({ pendentes: 3, em: "x", umAparelho: false }, h)).toBe("O outro aparelho tem 3 gravações que ainda não subiram (última notícia dele: hoje às 10:42). Para não perder: abra o app nele com sinal; ele envia sozinho.");
  });
});
