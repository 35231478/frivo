/**
 * DESPESAS RECORRENTES — P2 (telas): as regras puras que o formulário usa e as guardas das telas.
 *
 *  - o formulário abre com a frequência mensal, o dia do vencimento e o início sugerido;
 *  - o TÉRMINO escolhido manda só os campos dele: data manda a competência final, "N ocorrências"
 *    manda o número, "sem data" não manda nenhum dos dois (o servidor recusa os dois juntos);
 *  - uma regra que já existe volta inteira para o formulário e sai dele igual (ida e volta);
 *  - tudo que o formulário monta passa pela MESMA validação que a rota usa (validarRegra);
 *  - guardas: toda rota que mexe na regra exige "Financeiro › fluxo de caixa"; a tela de regras
 *    exige só visualizar para abrir, e esconde as ações de quem não pode mexer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  anosDoSeletor, corpoDaRecorrencia, formDaRegra, formRecorrenciaInicial, validarRegra,
  type FormRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

describe("o formulário da despesa recorrente (regras puras)", () => {
  it("abre mensal, com o dia do vencimento e o início sugerido (mês corrente se o dia ainda não passou)", () => {
    const antes = formRecorrenciaInicial({ ano: 2026, mes: 11, dia: 5 }, 10);
    expect([antes.frequencia, antes.diaVencimento, antes.inicioMes, antes.inicioAno]).toEqual(["MENSAL", "10", "11", "2026"]);
    // dia já passou: começa no mês seguinte
    const depois = formRecorrenciaInicial({ ano: 2026, mes: 11, dia: 20 }, 10);
    expect([depois.inicioMes, depois.inicioAno]).toEqual(["12", "2026"]);
    // dezembro vira janeiro do ano que vem
    expect(formRecorrenciaInicial({ ano: 2026, mes: 12, dia: 20 }, 10).inicioAno).toBe("2027");
    // sem dia escolhido, o dia de hoje
    expect(formRecorrenciaInicial({ ano: 2026, mes: 11, dia: 7 }).diaVencimento).toBe("7");
    // nasce sem término e com valor fixo
    expect([antes.termino, antes.fimAno, antes.ocorrencias, antes.valorEstimado]).toEqual(["INDEFINIDO", "", "", false]);
  });

  it("o término escolhido manda SÓ os campos dele", () => {
    const base = formRecorrenciaInicial({ ano: 2026, mes: 11, dia: 1 }, 10);
    const semData = corpoDaRecorrencia(base);
    expect([semData.fimAno, semData.fimMes, semData.ocorrencias]).toEqual([null, null, null]);

    // a pessoa preencheu a data, depois trocou para "N ocorrências": a data NÃO vai junto
    const confuso: FormRecorrencia = { ...base, termino: "OCORRENCIAS", fimAno: "2027", fimMes: "12", ocorrencias: "6" };
    const porNumero = corpoDaRecorrencia(confuso);
    expect([porNumero.fimAno, porNumero.fimMes, porNumero.ocorrencias]).toEqual([null, null, 6]);
    expect(validarRegra({ ...porNumero, descricao: "Aluguel", valor: 100 })).toBeNull();

    // e o contrário: por data, o número fica de fora
    const porData = corpoDaRecorrencia({ ...confuso, termino: "DATA" });
    expect([porData.fimAno, porData.fimMes, porData.ocorrencias]).toEqual([2027, 12, null]);
    expect(validarRegra({ ...porData, descricao: "Aluguel", valor: 100 })).toBeNull();
  });

  it("'a cada N meses' usa o passo digitado; as frequências nomeadas usam o passo delas", () => {
    const base = formRecorrenciaInicial({ ano: 2026, mes: 11, dia: 1 }, 10);
    expect(corpoDaRecorrencia({ ...base, frequencia: "TRIMESTRAL", passoMeses: "99" }).passoMeses).toBe(3);
    expect(corpoDaRecorrencia({ ...base, frequencia: "ANUAL" }).passoMeses).toBe(12);
    expect(corpoDaRecorrencia({ ...base, frequencia: "CUSTOM", passoMeses: "7" }).passoMeses).toBe(7);
  });

  it("uma regra que já existe volta inteira para o formulário e sai dele igual (ida e volta)", () => {
    const regra = {
      passoMeses: 3, diaVencimento: 15, ajusteDiaNaoUtil: "POSTERGAR",
      inicioAno: 2026, inicioMes: 11, fimAno: 2027, fimMes: 6, ocorrencias: null, situacao: "ATIVA", valorEstimado: true,
    };
    const form = formDaRegra(regra);
    expect([form.frequencia, form.termino, form.valorEstimado]).toEqual(["TRIMESTRAL", "DATA", true]);
    const volta = corpoDaRecorrencia(form);
    expect(volta).toMatchObject({
      passoMeses: 3, diaVencimento: 15, ajusteDiaNaoUtil: "POSTERGAR",
      inicioAno: 2026, inicioMes: 11, fimAno: 2027, fimMes: 6, ocorrencias: null, valorEstimado: true,
    });
    // passo que não é frequência nomeada volta como "a cada N meses", sem perder o N
    expect(formDaRegra({ ...regra, passoMeses: 5 }).frequencia).toBe("CUSTOM");
    expect(corpoDaRecorrencia(formDaRegra({ ...regra, passoMeses: 5 })).passoMeses).toBe(5);
    // término por número volta como número
    expect(formDaRegra({ ...regra, fimAno: null, fimMes: null, ocorrencias: 12 }).termino).toBe("OCORRENCIAS");
  });

  it("o que o formulário monta é recusado pela MESMA validação da rota quando está errado", () => {
    const base = formRecorrenciaInicial({ ano: 2026, mes: 11, dia: 1 }, 10);
    const com = (f: Partial<FormRecorrencia>, extra: object = {}) =>
      validarRegra({ ...corpoDaRecorrencia({ ...base, ...f }), descricao: "Aluguel", valor: 100, ...extra });
    expect(com({ diaVencimento: "0" })).toBe("Dia de vencimento: de 1 a 31.");
    expect(com({ diaVencimento: "32" })).toBe("Dia de vencimento: de 1 a 31.");
    expect(com({ frequencia: "CUSTOM", passoMeses: "0" })).toBe("Repetir a cada: de 1 a 60 meses.");
    expect(com({ frequencia: "CUSTOM", passoMeses: "61" })).toBe("Repetir a cada: de 1 a 60 meses.");
    expect(com({}, { valor: 0 })).toBe("Informe o valor de cada ocorrência.");
    expect(com({}, { descricao: "  " })).toBe("Descreva a despesa (ex.: Aluguel do galpão).");
    // término antes do início
    expect(com({ termino: "DATA", fimAno: "2026", fimMes: "10" })).toBe("O término não pode ser antes do início.");
    // o mês do término sem o ano (meio preenchido) não passa
    expect(com({ termino: "DATA", fimMes: "12", fimAno: "" })).toBe("Término: escolha uma data final, um número de ocorrências, ou deixe indefinido.");
  });

  it("o seletor de competência oferece do ano corrente até cinco à frente", () => {
    expect(anosDoSeletor(2026)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
  });
});

describe("guardas das telas da despesa recorrente", () => {
  it("toda rota que MEXE na regra exige Financeiro › fluxo de caixa; ler exige só visualizar", () => {
    const rotas: [string, string[]][] = [
      ["app/api/contas-pagar/recorrencias/route.ts", ['exigirPermissao("financeiro", "visualizar")', 'exigirPermissao("financeiro", "fluxoCaixa")']],
      ["app/api/contas-pagar/recorrencias/[id]/route.ts", ['exigirPermissao("financeiro", "visualizar")', 'exigirPermissao("financeiro", "fluxoCaixa")']],
      ["app/api/contas-pagar/recorrencias/[id]/acao/route.ts", ['exigirPermissao("financeiro", "fluxoCaixa")']],
      ["app/api/contas-pagar/[id]/pular/route.ts", ['exigirPermissao("financeiro", "fluxoCaixa")']],
      ["app/api/contas-pagar/[id]/tornar-recorrente/route.ts", ['exigirPermissao("financeiro", "fluxoCaixa")']],
    ];
    for (const [arquivo, exigencias] of rotas) {
      const src = ler(arquivo);
      for (const e of exigencias) expect(src, arquivo).toContain(e);
      // nenhuma rota de escrita deixa passar com só visualizar
      if (!arquivo.endsWith("acao/route.ts")) continue;
      expect(src, arquivo).not.toContain('"visualizar"');
    }
  });

  it("a rota que cria a regra exige o favorecido (fornecedor OU colaborador) e passa pela validação da casa", () => {
    const src = ler("app/api/contas-pagar/recorrencias/route.ts");
    expect(src).toContain("validarRegra(d)");
    expect(src).toContain("!d.fornecedorId && !d.tecnicoId");
    expect(src).toContain("Escolha o favorecido: um fornecedor ou um colaborador.");
    // a empresa da sessão manda em tudo (multiempresa)
    expect(src).toContain("guard.session.user.empresaId");
  });

  it("a tela de regras abre com visualizar e as ações só aparecem para quem pode mexer", () => {
    const pagina = ler("app/(dashboard)/financeiro/contas-pagar/recorrentes/page.tsx");
    expect(pagina).toContain('pode(u.permissoes, "financeiro", "visualizar", u.role)');
    expect(pagina).toContain('pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)');
    expect(pagina).toContain("redirect(\"/sem-permissao\")");
    // a lista é por empresa, sempre
    expect(pagina.match(/empresaId/g)?.length).toBeGreaterThan(3);

    const view = ler("components/financeiro/recorrentes-view.tsx");
    for (const acao of ["pausar", "retomar", "encerrar", "gerar", "editar"]) {
      const i = view.indexOf(`id="${acao}"`);
      expect(i, acao).toBeGreaterThan(0);
      // o item só é montado dentro de uma guarda de permissão (o trecho antes dele a declara)
      expect(view.slice(Math.max(0, i - 300), i), acao).toContain("podeMexer &&");
    }
    // as colunas do padrão cabem na tela: as secundárias nascem no menu "Colunas"
    for (const secundaria of ["termino", "categoria", "centro", "contas"]) {
      const i = view.indexOf(`id: "${secundaria}"`);
      expect(i, secundaria).toBeGreaterThan(0);
      expect(view.slice(i, i + 200), secundaria).toContain("oculta: true");
    }
    // ver as ocorrências é leitura: não depende de poder mexer
    expect(view).toMatch(/ItemMenu icone=\{Repeat\} onClick=\{\(\) => \{ f\(\); setVendo\(r\); \}\} id="ocorrencias"/);
  });

  it("a conta gerada continua independente: a lista e o detalhe só MOSTRAM o vínculo", () => {
    const view = ler("components/financeiro/contas-pagar-view.tsx");
    expect(view).toContain("data-selo-recorrente");
    expect(view).toContain("data-selo-estimado");
    // o filtro de origem ganhou a despesa recorrente, e o servidor é quem filtra
    expect(view).toContain('<option value="RECORRENTE">Despesa recorrente</option>');
    expect(ler("lib/listas/filtros.ts")).toContain('sp.origem === "RECORRENTE") where.recorrenciaId = { not: null }');
    // "Manual" passa a excluir as recorrentes (senão elas apareceriam como manuais)
    expect(ler("lib/listas/filtros.ts")).toMatch(/origem === "MANUAL"[^\n]*recorrenciaId = null/);
  });

  it("o cron diário empurra o horizonte das recorrentes junto com o dos contratos", () => {
    const cron = ler("app/api/cron/faturar-contratos/route.ts");
    expect(cron).toContain("rolarHorizonteDeRecorrentes()");
    expect(cron).toContain("CRON_SECRET");
  });
});
