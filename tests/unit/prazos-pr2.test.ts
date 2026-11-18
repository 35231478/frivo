/**
 * PRAZOS DA OS — PR 2 (prazo de execução nas telas): as regras puras.
 *  - o filtro "Prazo" da lista de OS (atrasadas, vencem hoje, com atraso justificado);
 *  - o que conta como atraso numa OS — da própria OS e das atividades, pelo MESMO dia de referência
 *    do desempenho — e, portanto, quando há o que justificar;
 *  - quem justifica (Desempenho › Revisar; nunca o técnico);
 *  - o prazo que o técnico vê no app (só quando alguém definiu um; calculado na hora);
 *  - o prazo padrão no cadastro do tipo de OS;
 *  - "/prazos" saiu do menu e a palavra "SLA" saiu da interface.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  FILTROS_PRAZO, ROTULO_FILTRO_PRAZO, atividadeAtrasou, atrasosDaOs, ehFiltroPrazo, haAtrasoParaJustificar, podeJustificarAtraso, prazoDefinido,
  prazoParaOTecnico, whereOsAtrasada, whereOsVenceHoje, wherePrazo,
} from "@/lib/os/prazo-execucao";
import { concluidaNoPrazo } from "@/lib/desempenho/regras";
import { PRESETS, montarPermissoes, permissoesTotais, permissoesVazias } from "@/lib/permissoes";
import { destinoDePrazos } from "@/lib/os/rota-prazos";
import { CADASTROS } from "@/lib/cadastros/registro";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
const arquivos = (dir: string): string[] => readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? arquivos(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
/** Um instante dito no relógio de Brasília (UTC−3) */
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const diaCivil = (data: string) => new Date(`${data}T00:00:00.000Z`);
const HOJE = br("2026-11-18", "15:00"); // quarta, 18/11/2026

describe("Lista de OS — o filtro Prazo", () => {
  it("três opções, com nome; valor desconhecido não filtra nada", () => {
    expect([...FILTROS_PRAZO]).toEqual(["atrasadas", "hoje", "justificadas"]);
    expect(FILTROS_PRAZO.map((f) => ROTULO_FILTRO_PRAZO[f])).toEqual(["Atrasadas", "Vencem hoje", "Com atraso justificado"]);
    expect([ehFiltroPrazo("atrasadas"), ehFiltroPrazo("ATRASADAS"), ehFiltroPrazo(""), ehFiltroPrazo(undefined)]).toEqual([true, false, false, false]);
    expect([wherePrazo(undefined, HOJE), wherePrazo("", HOJE), wherePrazo("qualquer", HOJE)]).toEqual([null, null, null]);
  });

  it("atrasadas = a regra única; justificadas = tem motivo gravado", () => {
    expect(wherePrazo("atrasadas", HOJE)).toEqual(whereOsAtrasada(HOJE));
    expect(wherePrazo("hoje", HOJE)).toEqual(whereOsVenceHoje(HOJE));
    expect(wherePrazo("justificadas", HOJE)).toEqual({ atrasoJustificadoMotivo: { not: null } });
  });

  it("atrasada no banco cobre a data prevista gravada como DIA e gravada com HORA (ontem às 22h de Brasília já é hoje em UTC)", () => {
    const w = whereOsAtrasada(HOJE);
    expect(w.status).toEqual({ notIn: ["CONCLUIDA", "CANCELADA"] });
    expect(w.OR).toEqual([
      { prazoExecucao: { lt: diaCivil("2026-11-18") } },
      // antes do começo de hoje em Brasília (03:00 UTC) — menos o valor que é o DIA de hoje
      { prazoExecucao: null, previsaoConclusao: { lt: new Date("2026-11-18T03:00:00.000Z"), not: diaCivil("2026-11-18") } },
    ]);
  });

  it("vence hoje no banco: o prazo é hoje, ou (sem prazo próprio) o dia previsto é hoje — como dia ou como instante de hoje em Brasília", () => {
    const w = whereOsVenceHoje(HOJE);
    expect(w.status).toEqual({ notIn: ["CONCLUIDA", "CANCELADA"] });
    expect(w.OR).toEqual([
      { prazoExecucao: diaCivil("2026-11-18") },
      { prazoExecucao: null, previsaoConclusao: diaCivil("2026-11-18") },
      { prazoExecucao: null, previsaoConclusao: { gte: new Date("2026-11-18T03:00:00.000Z"), lt: new Date("2026-11-19T03:00:00.000Z"), not: diaCivil("2026-11-19") } },
    ]);
  });
});

describe("Atraso justificado — o que conta como atraso", () => {
  it("atividade: o dia de referência é o prazo próprio ou, sem ele, o dia agendado; concluída atrasa se terminou depois; aberta, se o dia passou", () => {
    // aberta
    expect(atividadeAtrasou({ status: "AGENDADA", dataAgendada: br("2026-11-17", "09:00") }, HOJE)).toBe(true);
    expect(atividadeAtrasou({ status: "AGENDADA", dataAgendada: br("2026-11-18", "08:00") }, HOJE)).toBe(false); // é hoje: a hora passou, o dia não
    expect(atividadeAtrasou({ status: "EM_ANDAMENTO", dataAgendada: br("2026-11-10", "09:00"), prazo: diaCivil("2026-11-20") }, HOJE)).toBe(false); // o prazo próprio vence o agendamento
    expect(atividadeAtrasou({ status: "AGENDADA", dataAgendada: br("2026-11-25", "09:00"), prazo: diaCivil("2026-11-16") }, HOJE)).toBe(true);
    // concluída
    expect(atividadeAtrasou({ status: "CONCLUIDA", dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-10", "23:30") }, HOJE)).toBe(false);
    expect(atividadeAtrasou({ status: "CONCLUIDA", dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-11", "00:30") }, HOJE)).toBe(true);
    expect(atividadeAtrasou({ status: "CONCLUIDA", dataAgendada: br("2026-11-10", "09:00"), concluidaEm: null }, HOJE)).toBe(false); // sem data de conclusão não dá para dizer
    // não atrasam
    expect(atividadeAtrasou({ status: "CANCELADA", dataAgendada: br("2026-11-01", "09:00") }, HOJE)).toBe(false);
    expect(atividadeAtrasou({ status: "AGENDADA" }, HOJE)).toBe(false); // sem prazo nem agendamento
  });

  it("é a MESMA conta do desempenho: toda atividade concluída que o escore conta como \"fora do prazo\" é atraso aqui (e só elas)", () => {
    const casos = [
      { prazo: null, dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-10", "18:00") },
      { prazo: null, dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-12", "08:00") },
      { prazo: diaCivil("2026-11-15"), dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-15", "22:00") },
      { prazo: diaCivil("2026-11-15"), dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-16", "07:00") },
      { prazo: null, dataAgendada: null, concluidaEm: br("2026-11-16", "07:00") },
    ];
    for (const a of casos) expect(atividadeAtrasou({ status: "CONCLUIDA", ...a }, HOJE), JSON.stringify(a)).toBe(concluidaNoPrazo(a) === false);
  });

  it("OS: aberta com o prazo vencido, ou concluída depois do prazo; cancelada nunca; e conta as atividades atrasadas", () => {
    const noDia = { status: "AGENDADA", dataAgendada: br("2026-11-20", "09:00") };
    expect(atrasosDaOs({ status: "AGENDADA", prazoExecucao: diaCivil("2026-11-17"), atividades: [noDia] }, HOJE)).toEqual({ os: true, atividades: 0 });
    expect(atrasosDaOs({ status: "AGENDADA", prazoExecucao: diaCivil("2026-11-18") }, HOJE)).toEqual({ os: false, atividades: 0 }); // vence hoje
    // OS antiga: sem prazo próprio, vale o dia previsto
    expect(atrasosDaOs({ status: "ABERTA", previsaoConclusao: br("2026-11-16", "10:00") }, HOJE).os).toBe(true);
    // concluída: no prazo × depois do prazo (pelo dia de Brasília da conclusão)
    expect(atrasosDaOs({ status: "CONCLUIDA", prazoExecucao: diaCivil("2026-11-10"), dataConclusao: br("2026-11-10", "23:00") }, HOJE).os).toBe(false);
    expect(atrasosDaOs({ status: "CONCLUIDA", prazoExecucao: diaCivil("2026-11-10"), dataConclusao: br("2026-11-11", "08:00") }, HOJE).os).toBe(true);
    expect(atrasosDaOs({ status: "CONCLUIDA", dataConclusao: br("2026-11-11", "08:00") }, HOJE).os).toBe(false); // sem prazo nem previsão
    // a OS no prazo, mas duas atividades atrasaram (uma aberta, uma concluída tarde); a cancelada não conta
    const os = { status: "EM_ANDAMENTO", prazoExecucao: diaCivil("2026-11-30"), atividades: [
      { status: "AGENDADA", dataAgendada: br("2026-11-12", "09:00") },
      { status: "CONCLUIDA", dataAgendada: br("2026-11-10", "09:00"), concluidaEm: br("2026-11-13", "09:00") },
      { status: "CANCELADA", dataAgendada: br("2026-11-01", "09:00") },
      noDia,
    ] };
    expect(atrasosDaOs(os, HOJE)).toEqual({ os: false, atividades: 2 });
    expect(atrasosDaOs({ ...os, status: "CANCELADA", prazoExecucao: diaCivil("2026-11-01") }, HOJE)).toEqual({ os: false, atividades: 0 });
  });

  it("há o que justificar quando a OS OU alguma atividade atrasou; sem atraso, não", () => {
    expect(haAtrasoParaJustificar({ status: "AGENDADA", prazoExecucao: diaCivil("2026-11-17") }, HOJE)).toBe(true);
    expect(haAtrasoParaJustificar({ status: "AGENDADA", prazoExecucao: diaCivil("2026-11-30"), atividades: [{ status: "AGENDADA", dataAgendada: br("2026-11-12", "09:00") }] }, HOJE)).toBe(true);
    expect(haAtrasoParaJustificar({ status: "AGENDADA", prazoExecucao: diaCivil("2026-11-30"), atividades: [{ status: "AGENDADA", dataAgendada: br("2026-11-20", "09:00") }] }, HOJE)).toBe(false);
    expect(haAtrasoParaJustificar({ status: "CANCELADA", prazoExecucao: diaCivil("2026-11-01") }, HOJE)).toBe(false);
  });
});

describe("Atraso justificado — quem justifica", () => {
  it("só quem tem Desempenho › Revisar (e o administrador): supervisor, técnico e auxiliar dos perfis padrão NÃO", () => {
    expect(podeJustificarAtraso(montarPermissoes({ ordens: ["visualizar"], desempenho: ["visualizar", "revisar"] }), "OPERADOR")).toBe(true);
    expect(podeJustificarAtraso(permissoesTotais(), "OPERADOR")).toBe(true);
    expect(podeJustificarAtraso(permissoesVazias(), "ADMIN")).toBe(true);
    // ver o desempenho não basta; mexer em tudo da OS também não
    expect(podeJustificarAtraso(montarPermissoes({ ordens: ["visualizar", "criar", "editar", "concluir", "excluir"], desempenho: ["visualizar"] }), "OPERADOR")).toBe(false);
    for (const perfil of ["SUPERVISOR", "TECNICO", "AUXILIAR", "FINANCEIRO"]) expect(podeJustificarAtraso(PRESETS[perfil], "OPERADOR"), perfil).toBe(false);
    expect(podeJustificarAtraso(PRESETS.TECNICO, "TECNICO")).toBe(false);
    expect(podeJustificarAtraso(null, "OPERADOR")).toBe(false);
  });

  it("a rota confere a permissão no servidor e bloqueia o painel para o técnico", () => {
    const rota = fonte("app/api/ordens/[id]/atraso-justificado/route.ts");
    expect(rota).toContain("bloqueioPainelTecnico(session)");
    expect(rota).toContain("podeJustificarAtraso(session.user!.permissoes as Permissoes, session.user!.role)");
    expect(rota).toContain("where: { id, empresaId: session.user!.empresaId }");
  });
});

describe("App do técnico — o prazo no cartão", () => {
  it("o prazo definido é o da atividade ou o da OS — o mais próximo; sem nenhum, não há prazo a mostrar", () => {
    expect(prazoDefinido({ prazoAtividade: diaCivil("2026-11-20"), prazoOs: diaCivil("2026-11-25") })).toBe("2026-11-20");
    expect(prazoDefinido({ prazoAtividade: diaCivil("2026-11-28"), prazoOs: diaCivil("2026-11-25") })).toBe("2026-11-25");
    expect(prazoDefinido({ prazoOs: diaCivil("2026-11-25") })).toBe("2026-11-25");
    expect(prazoDefinido({ prazoAtividade: diaCivil("2026-11-20"), prazoOs: null })).toBe("2026-11-20");
    expect(prazoDefinido({ prazoAtividade: null, prazoOs: null })).toBeNull();
  });

  it("o selo é calculado na hora de mostrar: no prazo → vence hoje → atrasada; concluída e cancelada não mostram", () => {
    const sel = (prazo: string | null, status = "AGENDADA", agora = HOJE) => prazoParaOTecnico({ statusAtividade: status, prazo }, agora);
    expect(sel("2026-11-25")).toEqual({ dia: "2026-11-25", situacao: "NO_PRAZO", texto: "Faltam 7 dias" });
    expect(sel("2026-11-18")).toMatchObject({ situacao: "VENCE_HOJE", texto: "Vence hoje" });
    expect(sel("2026-11-16")).toMatchObject({ situacao: "ATRASADO", texto: "Atrasada 2 dias" });
    // o MESMO cartão guardado no aparelho muda de situação com o passar dos dias
    expect(sel("2026-11-18", "AGENDADA", br("2026-11-17", "23:00"))).toMatchObject({ situacao: "NO_PRAZO", texto: "Vence amanhã" });
    expect(sel("2026-11-18", "AGENDADA", br("2026-11-19", "00:30"))).toMatchObject({ situacao: "ATRASADO" });
    expect([sel("2026-11-16", "CONCLUIDA"), sel("2026-11-16", "CANCELADA"), sel(null), sel("")]).toEqual([null, null, null, null]);
    expect(sel("2026-11-16", "EM_ANDAMENTO")).toMatchObject({ situacao: "ATRASADO" });
  });
});

describe("Tipo de OS — o prazo padrão no cadastro", () => {
  const tipo = CADASTROS["tipos-os"];
  const criar = (extra: Record<string, unknown>) => tipo.schemaCriar.safeParse({ nome: "Corretiva", ...extra });
  const editar = (v: unknown) => tipo.schemaEditar.safeParse({ prazoExecucaoDias: v });
  const erro = (r: ReturnType<typeof editar>) => (r.success ? null : r.error.issues[0].message);

  it("o campo existe no formulário e na lista, com a explicação", () => {
    const campo = tipo.campos.find((c) => c.key === "prazoExecucaoDias")!;
    expect(campo).toMatchObject({ label: "Prazo padrão (dias)", tipo: "inteiro" });
    expect(campo.ajuda).toMatch(/a partir do dia agendado/);
    expect(campo.ajuda).toMatch(/0 = no próprio dia agendado/);
    expect(tipo.colunas.map((c) => c.key)).toContain("prazoExecucaoDias");
  });

  it("o formulário manda texto: \"3\" grava 3; vazio grava sem padrão; 0 é o próprio dia; fora de 0 a 365, inteiro, é recusado", () => {
    expect(criar({}).success && (criar({}) as any).data.prazoExecucaoDias).toBeNull(); // sem o campo: sem padrão
    expect((criar({ prazoExecucaoDias: "3" }) as any).data.prazoExecucaoDias).toBe(3);
    expect((editar("") as any).data.prazoExecucaoDias).toBeNull();
    expect((editar(null) as any).data.prazoExecucaoDias).toBeNull();
    expect((editar("0") as any).data.prazoExecucaoDias).toBe(0);
    expect((editar(365) as any).data.prazoExecucaoDias).toBe(365);
    expect(erro(editar("-1"))).toBe("Prazo padrão: não pode ser negativo.");
    expect(erro(editar("366"))).toBe("Prazo padrão: no máximo 365 dias.");
    expect(erro(editar("1.5"))).toBe("Prazo padrão: use dias inteiros.");
    expect(erro(editar("abc"))).toBe("Prazo padrão: informe um número de dias.");
  });
});

describe("Menu e vocabulário", () => {
  it("\"Prazos e SLA\" saiu do menu; o endereço antigo leva às OS atrasadas — ou, com o filtro da tela antiga, às etapas com prazo", () => {
    expect(fonte("components/layout/sidebar.tsx")).not.toMatch(/"\/prazos"|Prazos e SLA/);
    expect(destinoDePrazos({})).toBe("/ordens?prazo=atrasadas");
    expect(destinoDePrazos({ pagina: "2" })).toBe("/ordens?prazo=atrasadas"); // página sozinha não é filtro da tela antiga
    expect(destinoDePrazos({ status: "ATRASADO" })).toBe("/ordens/etapas?status=ATRASADO");
    expect(destinoDePrazos({ status: "ATIVO", templateId: "t1", pagina: "3", lixo: "x" })).toBe("/ordens/etapas?status=ATIVO&templateId=t1&pagina=3");
    expect(fonte("app/(dashboard)/prazos/page.tsx")).toContain("redirect(destinoDePrazos(await searchParams));");
    // o acompanhamento das etapas continua existindo, sem menu, com o sino e o dashboard apontando para ele
    expect(fonte("app/(dashboard)/ordens/etapas/page.tsx")).toContain("Etapas com prazo");
    expect(fonte("components/layout/header.tsx")).toContain('href="/ordens/etapas?status=ATRASADO"');
    expect(fonte("components/dashboard/blocos.tsx")).toContain('href="/ordens/etapas"');
  });

  it("o sino e o dashboard levam \"atrasadas\" para a lista JÁ filtrada (antes abriam a lista inteira)", () => {
    expect(fonte("components/layout/header.tsx")).toContain('href="/ordens?prazo=atrasadas" icone={Timer} cor="text-atrasado" label="OS atrasadas"');
    expect(fonte("components/dashboard/blocos.tsx")).toContain('href="/ordens?prazo=atrasadas"');
  });

  it("os \"modelos de prazo\" viraram \"Etapas com prazo\" em Configurações, na OS e nas mensagens do cadastro", () => {
    expect(fonte("lib/navegacao/configuracoes.ts")).toContain('label: "Etapas com prazo"');
    expect(CADASTROS["modelos-prazo"]).toMatchObject({ singular: "modelo de etapas", plural: "modelos de etapas" });
    expect(fonte("components/os/os-prazos.tsx")).toContain("Etapas com prazo</h3>");
  });

  it("a palavra \"SLA\" não aparece mais na interface (fora da proposta de contrato, que é do PR 4)", () => {
    // texto que vai para a tela: fora de comentário e fora de nome de variável/atributo
    const naTela = (linha: string) => {
      const semComentario = linha.replace(/\/\/.*$/, "").replace(/\{\/\*.*?\*\/\}/g, "").replace(/^\s*\*.*$/, "").replace(/\/\*.*?\*\//g, "");
      return /\bSLA\b/.test(semComentario);
    };
    const DA_PROPOSTA = /proposta/i;
    const achados = ["app", "components", "lib"].flatMap(arquivos).filter((f) => !DA_PROPOSTA.test(f))
      .flatMap((f) => fonte(f).split("\n").map((l, i) => (naTela(l) && !DA_PROPOSTA.test(l) ? `${f}:${i + 1}` : null)).filter(Boolean));
    expect(achados).toEqual([]);
  });
});
