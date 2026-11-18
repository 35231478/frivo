/**
 * Pausa de SLA por causa do cliente — PR A, as regras puras:
 *  - o VOCABULÁRIO da responsabilidade (três valores, rótulos e ajuda) e a sugestão por motivo;
 *  - a sugestão é só sugestão: o que vale é o valor GRAVADO, nunca o motivo nem o texto livre;
 *  - o que o servidor aceita ao justificar (motivo + responsabilidade + explicação em "Outro");
 *  - o GATILHO AMPLIADO: há o que justificar sempre que algum dos três prazos do relatório está
 *    descumprido (comparecer, resolver ou execução) ou há atividade atrasada;
 *  - `atrasoPorCausaDoCliente`: a única porta da pausa (e ela exige justificativa + classificação);
 *  - a TRAVA: ninguém deduz a responsabilidade de texto livre, o desempenho continua cego a ela, e
 *    o relatório do cliente (PR 5) ainda NÃO mudou — a pausa é do PR B.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  AJUDA_RESPONSABILIDADE_ATRASO, MOTIVOS_ATRASO, MSG_ATRASO_OUTRO, MSG_ATRASO_SEM_RESPONSAVEL,
  RESPONSABILIDADES_ATRASO, RESPONSABILIDADE_SUGERIDA, ROTULO_MOTIVO_ATRASO, ROTULO_RESPONSABILIDADE_ATRASO,
  atrasoJustificadoSchema, atrasoPorCausaDoCliente, haAtrasoParaJustificar, rotuloResponsabilidadeAtraso,
} from "@/lib/os/prazo-execucao";
import { estadosDosPrazos, haDescumprimentoParaJustificar } from "@/lib/prazos/cumprimento";

const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const dia = (data: string) => new Date(`${data}T00:00:00Z`);
const AGORA = br("2026-11-18", "15:00");
/** O chamado de 10/11 às 8h, com 4 h para comparecer e 24 h para resolver */
const CHAMADO = {
  chamadoAbertoEm: br("2026-11-10", "08:00"),
  atendimentoComparecerAte: br("2026-11-10", "12:00"),
  atendimentoResolverAte: br("2026-11-11", "08:00"),
};

/* ═════════ o vocabulário ═════════ */

describe("De quem foi a causa: o vocabulário", () => {
  it("são três, e só três, com rótulo e uma ajuda em português de gente", () => {
    expect(RESPONSABILIDADES_ATRASO).toEqual(["CLIENTE", "INTERNA", "TERCEIROS"]);
    expect(RESPONSABILIDADES_ATRASO.map((r) => ROTULO_RESPONSABILIDADE_ATRASO[r]))
      .toEqual(["Causa do cliente", "Causa interna", "Força maior ou terceiros"]);
    for (const r of RESPONSABILIDADES_ATRASO) expect(AJUDA_RESPONSABILIDADE_ATRASO[r].length, r).toBeGreaterThan(20);
    expect(rotuloResponsabilidadeAtraso("CLIENTE")).toBe("Causa do cliente");
    expect(rotuloResponsabilidadeAtraso(null)).toBe("");
    expect(rotuloResponsabilidadeAtraso("INVENTADO")).toBe("");
  });

  it("a sugestão por motivo cobre todos os motivos — e cala no que é ambíguo", () => {
    expect(Object.keys(RESPONSABILIDADE_SUGERIDA).sort()).toEqual([...MOTIVOS_ATRASO].sort());
    expect(RESPONSABILIDADE_SUGERIDA.CLIENTE_AUSENTE).toBe("CLIENTE");
    expect(RESPONSABILIDADE_SUGERIDA.ACESSO_NEGADO).toBe("CLIENTE");
    expect(RESPONSABILIDADE_SUGERIDA.CLIMA).toBe("TERCEIROS");
    // peça faltando pode ser falha nossa de estoque ou peça que o cliente ia comprar: ninguém adivinha
    expect(RESPONSABILIDADE_SUGERIDA.PECA_FALTANDO).toBeNull();
    expect(RESPONSABILIDADE_SUGERIDA.OUTRO).toBeNull();
    // e os motivos continuam os mesmos de antes (nada foi trocado de nome)
    expect(MOTIVOS_ATRASO.map((m) => ROTULO_MOTIVO_ATRASO[m]))
      .toEqual(["Cliente ausente", "Peça faltando", "Acesso ao local negado", "Chuva ou clima", "Outro motivo"]);
  });
});

/* ═════════ o que vale é o que foi gravado ═════════ */

describe("A pausa sai da marcação explícita, nunca de um palpite", () => {
  it("só pausa quem tem justificativa E a causa do cliente gravada", () => {
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: "ACESSO_NEGADO", atrasoResponsavel: "CLIENTE" })).toBe(true);
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: "ACESSO_NEGADO", atrasoResponsavel: "INTERNA" })).toBe(false);
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: "ACESSO_NEGADO", atrasoResponsavel: "TERCEIROS" })).toBe(false);
    // justificativa antiga (sem classificação): continua contando, como contava antes
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: "ACESSO_NEGADO", atrasoResponsavel: null })).toBe(false);
    // classificação sem justificativa não existe — e, se existisse, não pausaria nada
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: null, atrasoResponsavel: "CLIENTE" })).toBe(false);
  });

  it("o motivo NÃO decide: o mesmo 'cliente ausente' pausa ou não, conforme o que o gestor marcou", () => {
    const motivo = "CLIENTE_AUSENTE";
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: motivo, atrasoResponsavel: "CLIENTE" })).toBe(true);
    expect(atrasoPorCausaDoCliente({ atrasoJustificadoMotivo: motivo, atrasoResponsavel: "INTERNA" })).toBe(false);
  });
});

/* ═════════ o que o servidor aceita ═════════ */

describe("Justificar: o que o servidor aceita", () => {
  const ok = (d: unknown) => atrasoJustificadoSchema.safeParse(d);
  const erro = (d: unknown) => { const r = ok(d); return r.success ? "" : r.error.issues[0]!.message; };

  it("exige motivo da lista E a responsabilidade", () => {
    expect(ok({ motivo: "CLIENTE_AUSENTE", responsavel: "CLIENTE" }).success).toBe(true);
    expect(erro({ motivo: "CLIENTE_AUSENTE" })).toBe(MSG_ATRASO_SEM_RESPONSAVEL);
    expect(erro({ motivo: "CLIENTE_AUSENTE", responsavel: "" })).toBe(MSG_ATRASO_SEM_RESPONSAVEL);
    expect(erro({ motivo: "CLIENTE_AUSENTE", responsavel: "CULPA_DO_TEMPO" })).toBe(MSG_ATRASO_SEM_RESPONSAVEL);
    expect(erro({ responsavel: "CLIENTE" })).toBe("Escolha o motivo do atraso.");
    expect(erro({ motivo: "QUALQUER", responsavel: "CLIENTE" })).toBe("Escolha o motivo do atraso.");
  });

  it("\"razão é razão\" continua valendo: em Outro a explicação precisa dizer alguma coisa", () => {
    expect(erro({ motivo: "OUTRO", responsavel: "INTERNA", observacao: "x" })).toBe(MSG_ATRASO_OUTRO);
    expect(ok({ motivo: "OUTRO", responsavel: "INTERNA", observacao: "Equipe remanejada" }).success).toBe(true);
    expect(ok({ motivo: "CLIMA", responsavel: "TERCEIROS" }).success).toBe(true); // sem explicação, fora de "Outro"
  });

  it("os três valores passam, e a explicação continua limitada a 500 caracteres", () => {
    for (const r of RESPONSABILIDADES_ATRASO) expect(ok({ motivo: "CLIMA", responsavel: r }).success, r).toBe(true);
    expect(erro({ motivo: "CLIMA", responsavel: "CLIENTE", observacao: "a".repeat(501) })).toBe("Explicação com no máximo 500 caracteres.");
  });
});

/* ═════════ o gatilho ampliado ═════════ */

describe("Há o que justificar? A mesma régua do relatório", () => {
  it("chamado que estourou SÓ o comparecer (cliente não deu acesso) agora pode ser justificado", () => {
    const os = { ...CHAMADO, status: "CONCLUIDA", dataConclusao: br("2026-11-10", "18:00"), atendimentoComparecidoEm: br("2026-11-10", "14:00") };
    expect(estadosDosPrazos(os, AGORA)).toEqual({ comparecer: "DESCUMPRIDO", resolver: "CUMPRIDO", execucao: null });
    expect(haDescumprimentoParaJustificar(os, AGORA)).toBe(true);
    // antes era impossível: não há prazo de execução nem atividade atrasada
    expect(haAtrasoParaJustificar(os, AGORA)).toBe(false);
  });

  it("chamado que estourou SÓ o resolver também", () => {
    const os = { ...CHAMADO, status: "CONCLUIDA", atendimentoComparecidoEm: br("2026-11-10", "09:00"), dataConclusao: br("2026-11-12", "09:00") };
    expect(estadosDosPrazos(os, AGORA).resolver).toBe("DESCUMPRIDO");
    expect(haDescumprimentoParaJustificar(os, AGORA)).toBe(true);
    expect(haAtrasoParaJustificar(os, AGORA)).toBe(false);
  });

  it("o prazo de execução e a atividade atrasada continuam valendo (nada perdeu o gatilho)", () => {
    const execucao = { status: "CONCLUIDA", prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12") };
    expect(estadosDosPrazos(execucao, AGORA)).toEqual({ comparecer: null, resolver: null, execucao: "DESCUMPRIDO" });
    expect(estadosDosPrazos({ ...execucao, dataConclusao: br("2026-11-09") }, AGORA).execucao).toBe("CUMPRIDO");
    expect(haDescumprimentoParaJustificar(execucao, AGORA)).toBe(true);
    expect(haAtrasoParaJustificar(execucao, AGORA)).toBe(true);
    const atividade = { status: "EM_ANDAMENTO", atividades: [{ status: "CONCLUIDA", prazo: dia("2026-11-10"), dataAgendada: null, concluidaEm: br("2026-11-12") }] };
    expect(haDescumprimentoParaJustificar(atividade, AGORA)).toBe(true);
  });

  it("sem nada descumprido não há o que justificar: tudo cumprido, prazo ainda correndo, sem registro ou cancelada", () => {
    const tudoCumprido = { ...CHAMADO, status: "CONCLUIDA", atendimentoComparecidoEm: br("2026-11-10", "09:00"), dataConclusao: br("2026-11-10", "16:00"), prazoExecucao: dia("2026-11-11") };
    expect(haDescumprimentoParaJustificar(tudoCumprido, AGORA)).toBe(false);

    const correndo = { status: "EM_ANDAMENTO", prazoExecucao: dia("2026-11-25") };
    expect(haDescumprimentoParaJustificar(correndo, AGORA)).toBe(false);

    // encerrou sem "Cheguei": ninguém mediu, logo não é descumprimento (e não há o que justificar)
    const semRegistro = { ...CHAMADO, status: "CONCLUIDA", dataConclusao: br("2026-11-10", "18:00") };
    expect(estadosDosPrazos(semRegistro, AGORA).comparecer).toBe("SEM_REGISTRO");
    expect(estadosDosPrazos(semRegistro, AGORA).resolver).toBe("CUMPRIDO");
    expect(haDescumprimentoParaJustificar(semRegistro, AGORA)).toBe(false);

    const cancelada = { ...CHAMADO, status: "CANCELADA", prazoExecucao: dia("2026-11-10") };
    expect(haDescumprimentoParaJustificar(cancelada, AGORA)).toBe(false);
  });
});

/* ═════════ a trava ═════════ */

describe("A trava: a causa só entra por onde deve", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  const listar = (dir: string): string[] => readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listar(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
  const fontes = ["lib", "app", "components"].flatMap(listar);
  const ler = (arq: string) => readFileSync(path.join(RAIZ, arq), "utf8");
  const quemTem = (re: RegExp) => fontes.filter((f) => re.test(ler(f))).sort();

  const MOTOR = "lib/os/prazo-execucao.ts";
  const ROTA = "app/api/ordens/[id]/atraso-justificado/route.ts";
  const GAVETA = "components/os/central/atraso-justificado.tsx";
  const CABECALHO = "components/os/central/cabecalho-os.tsx";
  const EXPORT = "app/api/ordens/export/route.ts";

  it("a coluna da causa só é escrita na rota do atraso justificado — e lida por quem mostra", () => {
    // desde o PR B, o relatório também LÊ a coluna: o servidor a traz do banco e as regras a leem
    expect(quemTem(/atrasoResponsavel/)).toEqual(
      [EXPORT, ROTA, GAVETA, CABECALHO, MOTOR, "lib/prazos/cumprimento.ts", "lib/prazos/cumprimento-server.ts"].sort());
    // escrever, só ali: um ponto de gravação e um de limpeza
    const rota = ler(ROTA);
    expect(rota.match(/atrasoResponsavel: responsavel/g)).toHaveLength(1);
    expect(rota.match(/atrasoResponsavel: null/g)).toHaveLength(1);
    for (const f of [EXPORT, GAVETA, CABECALHO, "lib/prazos/cumprimento.ts", "lib/prazos/cumprimento-server.ts"]) {
      expect(ler(f), f).not.toMatch(/ordemServico\.(create|update|updateMany|upsert)\(/);
    }
    // no servidor do relatório a coluna aparece só no select: ele lê, não escreve
    expect(ler("lib/prazos/cumprimento-server.ts")).toMatch(/atrasoResponsavel: true,/);
  });

  it("ninguém deduz a causa do motivo nem do texto livre: a sugestão é da tela, a decisão é gravada", () => {
    // a única tabela motivo → causa é a sugestão, e ela mora no motor
    expect(quemTem(/RESPONSABILIDADE_SUGERIDA/)).toEqual([GAVETA, MOTOR].sort());
    // e o que decide a pausa olha a coluna, nunca o motivo nem a observação
    expect(ler(MOTOR)).toMatch(/os\.atrasoResponsavel === "CLIENTE"/);
    expect(quemTem(/atrasoJustificadoObs[^\n]*CLIENTE|CLIENTE[^\n]*atrasoJustificadoObs/)).toEqual([]);
  });

  it("o desempenho do colaborador continua cego à causa: lá o justificado já sai da métrica", () => {
    for (const f of fontes.filter((x) => x.startsWith("lib/desempenho/"))) {
      expect(ler(f), f).not.toMatch(/atrasoResponsavel|atrasoPorCausaDoCliente/);
    }
    expect(ler("lib/desempenho/regras.ts")).toMatch(/const justificado = os\.atrasoJustificadoMotivo \|\| null;/);
  });

  it("o relatório do cliente pausa pela MARCAÇÃO, e por nada mais (a conversão é do PR B)", () => {
    const regras = ler("lib/prazos/cumprimento.ts");
    // o denominador continua sendo o do PR 5: a pausa só TIRA dele, nunca o aumenta
    expect(regras).toMatch(/const medidos = \(c: Contagem\) => c\.cumpridos \+ c\.descumpridos;/);
    // quem decide a pausa é a porta do PR A, chamada num lugar só — nunca o motivo, nunca o texto livre
    expect(quemTem(/atrasoPorCausaDoCliente/)).toEqual([MOTOR, "lib/prazos/cumprimento.ts"].sort());
    expect(regras.match(/atrasoPorCausaDoCliente\(os\)/g)).toHaveLength(1);
    expect(regras).toMatch(/pausa && e === "DESCUMPRIDO" \? "CAUSA_CLIENTE" : e;/);
    // e o estado novo não vaza para quem só exibe (as regras do relatório travam isso em prazos-pr5)
    expect(quemTem(/CAUSA_CLIENTE/).filter((f) => f.startsWith("components/os/"))).toEqual([]);
  });

  it("o gatilho ampliado é um só, e quem justifica o usa", () => {
    expect(quemTem(/haDescumprimentoParaJustificar\(/)).toEqual([ROTA, GAVETA, "lib/prazos/cumprimento.ts"].sort());
    expect(ler(ROTA)).not.toMatch(/haAtrasoParaJustificar/); // a rota passou a usar a régua do relatório
  });
});
