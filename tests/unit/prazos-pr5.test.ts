/**
 * Prazos da OS — PR 5 (relatório de cumprimento de prazos), as regras puras:
 *  - OS TRÊS ESTADOS: cumprido, descumprido e sem registro — e a REGRA INEGOCIÁVEL de que o "sem
 *    registro" nunca é somado como descumprido nem entra no denominador do percentual;
 *  - o percentual: cumpridos sobre os MEDIDOS, "—" quando nada foi medido;
 *  - coerência com o resto do sistema: `execucaoNoPrazo` é o outro lado exato de `atrasosDaOs` (a
 *    régua de "atrasada" da lista, do sino e do desempenho) e o estado do atendimento é a tradução
 *    da situação que lib/atendimento/prazo já calcula;
 *  - a TRAVA: ninguém decide cumprido/descumprido nem refaz o percentual fora das libs únicas.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CONTAGEM_ZERO, ESTADOS, LEGENDA_ESTADO, NOTA_SEM_REGISTRO, PRAZOS, ROTULO_ESTADO, ROTULO_PRAZO,
  contar, estadoDaExecucao, estadoDoAtendimento, linhaDoCumprimento, linhaRelata, medidos,
  percentualCumprimento, resumoCumprimento, textoDaContagem, textoPercentual, total,
  type Contagem, type EstadoCumprimento, type LinhaCumprimento, type OsDoCumprimento,
} from "@/lib/prazos/cumprimento";
import { SITUACOES_ATENDIMENTO, atendimentoDaOs } from "@/lib/atendimento/prazo";
import { atrasosDaOs, execucaoNoPrazo, type OsParaAtraso } from "@/lib/os/prazo-execucao";

/** Um instante dito no relógio de Brasília (UTC−3) */
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
/** Um dia civil como o banco grava o prazo de execução (meia-noite UTC) */
const dia = (data: string) => new Date(`${data}T00:00:00Z`);
const AGORA = br("2026-11-18", "15:00");

/** A OS do relatório, só com o que cada caso precisa dizer (criada um dia antes da abertura do chamado) */
const OS = (o: Partial<OsDoCumprimento> = {}): OsDoCumprimento => ({
  id: "os1", numero: "OS-001", clienteNome: "Hospital Santa Luzia", status: "CONCLUIDA",
  criadoEm: br("2026-11-09", "07:00"), ...o,
});

/** O chamado de 10/11 às 8h com 4 h para comparecer e 24 h para resolver */
const CHAMADO = {
  chamadoNumero: "CH-1", chamadoAbertoEm: br("2026-11-10", "08:00"),
  atendimentoComparecerAte: br("2026-11-10", "12:00"), atendimentoResolverAte: br("2026-11-11", "08:00"),
};

/* ═════════ os três estados ═════════ */

describe("Os três estados — cumprido, descumprido e sem registro", () => {
  it("são três, e só três, com rótulo e legenda próprios (a tela e o PDF falam a mesma língua)", () => {
    expect(ESTADOS).toEqual(["CUMPRIDO", "DESCUMPRIDO", "SEM_REGISTRO"]);
    expect(ESTADOS.map((e) => ROTULO_ESTADO[e])).toEqual(["Cumprido", "Descumprido", "Sem registro"]);
    for (const e of ESTADOS) expect(LEGENDA_ESTADO[e].length, e).toBeGreaterThan(20);
    // a legenda do "sem registro" diz, ela mesma, que fica fora do percentual
    expect(LEGENDA_ESTADO.SEM_REGISTRO).toContain("fora do percentual");
  });

  it("o prazo de atendimento: cumprido é cumprido; estourado E cumprido fora do prazo são descumpridos; o que ainda corre não tem estado", () => {
    expect(estadoDoAtendimento("CUMPRIDO")).toBe("CUMPRIDO");
    expect(estadoDoAtendimento("CUMPRIDO_FORA")).toBe("DESCUMPRIDO");
    expect(estadoDoAtendimento("ESTOURADO")).toBe("DESCUMPRIDO");
    expect(estadoDoAtendimento("SEM_REGISTRO")).toBe("SEM_REGISTRO");
    // nada a relatar: o contrato não promete, ou o relógio ainda está correndo
    expect(estadoDoAtendimento("SEM_PRAZO")).toBeNull();
    expect(estadoDoAtendimento("NO_PRAZO")).toBeNull();
    expect(estadoDoAtendimento("VENCENDO")).toBeNull();
  });

  it("toda situação que a lib de atendimento sabe produzir tem resposta no relatório (nenhuma cai no vazio por esquecimento)", () => {
    for (const s of SITUACOES_ATENDIMENTO) {
      const e = estadoDoAtendimento(s);
      expect(e === null || ESTADOS.includes(e), s).toBe(true);
    }
  });

  it("o prazo de execução tem dois estados, nunca 'sem registro': a conclusão da OS é o registro", () => {
    const comPrazo = { prazoExecucao: dia("2026-11-12") };
    expect(estadoDaExecucao(OS({ ...comPrazo, dataConclusao: br("2026-11-12", "18:00") }), AGORA)).toBe("CUMPRIDO");
    expect(estadoDaExecucao(OS({ ...comPrazo, dataConclusao: br("2026-11-13", "09:00") }), AGORA)).toBe("DESCUMPRIDO");
    // concluída sem a data da conclusão (OS antiga): não há o que medir — e NÃO é "sem registro"
    expect(estadoDaExecucao(OS({ ...comPrazo, dataConclusao: null }), AGORA)).toBeNull();
    // em aberto com o prazo vencido já é descumprido (é o que a lista chama de atrasada)
    expect(estadoDaExecucao(OS({ ...comPrazo, status: "EM_ANDAMENTO" }), AGORA)).toBe("DESCUMPRIDO");
    // em aberto, dentro do prazo: a conta não fechou
    expect(estadoDaExecucao(OS({ prazoExecucao: dia("2026-11-25"), status: "EM_ANDAMENTO" }), AGORA)).toBeNull();
    // sem prazo e sem data prevista: não houve promessa
    expect(estadoDaExecucao(OS({ dataConclusao: br("2026-11-12") }), AGORA)).toBeNull();
    // cancelada: ninguém prometeu entregar o que foi cancelado
    expect(estadoDaExecucao(OS({ ...comPrazo, status: "CANCELADA" }), AGORA)).toBeNull();
    for (const e of PRAZOS.filter((p) => p === "execucao")) expect(ROTULO_PRAZO[e]).toBe("Prazo de execução");
  });

  it("a OS que encerrou sem ninguém tocar em 'Cheguei' fica SEM REGISTRO — não descumprida", () => {
    // concluída depois do limite de comparecer, sem comparecimento gravado: não se sabe quando chegou
    const l = linhaDoCumprimento(OS({ ...CHAMADO, dataConclusao: br("2026-11-10", "18:00") }), AGORA);
    expect(l.comparecer).toBe("SEM_REGISTRO");
    expect(l.resolver).toBe("CUMPRIDO"); // resolveu dentro das 24 h
    expect(l.numero).toBe("CH-1"); // o número que o cliente conhece
  });

  it("a OS cancelada com o prazo de atendimento em aberto também fica SEM REGISTRO", () => {
    const l = linhaDoCumprimento(OS({ ...CHAMADO, status: "CANCELADA", dataConclusao: null }), AGORA);
    expect([l.comparecer, l.resolver, l.execucao]).toEqual(["SEM_REGISTRO", "SEM_REGISTRO", null]);
  });

  it("uma linha com os três prazos decididos, cada um por si (comparecer cumprido, resolver estourado, execução descumprida)", () => {
    const l = linhaDoCumprimento(OS({
      ...CHAMADO,
      atendimentoComparecidoEm: br("2026-11-10", "10:30"), // chegou em 2 h 30: dentro das 4 h
      prazoExecucao: dia("2026-11-11"),
      dataConclusao: br("2026-11-12", "16:00"), // passou das 24 h de resolver e do dia do prazo
      atrasoJustificadoMotivo: "FALTA_DE_PECA",
    }), AGORA);
    expect([l.comparecer, l.resolver, l.execucao]).toEqual(["CUMPRIDO", "DESCUMPRIDO", "DESCUMPRIDO"]);
    expect(l.justificativa).toBe("FALTA_DE_PECA");
    expect(l.abertura.toISOString()).toBe(br("2026-11-10", "08:00").toISOString());
  });

  it("sem nenhum prazo decidido a linha não entra no relatório (não há o que relatar sobre ela)", () => {
    const semNada = linhaDoCumprimento(OS({ status: "EM_ANDAMENTO", numero: "OS-009" }), AGORA);
    expect([semNada.comparecer, semNada.resolver, semNada.execucao]).toEqual([null, null, null]);
    expect(linhaRelata(semNada)).toBe(false);
    expect(linhaRelata(linhaDoCumprimento(OS({ prazoExecucao: dia("2026-11-12"), dataConclusao: br("2026-11-12") }), AGORA))).toBe(true);
    // sem chamado, a abertura é a da OS
    expect(semNada.numero).toBe("OS-009");
    expect(semNada.abertura.toISOString()).toBe(br("2026-11-09", "07:00").toISOString());
  });
});

/* ═════════ a regra inegociável: o "sem registro" fora da conta ═════════ */

describe("A regra inegociável — o 'sem registro' nunca é descumprido e nunca entra no percentual", () => {
  const C = (cumpridos: number, descumpridos: number, semRegistro: number): Contagem => ({ cumpridos, descumpridos, semRegistro });

  it("contar separa os três; o denominador do percentual são só os MEDIDOS", () => {
    const c = contar(["CUMPRIDO", "CUMPRIDO", "DESCUMPRIDO", "SEM_REGISTRO", "SEM_REGISTRO", null, null]);
    expect(c).toEqual(C(2, 1, 2));
    expect(medidos(c)).toBe(3); // 2 + 1 — os 2 "sem registro" NÃO estão aqui
    expect(total(c)).toBe(5); // o relatório olhou 5 prazos
    expect(percentualCumprimento(c)).toBe(67); // 2/3, não 2/5
  });

  it("acrescentar casos SEM REGISTRO não muda o percentual em nada (nem um ponto)", () => {
    const base = C(9, 1, 0);
    expect(percentualCumprimento(base)).toBe(90);
    for (const n of [1, 5, 50, 500]) {
      expect(percentualCumprimento(C(9, 1, n)), `${n} sem registro`).toBe(90);
      expect(medidos(C(9, 1, n))).toBe(medidos(base));
    }
  });

  it("o 'sem registro' não é contado como descumprido em nenhum lugar: 100% com casos sem registro continua 100%", () => {
    const c = contar(["CUMPRIDO", "CUMPRIDO", "SEM_REGISTRO", "SEM_REGISTRO", "SEM_REGISTRO"]);
    expect(c.descumpridos).toBe(0);
    expect(percentualCumprimento(c)).toBe(100);
    expect(textoPercentual(c)).toBe("100%");
    // …e o número fica dito em voz alta, para o gestor cobrar o uso do "Cheguei"
    expect(textoDaContagem(c)).toBe("2 de 2 prazos cumpridos · 3 sem registro, fora da conta");
  });

  it("só casos SEM REGISTRO: nada foi medido, então o percentual é '—' (nunca 0%, que afirmaria um descumprimento)", () => {
    const c = contar(["SEM_REGISTRO", "SEM_REGISTRO"]);
    expect(medidos(c)).toBe(0);
    expect(percentualCumprimento(c)).toBeNull();
    expect(textoPercentual(c)).toBe("—");
    expect(textoDaContagem(c)).toBe("nenhum prazo medido · 2 sem registro, fora da conta");
  });

  it("o percentual arredonda ao inteiro e cobre os extremos", () => {
    expect(percentualCumprimento(CONTAGEM_ZERO())).toBeNull();
    expect(textoPercentual(CONTAGEM_ZERO())).toBe("—");
    expect(percentualCumprimento(C(0, 3, 0))).toBe(0); // medido e não atendido: 0% é verdade
    expect(percentualCumprimento(C(1, 1, 0))).toBe(50);
    expect(percentualCumprimento(C(2, 1, 0))).toBe(67);
    expect(percentualCumprimento(C(1, 2, 0))).toBe(33);
    expect(percentualCumprimento(C(1, 0, 0))).toBe(100);
    expect(textoDaContagem(C(1, 0, 0))).toBe("1 de 1 prazo cumprido");
    expect(textoDaContagem(C(5, 2, 0))).toBe("5 de 7 prazos cumpridos");
  });

  it("a frase que explica a exclusão existe e aparece na tela e no PDF (uma só, não duas versões)", () => {
    expect(NOTA_SEM_REGISTRO).toContain("fora do percentual");
    expect(NOTA_SEM_REGISTRO).toContain("não afirmamos um atraso que ninguém mediu");
  });
});

/* ═════════ o resumo do período ═════════ */

describe("O resumo do período — um quadro por prazo e o geral", () => {
  const linha = (comparecer: EstadoCumprimento | null, resolver: EstadoCumprimento | null, execucao: EstadoCumprimento | null, id = "x"): LinhaCumprimento => ({
    id, numero: id, clienteNome: "C", contratoNumero: null, abertura: AGORA, status: "CONCLUIDA", comparecer, resolver, execucao, justificativa: null,
  });

  it("cada prazo tem a sua conta, e o geral é a soma dos três — com o 'sem registro' à parte em todos", () => {
    const r = resumoCumprimento([
      linha("CUMPRIDO", "CUMPRIDO", "CUMPRIDO", "a"),
      linha("SEM_REGISTRO", "CUMPRIDO", "DESCUMPRIDO", "b"),
      linha("CUMPRIDO", "DESCUMPRIDO", null, "c"),
    ]);
    expect(r.comparecer).toEqual({ cumpridos: 2, descumpridos: 0, semRegistro: 1 });
    expect(r.resolver).toEqual({ cumpridos: 2, descumpridos: 1, semRegistro: 0 });
    expect(r.execucao).toEqual({ cumpridos: 1, descumpridos: 1, semRegistro: 0 });
    expect(r.geral).toEqual({ cumpridos: 5, descumpridos: 2, semRegistro: 1 });
    expect(r.linhas).toBe(3);
    // o geral é a soma dos três prazos, parcela por parcela — nenhuma conta paralela
    for (const campo of ["cumpridos", "descumpridos", "semRegistro"] as const) {
      expect(r.geral[campo], campo).toBe(PRAZOS.reduce((s, p) => s + r[p][campo], 0));
    }
    expect(percentualCumprimento(r.geral)).toBe(71); // 5/7
  });

  it("período sem nada: todas as contas em zero e o percentual em '—'", () => {
    const r = resumoCumprimento([]);
    for (const p of PRAZOS) expect(r[p], p).toEqual(CONTAGEM_ZERO());
    expect(r.geral).toEqual(CONTAGEM_ZERO());
    expect(r.linhas).toBe(0);
    expect(textoPercentual(r.geral)).toBe("—");
  });

  it("cada prazo tem nome próprio — 'prazo de atendimento' e 'prazo de execução' não se confundem", () => {
    expect(PRAZOS).toEqual(["comparecer", "resolver", "execucao"]);
    expect(new Set(PRAZOS.map((p) => ROTULO_PRAZO[p])).size).toBe(3);
    expect(ROTULO_PRAZO.execucao).toBe("Prazo de execução");
  });
});

/* ═════════ coerência de números com o resto do sistema ═════════ */

describe("Coerência — o relatório usa a MESMA régua da lista, do sino e do desempenho", () => {
  /** Os casos que o resto do sistema já julga; o relatório não pode discordar de nenhum */
  const CASOS: Array<Partial<OsParaAtraso> & { nota: string }> = [
    { nota: "concluída no dia do prazo", status: "CONCLUIDA", prazoExecucao: dia("2026-11-12"), dataConclusao: br("2026-11-12", "23:50") },
    { nota: "concluída no dia seguinte", status: "CONCLUIDA", prazoExecucao: dia("2026-11-12"), dataConclusao: br("2026-11-13", "00:10") },
    { nota: "concluída adiantada", status: "CONCLUIDA", prazoExecucao: dia("2026-11-12"), dataConclusao: br("2026-11-09") },
    { nota: "em aberto com prazo vencido", status: "EM_ANDAMENTO", prazoExecucao: dia("2026-11-12") },
    { nota: "em aberto dentro do prazo", status: "EM_ANDAMENTO", prazoExecucao: dia("2026-11-25") },
    { nota: "sem prazo próprio, vale o dia previsto (vencido)", status: "EM_ANDAMENTO", previsaoConclusao: dia("2026-11-10") },
    { nota: "sem prazo próprio, vale o dia previsto (cumprido)", status: "CONCLUIDA", previsaoConclusao: dia("2026-11-12"), dataConclusao: br("2026-11-11") },
    { nota: "sem prazo e sem previsão", status: "CONCLUIDA", dataConclusao: br("2026-11-11") },
    { nota: "concluída sem a data da conclusão", status: "CONCLUIDA", prazoExecucao: dia("2026-11-12") },
    { nota: "cancelada depois do prazo", status: "CANCELADA", prazoExecucao: dia("2026-11-10") },
    // reaberta: ainda carrega a data da conclusão antiga, mas a OS voltou a correr — nada fechou
    { nota: "reaberta, dentro do prazo, com a conclusão antiga", status: "EM_ANDAMENTO", prazoExecucao: dia("2026-11-25"), dataConclusao: br("2026-11-10") },
  ];

  it("'descumprido' no relatório é exatamente o que `atrasosDaOs` chama de atraso da OS — nem um caso diverge", () => {
    for (const { nota, ...os } of CASOS) {
      const atrasada = atrasosDaOs(os as OsParaAtraso, AGORA).os;
      expect(execucaoNoPrazo(os as OsParaAtraso, AGORA) === false, nota).toBe(atrasada);
      expect(estadoDaExecucao(os as OsParaAtraso, AGORA) === "DESCUMPRIDO", nota).toBe(atrasada);
    }
    expect(CASOS.map((c) => estadoDaExecucao(c as OsParaAtraso, AGORA))).toEqual([
      "CUMPRIDO", "DESCUMPRIDO", "CUMPRIDO", "DESCUMPRIDO", null, "DESCUMPRIDO", "CUMPRIDO", null, null, null, null,
    ]);
  });

  it("o estado do atendimento é a tradução do que `atendimentoDaOs` já calculou — a linha não recalcula nada", () => {
    const casos = [
      OS({ ...CHAMADO, atendimentoComparecidoEm: br("2026-11-10", "10:00"), dataConclusao: br("2026-11-10", "20:00") }),
      OS({ ...CHAMADO, atendimentoComparecidoEm: br("2026-11-10", "14:00"), dataConclusao: br("2026-11-12", "09:00") }),
      OS({ ...CHAMADO, status: "EM_ANDAMENTO" }), // em aberto com os dois limites já vencidos
      OS({ // chamado de agora: o relógio ainda corre, nada a relatar
        chamadoNumero: "CH-2", chamadoAbertoEm: br("2026-11-18", "14:00"), status: "EM_ANDAMENTO",
        atendimentoComparecerAte: br("2026-11-18", "18:00"), atendimentoResolverAte: br("2026-11-19", "14:00"),
      }),
      OS({ ...CHAMADO, dataConclusao: br("2026-11-10", "18:00") }),
      OS({ status: "CONCLUIDA", dataConclusao: br("2026-11-10") }), // sem promessa de atendimento
    ];
    for (const os of casos) {
      const { comparecer, resolver } = atendimentoDaOs(os, AGORA);
      const l = linhaDoCumprimento(os, AGORA);
      expect(l.comparecer).toBe(estadoDoAtendimento(comparecer.situacao));
      expect(l.resolver).toBe(estadoDoAtendimento(resolver.situacao));
    }
    expect(casos.map((os) => linhaDoCumprimento(os, AGORA).comparecer)).toEqual(["CUMPRIDO", "DESCUMPRIDO", "DESCUMPRIDO", null, "SEM_REGISTRO", null]);
    expect(casos.map((os) => linhaDoCumprimento(os, AGORA).resolver)).toEqual(["CUMPRIDO", "DESCUMPRIDO", "DESCUMPRIDO", null, "CUMPRIDO", null]);
  });

  it("o atraso justificado continua descumprido para o cliente — a justificativa é nota na linha, não perdão na conta", () => {
    const comum = { ...CHAMADO, prazoExecucao: dia("2026-11-11"), dataConclusao: br("2026-11-13", "10:00"), atendimentoComparecidoEm: br("2026-11-10", "09:00") };
    const sem = linhaDoCumprimento(OS(comum), AGORA);
    const com = linhaDoCumprimento(OS({ ...comum, atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoJustificadoObs: "portão fechado" }), AGORA);
    expect(sem.execucao).toBe("DESCUMPRIDO");
    expect(com.execucao).toBe("DESCUMPRIDO");
    expect([sem.justificativa, com.justificativa]).toEqual([null, "CLIENTE_AUSENTE"]);
    // e a conta do período é a mesma com e sem justificativa
    expect(resumoCumprimento([com]).geral).toEqual(resumoCumprimento([sem]).geral);
  });
});

/* ═════════ a trava: uma regra só, uma conta só ═════════ */

describe("Uma conta só: ninguém refaz o cumprimento nem o percentual por fora", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  const listar = (dir: string): string[] => readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listar(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const fontes = ["lib", "app", "components"].flatMap((dir) => listar(dir));
  const ler = (arq: string) => readFileSync(path.join(RAIZ, arq), "utf8");
  const quemTem = (trecho: string | RegExp) => fontes.filter((f) => (typeof trecho === "string" ? ler(f).includes(trecho) : trecho.test(ler(f)))).sort();

  const REGRAS = "lib/prazos/cumprimento.ts";
  const SERVIDOR = "lib/prazos/cumprimento-server.ts";
  const PDF = "lib/prazos/cumprimento-pdf.ts";
  const TELA = "components/prazos/cumprimento-client.tsx";
  const PAGINA = "app/(dashboard)/ordens/cumprimento/page.tsx";
  const ROTA = "app/api/relatorios/cumprimento-prazos/route.ts";
  /** Quem pode falar dos três estados: as regras e os três consumidores (servidor, tela, papel) */
  const DO_RELATORIO = [PAGINA, ROTA, TELA, REGRAS, SERVIDOR, PDF].sort();

  it("a tradução para os três estados mora num arquivo só", () => {
    expect(quemTem("estadoDoAtendimento(")).toEqual([REGRAS]);
    expect(quemTem("estadoDaExecucao(")).toEqual([REGRAS]);
    expect(quemTem("linhaDoCumprimento(")).toEqual([REGRAS, SERVIDOR].sort());
    // dentro do relatório, quem escreve o estado "SEM_REGISTRO" é só o arquivo das regras:
    // o servidor, a tela, o papel e as rotas recebem o estado já decidido
    expect(quemTem(/"SEM_REGISTRO"/).filter((f) => DO_RELATORIO.includes(f))).toEqual([REGRAS]);
  });

  it("o percentual sai de uma função só — a tela e o PDF não dividem nada por conta própria", () => {
    expect(quemTem("percentualCumprimento(")).toEqual([REGRAS]);
    expect(quemTem("medidos(")).toEqual([PDF, REGRAS, TELA].sort()); // só para dizer "nada medido", nunca para contar
    for (const arq of [TELA, PDF, SERVIDOR, PAGINA, ROTA]) {
      // nenhuma divisão, nenhum arredondamento de percentual e nenhuma soma de parcelas fora das regras
      expect(ler(arq), arq).not.toMatch(/Math\.round|\/\s*(total|base|medidos|linhas)\b|\*\s*100\b/);
      expect(ler(arq), arq).not.toMatch(/\.cumpridos\s*\+|\.descumpridos\s*\+/);
    }
  });

  it("o 'sem registro' não é somado ao descumprido em nenhum arquivo do relatório", () => {
    // em quem exibe, "semRegistro" é só um número a mostrar: nunca entra numa soma
    for (const arq of [SERVIDOR, PDF, TELA, PAGINA, ROTA]) {
      expect(ler(arq), arq).not.toMatch(/semRegistro\s*\+|\+\s*semRegistro|descumpridos\s*\+/);
    }
    // o denominador é escrito uma vez, e é só cumpridos + descumpridos
    expect(ler(REGRAS)).toMatch(/const medidos = \(c: Contagem\) => c\.cumpridos \+ c\.descumpridos;/);
    // nas regras, o "sem registro" entra numa soma só: a de quantos prazos o relatório OLHOU
    expect(ler(REGRAS).match(/\+\s*c\.semRegistro/g)).toEqual(["+ c.semRegistro"]);
    expect(ler(REGRAS)).toMatch(/const total = \(c: Contagem\) => medidos\(c\) \+ c\.semRegistro;/);
    // e o percentual divide pelos medidos, nunca pelo total
    expect(ler(REGRAS)).toMatch(/const base = medidos\(c\);\s*\n\s*return base === 0 \? null : Math\.round\(\(c\.cumpridos \/ base\) \* 100\);/);
  });

  it("o relatório LÊ as libs únicas: a regra de 'atrasada' continua em lib/os e a de atendimento em lib/atendimento", () => {
    expect(quemTem("execucaoNoPrazo(")).toEqual([REGRAS, "lib/os/prazo-execucao.ts"].sort());
    expect(ler(REGRAS)).toMatch(/import \{ atendimentoDaOs, type SituacaoAtendimento \} from "@\/lib\/atendimento\/prazo";/);
    // as regras do relatório não tocam no banco nem na comparação de datas do prazo
    expect(ler(REGRAS)).not.toMatch(/prisma|chaveDia|getTime\(\)|new Date\(\)\s*[<>]/);
    expect(ler(SERVIDOR)).not.toMatch(/atendimentoDaOs|situacaoAtendimento|prazoEfetivo/);
  });

  it("a tela e o PDF só exibem o que veio pronto (nenhum deles compara datas para decidir estado)", () => {
    for (const arq of [TELA, PDF]) {
      expect(ler(arq), arq).not.toMatch(/atendimentoDaOs|situacaoAtendimento|atrasosDaOs|prazoEfetivo|osAtrasada/);
      expect(ler(arq), arq).not.toMatch(/atendimentoComparecerAte|atendimentoComparecidoEm|prazoExecucao/);
    }
  });

  it("o PDF usa o motor de desenho da casa (pdf-lib via lib/pdf/desenho), não um caminho novo", () => {
    expect(ler(PDF)).toMatch(/import \{ C, Desenho, MARGEM \} from "@\/lib\/pdf\/desenho";/);
    expect(ler(ROTA)).toMatch(/respostaPdfArquivo\(/);
    expect(quemTem("gerarCumprimentoPdf(")).toEqual([PDF, ROTA].sort());
    // nenhum desenho à mão: a página, a fonte e o rodapé são do motor
    expect(ler(PDF)).not.toMatch(/drawText|drawRectangle|addPage\(/);
  });

  it("a permissão do relatório é a do módulo Relatórios, no servidor e no menu", () => {
    expect(ler(ROTA)).toMatch(/exigirPermissao\("relatorios", "exportar"\)/);
    expect(ler(PAGINA)).toMatch(/pode\(u\.permissoes, "relatorios", "visualizar", u\.role\)/);
    expect(ler(PAGINA)).toMatch(/podeExportar=\{pode\(u\.permissoes, "relatorios", "exportar", u\.role\)\}/);
    expect(ler("components/layout/sidebar.tsx")).toMatch(/href: "\/ordens\/cumprimento".*modulo: "relatorios", acao: "visualizar", somenteAcao: true/);
  });
});
