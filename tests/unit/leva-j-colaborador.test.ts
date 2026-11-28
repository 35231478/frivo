/**
 * LEVA J — Colaborador: a regra pura.
 *  - a JORNADA em faixas: horas por dia (descontando o intervalo) e por semana, os erros de cada faixa, o dia que não
 *    pode estar em duas faixas, a leitura do que já está gravado (os campos antigos viram UMA faixa), a gravação (os
 *    campos antigos refeitos das faixas), o texto do contrato e a faixa nova;
 *  - a FUNÇÃO: "Usa o app de campo" + "Responsável técnico (ART/PMOC)" no lugar de "Tipo" + "Tipo de equipe";
 *  - as ESPECIALIDADES junto ao nome do técnico (OS, relatório, portal) e a chave da empresa;
 *  - as amarras: o schema da rota, as competências dos tipos de OS da empresa, as abas sem rolagem lateral, o SQL.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  faixaNova, faixasDoColaborador, gravarJornada, horasDaJornada, jornadaDoCorpo, jornadaValida, minutosDaFaixa, minutosDaHora,
  problemasDaJornada, textoDaJornada, textoHoras, type FaixaJornada,
} from "@/lib/colaborador/jornada";
import { funcaoDaFicha, gravarFuncao } from "@/lib/colaborador/funcao";
import { nomeComEspecialidades, textoEspecialidades, textoTecnicosAtividade } from "@/lib/atividade-equipe";
import { montarRelatorioOs, type OsParaRelatorio } from "@/lib/relatorio-os/dados";
import { tecnicoSchema } from "@/lib/validations";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");
const F = (dias: FaixaJornada["dias"], entrada: string, saida: string, ii: string | null = null, fi: string | null = null): FaixaJornada =>
  ({ dias, entrada, saida, intervaloInicio: ii, intervaloFim: fi });
const SEG_QUI = F(["SEG", "TER", "QUA", "QUI"], "07:30", "17:30", "12:00", "13:00");
const SEX = F(["SEX"], "07:30", "16:30", "12:00", "13:00");

describe("jornada: as horas", () => {
  it("hh:mm de 00:00 a 23:59; o resto é inválido", () => {
    expect(minutosDaHora("07:30")).toBe(450);
    expect(minutosDaHora("00:00")).toBe(0);
    expect(minutosDaHora("23:59")).toBe(1439);
    for (const h of ["24:00", "7:30", "07:60", "", null, undefined, "ab:cd"]) expect(minutosDaHora(h as string), String(h)).toBeNull();
  });
  it("um dia da faixa: saída − entrada − intervalo; sem intervalo, inteiro; inválida, null", () => {
    expect(minutosDaFaixa(SEG_QUI)).toBe(9 * 60);
    expect(minutosDaFaixa(SEX)).toBe(8 * 60);
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00"))).toBe(240);
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00", "", ""))).toBe(240);
    expect(minutosDaFaixa(F(["SAB"], "12:00", "08:00"))).toBeNull();
    expect(minutosDaFaixa(F(["SAB"], "08:00", "08:00"))).toBeNull();
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00", "11:00", null))).toBeNull();
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00", "11:00", "10:00"))).toBeNull();
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00", "07:00", "09:00"))).toBeNull();
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00", "11:00", "13:00"))).toBeNull();
    // o intervalo encostado nas pontas vale
    expect(minutosDaFaixa(F(["SAB"], "08:00", "12:00", "08:00", "12:00"))).toBe(0);
  });
  it("o contador: Seg–Qui 9h + Sex 8h = 44h; cada dia com as suas horas; faixa inválida não conta", () => {
    const h = horasDaJornada([SEG_QUI, SEX]);
    expect(h.porDia).toEqual({ SEG: 540, TER: 540, QUA: 540, QUI: 540, SEX: 480 });
    expect(h.semana).toBe(44 * 60);
    expect(horasDaJornada([SEG_QUI, F(["SAB"], "12:00", "08:00")]).semana).toBe(36 * 60);
    // o dia repetido conta uma vez só (a primeira faixa)
    expect(horasDaJornada([SEG_QUI, F(["QUI", "SEX"], "08:00", "10:00")]).porDia).toMatchObject({ QUI: 540, SEX: 120 });
    expect(horasDaJornada([]).semana).toBe(0);
  });
  it("o texto das horas", () => {
    expect(textoHoras(2640)).toBe("44h");
    expect(textoHoras(510)).toBe("8h30");
    expect(textoHoras(65)).toBe("1h05");
    expect(textoHoras(0)).toBe("0h");
  });
});

describe("jornada: o que está errado", () => {
  it("cada faixa diz o seu erro; certa, vazia", () => {
    expect(problemasDaJornada([SEG_QUI, SEX])).toEqual({ faixas: [[], []], geral: [] });
    const p = problemasDaJornada([
      F([], "08:00", "17:00"),
      F(["SEG"], "", "17:00"),
      F(["TER"], "17:00", "08:00"),
      F(["QUA"], "08:00", "17:00", "12:00", null),
      F(["QUI"], "08:00", "17:00", "13:00", "12:00"),
      F(["SEX"], "08:00", "17:00", "07:00", "08:30"),
      F(["SAB"], "08:00", "17:00", "1200", "13:00"),
    ]).faixas;
    expect(p).toEqual([
      ["Escolha os dias desta faixa."],
      ["Informe a entrada e a saída (hh:mm)."],
      ["A saída tem de ser depois da entrada."],
      ["Informe o início e o fim do intervalo (ou deixe os dois em branco)."],
      ["O fim do intervalo tem de ser depois do início."],
      ["O intervalo tem de ficar dentro do horário."],
      ["Intervalo inválido (hh:mm)."],
    ]);
  });
  it("um dia em duas faixas: o erro fica na segunda, dizendo qual é a outra", () => {
    const p = problemasDaJornada([SEG_QUI, F(["QUI", "SEX"], "08:00", "12:00")]);
    expect(p.faixas).toEqual([[], ["Qui já está na faixa 1."]]);
    expect(jornadaValida([SEG_QUI, F(["QUI", "SEX"], "08:00", "12:00")])).toBe(false);
    expect(jornadaValida([SEG_QUI, SEX])).toBe(true);
    expect(jornadaValida([])).toBe(true);
  });
  it("no máximo 7 faixas", () => {
    const oito = Array.from({ length: 8 }, () => F([], "08:00", "09:00"));
    expect(problemasDaJornada(oito).geral).toEqual(["No máximo 7 faixas."]);
  });
});

describe("jornada: compatível com o que está gravado", () => {
  it("sem faixas, a jornada antiga vira UMA faixa (sem intervalo), com os dias em ordem", () => {
    expect(faixasDoColaborador({ jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEX", "SEG", "XYZ"] }))
      .toEqual([F(["SEG", "SEX"], "08:00", "18:00")]);
    expect(faixasDoColaborador({ jornadaFaixas: null, jornadaEntrada: null, jornadaSaida: null, jornadaDias: [] })).toEqual([]);
    expect(faixasDoColaborador({ jornadaFaixas: [], jornadaEntrada: "08:00", jornadaSaida: "12:00", jornadaDias: ["SAB"] })).toEqual([F(["SAB"], "08:00", "12:00")]);
  });
  it("com faixas, elas mandam (e o lixo gravado é limpo)", () => {
    expect(faixasDoColaborador({ jornadaFaixas: [SEG_QUI, SEX], jornadaEntrada: "01:00", jornadaSaida: "02:00", jornadaDias: ["DOM"] })).toEqual([SEG_QUI, SEX]);
    expect(faixasDoColaborador({ jornadaFaixas: [null, 3, { dias: ["TER", "SEG", "X"], entrada: " 08:00", saida: "99:99", intervaloInicio: "" }] }))
      .toEqual([F(["SEG", "TER"], "08:00", "", null, null)]);
  });
  it("gravar: as faixas limpas e os campos antigos (os dias de todas, o horário da 1ª) para quem ainda os lê", () => {
    expect(gravarJornada([F(["QUI", "SEG"], " 07:30 ", "17:30", "12:00", " "), SEX])).toEqual({
      jornadaFaixas: [F(["SEG", "QUI"], "07:30", "17:30", "12:00", null), SEX],
      jornadaDias: ["SEG", "QUI", "SEX"], jornadaEntrada: "07:30", jornadaSaida: "17:30",
    });
    expect(gravarJornada([])).toEqual({ jornadaFaixas: null, jornadaDias: [], jornadaEntrada: null, jornadaSaida: null });
  });
  it("a rota: com faixas, elas mandam; sem (cliente antigo), valem os campos antigos e as faixas saem", () => {
    expect(jornadaDoCorpo({ jornadaFaixas: [SEX], jornadaEntrada: "01:00", jornadaDias: ["DOM"] })).toEqual(gravarJornada([SEX]));
    expect(jornadaDoCorpo({ jornadaEntrada: "08:00", jornadaSaida: "", jornadaDias: ["TER", "SEG"] }))
      .toEqual({ jornadaFaixas: null, jornadaEntrada: "08:00", jornadaSaida: null, jornadaDias: ["SEG", "TER"] });
  });
  it("o texto do contrato e dos documentos: cada faixa no formato de antes; a jornada antiga sai exatamente como saía", () => {
    expect(textoDaJornada([SEG_QUI, SEX])).toBe(
      "07:30 às 17:30, de segunda a quinta, com intervalo de 12:00 às 13:00; 07:30 às 16:30, sexta, com intervalo de 12:00 às 13:00 — 44h semanais");
    // uma faixa sem intervalo (a jornada antiga): o texto de sempre, sem as horas da semana
    expect(textoDaJornada([F(["SEG", "TER", "QUA", "QUI", "SEX"], "08:00", "18:00")])).toBe("08:00 às 18:00, de segunda a sexta");
    expect(textoDaJornada([F(["SEG", "QUA", "SEX"], "08:00", "12:00")])).toBe("08:00 às 12:00, segunda, quarta, sexta");
    // uma faixa com intervalo, ou mais de uma faixa: com as horas da semana
    expect(textoDaJornada([F(["SAB", "DOM"], "08:00", "12:00", "10:00", "10:30")])).toBe("08:00 às 12:00, sábado, domingo, com intervalo de 10:00 às 10:30 — 7h semanais");
    expect(textoDaJornada([F(["SEG", "TER"], "08:00", "12:00"), F(["SAB"], "08:00", "10:00")])).toBe("08:00 às 12:00, segunda, terça; 08:00 às 10:00, sábado — 10h semanais");
    expect(textoDaJornada([F(["SEG"], "", "")])).toBe("segunda");
    expect(textoDaJornada([F([], "", "")])).toBe("");
    expect(textoDaJornada([])).toBe("");
    // os documentos e o contrato usam este texto (não montam o seu)
    for (const f of ["lib/admissao/admissao-server.ts", "lib/admissao/admissao-entrega-server.ts", "lib/documentos/documentos-server.ts"])
      expect(ler(f), f).toContain("textoDaJornada(faixasDoColaborador(");
  });
  it("a faixa nova pega os dias úteis ainda livres, no horário comercial com almoço", () => {
    expect(faixaNova([SEG_QUI])).toEqual(F(["SEX"], "08:00", "17:00", "12:00", "13:00"));
    expect(faixaNova([SEG_QUI, SEX]).dias).toEqual([]);
    expect(faixaNova([]).dias).toEqual(["SEG", "TER", "QUA", "QUI", "SEX"]);
  });
  it("o schema da rota recusa faixa que se sobrepõe e aceita a certa (intervalo vazio vira nulo)", () => {
    const base = { nome: "Carlos Oliveira", cpf: "529.982.247-25", telefone: "(11) 3333-4444" };
    const ok = tecnicoSchema.safeParse({ ...base, jornadaFaixas: [{ ...SEG_QUI }, { ...SEX, intervaloInicio: "", intervaloFim: "" }] });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.jornadaFaixas?.[1]).toMatchObject({ intervaloInicio: null, intervaloFim: null });
    const ruim = tecnicoSchema.safeParse({ ...base, jornadaFaixas: [SEG_QUI, { ...SEX, dias: ["SEG"] }] });
    expect(ruim.success).toBe(false);
    expect(JSON.stringify(!ruim.success && ruim.error.flatten())).toContain("Faixa 2: Seg já está na faixa 1.");
    expect(tecnicoSchema.safeParse({ ...base, jornadaFaixas: [{ ...SEX, dias: ["FERIADO"] }] }).success).toBe(false);
    expect(tecnicoSchema.safeParse({ ...base, jornadaFaixas: [{ ...SEX, extra: 1 }] }).success).toBe(false);
  });
});

describe("função: dois conceitos no lugar de Tipo + Tipo de equipe", () => {
  it("a tela lê: campo = tipoEquipe CAMPO (sem valor, campo); RT = tipo RESPONSAVEL_TECNICO", () => {
    expect(funcaoDaFicha({ tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO" })).toEqual({ campo: true, rt: false });
    expect(funcaoDaFicha({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "ADMINISTRATIVO" })).toEqual({ campo: false, rt: true });
    expect(funcaoDaFicha({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" })).toEqual({ campo: false, rt: false });
    expect(funcaoDaFicha({})).toEqual({ campo: true, rt: false });
  });
  it("grava sempre coerente: RT manda no tipo; sem RT, o tipo segue o campo; Motorista/Outro ficam enquanto não forem RT", () => {
    expect(gravarFuncao({ campo: true, rt: false })).toEqual({ tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO" });
    expect(gravarFuncao({ campo: false, rt: false }, "TECNICO_CAMPO")).toEqual({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
    expect(gravarFuncao({ campo: true, rt: true })).toEqual({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO" });
    expect(gravarFuncao({ campo: false, rt: true }, "MOTORISTA")).toEqual({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "ADMINISTRATIVO" });
    expect(gravarFuncao({ campo: true, rt: false }, "MOTORISTA")).toEqual({ tipo: "MOTORISTA", tipoEquipe: "CAMPO" });
    expect(gravarFuncao({ campo: false, rt: false }, "OUTRO")).toEqual({ tipo: "OUTRO", tipoEquipe: "ADMINISTRATIVO" });
    expect(gravarFuncao({ campo: false, rt: false }, "RESPONSAVEL_TECNICO")).toEqual({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
  });
  it("ida e volta: o que a tela lê do que gravou é o que a pessoa marcou", () => {
    for (const campo of [true, false]) for (const rt of [true, false]) expect(funcaoDaFicha(gravarFuncao({ campo, rt }))).toEqual({ campo, rt });
  });
  it("os técnicos próximos passam a seguir o 'Usa o app de campo'", () => {
    expect(ler("app/api/tecnicos/proximos/route.ts")).toMatch(/tipoEquipe: "CAMPO"/);
  });
});

describe("especialidades junto ao nome do técnico", () => {
  it("'especialista em VRF e Chiller': sem repetir, sem vazias, até 4", () => {
    expect(textoEspecialidades(["VRF", "Chiller"])).toBe("especialista em VRF e Chiller");
    expect(textoEspecialidades(["Split"])).toBe("especialista em Split");
    expect(textoEspecialidades([" VRF ", "VRF", "", "Split", "Chiller", "Fan Coil", "Câmara Fria"])).toBe("especialista em VRF, Split, Chiller e Fan Coil");
    expect(textoEspecialidades([])).toBeNull();
    expect(textoEspecialidades(["  "])).toBeNull();
    expect(textoEspecialidades(null)).toBeNull();
  });
  it("o nome com elas; desligado ou sem nenhuma, só o nome", () => {
    expect(nomeComEspecialidades({ nome: "João Silva", especialidades: ["VRF", "Chiller"] })).toBe("João Silva — especialista em VRF e Chiller");
    expect(nomeComEspecialidades({ nome: "João Silva", especialidades: ["VRF"] }, false)).toBe("João Silva");
    expect(nomeComEspecialidades({ nome: "João Silva" })).toBe("João Silva");
  });
  const ativ = {
    tecnico: { nome: "João Silva", especialidades: ["VRF", "Chiller"] },
    tecnicosEquipe: [{ tecnico: { nome: "João Silva", especialidades: ["VRF", "Chiller"] } }, { tecnico: { nome: "Maria Souza", especialidades: [] } }],
    equipe: { nome: "Alfa" },
  };
  it("na atividade: com a chave, cada pessoa com as suas (ponto e vírgula entre pessoas); sem, como sempre foi", () => {
    expect(textoTecnicosAtividade(ativ, { especialidades: true })).toBe("Equipe Alfa: João Silva (responsável) — especialista em VRF e Chiller; Maria Souza");
    expect(textoTecnicosAtividade(ativ)).toBe("Equipe Alfa: João Silva (responsável), Maria Souza");
    expect(textoTecnicosAtividade(ativ, { especialidades: false })).toBe("Equipe Alfa: João Silva (responsável), Maria Souza");
    // ninguém com especialidade: o texto de sempre, mesmo com a chave ligada
    expect(textoTecnicosAtividade({ tecnico: { nome: "Ana" }, tecnicosEquipe: [{ tecnico: { nome: "Bia" } }] }, { especialidades: true })).toBe("Ana (responsável), Bia");
    expect(textoTecnicosAtividade({ equipe: { nome: "Equipe Beta" } }, { especialidades: true })).toBe("Equipe Beta");
  });
  it("no relatório da OS (PDF): a equipe com as especialidades quando a empresa mostra", () => {
    const os = {
      numero: "OS-777", status: "CONCLUIDA", descricao: "Preventiva", observacoes: null,
      criadoEm: new Date("2026-11-01T12:00:00Z"), dataInicio: null, dataConclusao: null, previsaoConclusao: null,
      empresa: { nome: "Clima Fictícia Ltda", nomeFantasia: null, cnpj: "11222333000181", email: null, telefone: null, logo: null },
      cliente: { nome: "Hospital Fictício", nomeFantasia: null, cpfCnpj: "12345678000199" },
      unidade: null, contrato: null, equipamento: null,
      atividades: [{ id: "a1", titulo: "Chiller", status: "CONCLUIDA", criadoEm: new Date(), dataAgendada: null, duracaoMin: null, observacao: null, resumo: null, respostas: [], equipamentos: [], respostasEquipamento: [], ...ativ }],
    } as unknown as OsParaRelatorio;
    expect(montarRelatorioOs(os, null, { especialidades: true }).equipe[0].tecnicos).toBe("Equipe Alfa: João Silva (responsável) — especialista em VRF e Chiller; Maria Souza");
    expect(montarRelatorioOs(os, null, { especialidades: false }).equipe[0].tecnicos).toBe("Equipe Alfa: João Silva (responsável), Maria Souza");
    expect(montarRelatorioOs(os, null).equipe[0].tecnicos).toBe("Equipe Alfa: João Silva (responsável), Maria Souza");
  });
  it("as três saídas leem a chave da empresa (padrão ligado): o relatório (interno e do cliente), a OS e o portal", () => {
    const dados = ler("lib/relatorio-os/dados.ts");
    expect(dados).toContain("return c?.mostrarEspecialidadesTecnico ?? true;");
    expect(dados.match(/montarRelatorioOs\(os, rel, \{ especialidades: await mostrarEspecialidades\(/g)).toHaveLength(2);
    // a OS desligada nem recebe as especialidades
    expect(ler("app/(dashboard)/ordens/[id]/page.tsx")).toMatch(/if \(!\(await mostrarEspecialidades\(empresaId\)\)\) \{[\s\S]{0,200}especialidades = \[\]/);
    expect(ler("app/(portal)/portal/(protegido)/chamados/[id]/page.tsx")).toMatch(/nomeComEspecialidades\(t, comEspecialidades\)/);
    expect(ler("prisma/schema.prisma")).toMatch(/mostrarEspecialidadesTecnico\s+Boolean\s+@default\(true\)\s+@map\("mostrar_especialidades_tecnico"\)/);
  });
});

describe("as amarras da tela", () => {
  const form = ler("components/forms/colaborador-form.tsx");
  it("as competências vêm dos tipos de OS da empresa (nenhuma lista fixa)", () => {
    expect(form).toContain('fetch("/api/tipos-os")');
    expect(form).not.toMatch(/COMPETENCIAS_(PADRAO|FIXAS)|"Preventiva", "Corretiva"/);
  });
  it("as abas quebram linha, sem rolagem lateral (como a ficha do cliente)", () => {
    const nav = form.slice(form.indexOf("<nav"), form.indexOf(">", form.indexOf("<nav")));
    expect(nav).toContain("flex-wrap");
    expect(nav).not.toMatch(/overflow-x|overflow-auto|scroll/);
  });
  it("a tela não oferece mais 'Tipo' nem 'Tipo de equipe' (as colunas continuam no banco)", () => {
    expect(form).not.toMatch(/label="Tipo( de equipe)?"/);
    expect(form).not.toMatch(/register\("tipo(Equipe)?"\)/);
    expect(ler("prisma/schema.prisma")).toMatch(/tipoEquipe\s+TipoEquipe/);
  });
  it("o SQL só acrescenta e é idempotente", () => {
    const sql = ler("prisma/sql/2027-02-13_colaborador_jornada_especialidades.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
  });
});
