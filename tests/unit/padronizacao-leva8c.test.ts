/**
 * Leva 8C — Financeiro (custo de pessoal e fiscal): guardas de FONTE.
 *
 * O que não pode voltar com um "refactor distraído":
 *  - tudo que mostra salário, encargos ou mexe na folha exige Financeiro › Custo de pessoal, e o
 *    emitente de NFS-e e a central de notas exigem Financeiro › Fiscal (a tela do emitente trava
 *    dentro de TelaDadosFiscais, que a rota do Financeiro e a gaveta de Configurações reusam);
 *  - a lista do custo de pessoal é a tabela da casa (colunas escolhíveis, cartões no celular),
 *    sem <table> à mão e sem rodapé de totais;
 *  - sucesso é toast; o erro continua na tela;
 *  - ⓘ no título, nenhuma instrução solta em parágrafo, plural escrito;
 *  - folha e NFS-e são razão: nenhuma tela ou rota apaga a foto do mês nem a nota emitida, e o
 *    cálculo da folha e a emissão continuam nos mesmos módulos (a leva não tocou neles).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const LISTA = "app/(dashboard)/financeiro/custo-pessoal/page.tsx";
const FICHA = "app/(dashboard)/financeiro/custo-pessoal/colaborador/[id]/page.tsx";
const IMPORTAR = "app/(dashboard)/financeiro/custo-pessoal/importar/page.tsx";
const ENCARGOS = "app/(dashboard)/financeiro/custo-pessoal/encargos/page.tsx";
const FISCAL = "app/(dashboard)/financeiro/fiscal/page.tsx";
const NOTAS = "app/(dashboard)/financeiro/notas-fiscais/page.tsx";

const FECHAR = "components/folha/fechar-mes.tsx";
const FOLHA_COLAB = "components/folha/folha-colaborador.tsx";
const PLANILHA_UI = "components/folha/importar-planilha.tsx";
const EMITENTE = "components/fiscal/dados-fiscais-client.tsx";
const CENTRAL = "components/fiscal/notas-central.tsx";

const TELAS = [LISTA, FICHA, IMPORTAR, ENCARGOS, FISCAL, NOTAS];
const COMPONENTES = [FECHAR, FOLHA_COLAB, PLANILHA_UI, EMITENTE, CENTRAL];
const TRAVA = (acao: string) => `"financeiro", "${acao}"`;

describe("prioridade 1: quem não pode, não vê o botão", () => {
  it("toda tela de custo de pessoal exige Financeiro › Custo de pessoal e manda para /sem-permissao", () => {
    for (const arq of [LISTA, FICHA, IMPORTAR, ENCARGOS]) {
      const src = ler(arq);
      expect(src, arq).toContain(TRAVA("folha"));
      expect(src, arq).toContain('redirect("/sem-permissao")');
    }
  });

  it("a central de notas e a tela do emitente exigem Financeiro › Fiscal", () => {
    // a central trava na própria página; o emitente, no componente que as duas rotas reusam
    for (const arq of [NOTAS, "components/config/telas/dados-fiscais.tsx"]) {
      const src = ler(arq);
      expect(src, arq).toContain(TRAVA("fiscal"));
      expect(src, arq).toContain('redirect("/sem-permissao")');
    }
    // a rota do Financeiro é só a casca: se deixar de usar a tela travada, este teste cai
    expect(ler(FISCAL)).toContain("<TelaDadosFiscais");
  });

  it("a gaveta de Configurações pede a mesma permissão da tela do Financeiro", () => {
    const nav = ler("lib/navegacao/configuracoes.ts");
    expect(nav).toMatch(/id: "dados-fiscais".*modulo: "financeiro", acao: "fiscal"/);
  });

  it("cada rota de folha e de NFS-e confere a permissão antes de ler o banco", () => {
    for (const [rota, acao] of [
      ["app/api/folha/fechar-mes/route.ts", "folha"],
      ["app/api/folha/importar/route.ts", "folha"],
      ["app/api/folha/colaboradores/[id]/route.ts", "folha"],
      ["app/api/folha/modelo-planilha/route.ts", "folha"],
      ["app/api/fiscal/emitente/route.ts", "fiscal"],
    ] as const) {
      const src = ler(rota);
      expect(src, rota).toContain(`exigirPermissao("financeiro", "${acao}")`);
      // a trava é a primeira coisa de cada handler: nada de prisma antes dela
      for (const m of src.matchAll(/export async function [A-Z]+\([^)]*\) \{\n(.*)\n/g)) {
        expect(m[1], `${rota} ${m[0].slice(0, 40)}`).toMatch(/exigir(Permissao|AlgumaPermissao)|const guard/);
      }
    }
  });

  it("os modelos de encargos passam pelo cadastro genérico, e lá a exigência é a mesma", () => {
    const registro = ler("lib/cadastros/registro.ts");
    expect(registro).toContain('const SO_FOLHA: Requisito = [["financeiro", "folha"]];');
    const entrada = registro.match(/"modelos-encargos": \{[\s\S]*?\n  \},/)![0];
    expect(entrada).toContain("permissoes: { listar: SO_FOLHA, criar: SO_FOLHA, editar: SO_FOLHA, inativar: SO_FOLHA, reativar: SO_FOLHA }");
    // inativar, nunca apagar: o modelo em uso não desaparece debaixo do colaborador
    expect(ler("app/api/folha/modelos/[id]/route.ts")).toMatch(/DELETE agora INATIVA/);
  });

  it("emitir NFS-e exige Financeiro › Fiscal (POST), e ver a nota não basta visualizar", () => {
    const src = ler("app/api/fiscal/notas/route.ts");
    expect(src).toMatch(/export async function POST[\s\S]{0,120}exigirPermissao\("financeiro", "fiscal"\)/);
  });
});

describe("a lista do custo de pessoal é a tabela da casa", () => {
  const src = ler(LISTA);

  it("usa TabelaPro, com cartões no celular — e não sobrou <table> à mão", () => {
    expect(src).toContain('from "@/components/listagem/tabela-pro"');
    expect(src).toContain("<TabelaPro");
    expect(src).toContain("cartoes={");
    expect(src).not.toMatch(/<(table|thead|tbody|tfoot|th|td)[\s>]/);
  });

  it("os totais ficam na barra da tabela (a casa não tem rodapé de tabela)", () => {
    expect(src).toContain("barra={");
    expect(src).toMatch(/data-resumo-folha/);
  });

  it("os números seguem os tokens de planilha, e a lista vazia é a da casa", () => {
    expect(src).toContain('from "@/lib/planilha"');
    expect(src).toContain("PLANILHA.numero");
    expect(src).toContain("<ListaVazia");
  });

  it("as colunas de dinheiro são escolhíveis e as duas essenciais são obrigatórias", () => {
    const colunas = src.match(/colunas=\{\[([\s\S]*?)\]\}/)![1];
    for (const id of ["nome", "contrato", "base", "adicionais", "encargos", "beneficios", "descontos", "total", "hora"]) {
      expect(colunas, id).toContain(`id: "${id}"`);
    }
    expect(colunas.match(/obrigatoria: true/g)).toHaveLength(2);
  });
});

describe("sucesso é toast; o erro fica na tela", () => {
  it("fechar o mês avisa por toast e deixa o erro ao lado do botão", () => {
    const src = ler(FECHAR);
    expect(src).toContain('from "@/components/ui/avisos"');
    expect(src).toMatch(/toast\(`\$\{rotulo\} fechado:/);
    expect(src).toContain("data-erro-fechar");
    // nada de "salvo com sucesso" verde fixado na tela
    expect(src).not.toMatch(/text-success-600/);
  });

  it("a folha do colaborador e o emitente de NFS-e também confirmam por toast", () => {
    expect(ler(FOLHA_COLAB)).toContain('toast("Dados financeiros salvos.")');
    const emitente = ler(EMITENTE);
    expect(emitente).toMatch(/if \(d\.sincronizado\) \{ toast\(d\.mensagem\); setMsg\(null\); \}/);
  });

  it("fechar o mês pergunta antes, e refazer avisa que a foto anterior é substituída", () => {
    const src = ler(FECHAR);
    expect(src).toContain("confirmar({");
    expect(src).toMatch(/A anterior é substituída/);
  });
});

describe("o ⓘ e o vocabulário", () => {
  it("o custo de pessoal explica no ⓘ do título", () => {
    const src = ler(LISTA);
    expect(src).toMatch(/^const AJUDA = /m);
    expect(src).toContain("<Dica texto={AJUDA}");
    const ajuda = src.match(/^const AJUDA = "(.*)";$/m)![1];
    expect(ajuda).toMatch(/encargos/i);
    expect(ajuda).toMatch(/Encargos/); // aponta a tela dos percentuais
    expect(ajuda).toMatch(/mês fechado/i);
  });

  it("todas as telas da leva têm ⓘ (ou o título com dica) e nenhuma instrução solta", () => {
    for (const arq of TELAS) {
      // a tela do emitente e a central de notas moram no componente; o resto, na própria página
      const junto: Record<string, string> = { [FISCAL]: "components/config/telas/dados-fiscais.tsx", [NOTAS]: CENTRAL };
      const src = ler(arq) + (junto[arq] ? ler(junto[arq]) : "");
      expect(src, arq).toMatch(/<Dica |dica[=:]|dica=\{/);
    }
  });

  it("nenhuma tela nem componente da leva usa emoji ou plural abreviado", () => {
    const abreviado = /(colaborador|encargo|benefício|beneficio|nota|linha|atualização|atualizacao|mês|mes|técnico|tecnico|ativo)\((s|ns|es|is|ões|oes)\)/i;
    for (const arq of [...TELAS, ...COMPONENTES]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(abreviado);
      expect(src, arq).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    }
  });

  it("o plural escrito vem de um ajudante, não de concatenação solta", () => {
    for (const arq of [LISTA, PLANILHA_UI]) {
      expect(ler(arq), arq).toMatch(/const plural = \(n: number, um: string, muitos: string\)/);
    }
  });

  it("o aviso de ferramenta de gestão continua na tela (é ressalva de dado, não instrução de uso)", () => {
    expect(ler(LISTA)).toContain("AVISO_GESTAO");
    expect(ler("lib/folha/calculo.ts")).toMatch(/Não substitui a folha oficial nem o contador/);
  });
});

describe("folha e NFS-e são razão: nada se apaga", () => {
  it("nenhuma tela da leva oferece apagar foto do mês, lançamento de folha ou nota emitida", () => {
    for (const arq of [...TELAS, ...COMPONENTES]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(/\bExcluir (foto|fechamento|folha|lançamento|nota)\b/i);
      expect(src, arq).not.toMatch(/method: "DELETE"/);
    }
  });

  it("as rotas de folha e da nota não expõem DELETE (refazer o mês substitui a foto)", () => {
    for (const rota of [
      "app/api/folha/fechar-mes/route.ts",
      "app/api/folha/importar/route.ts",
      "app/api/folha/colaboradores/[id]/route.ts",
      "app/api/fiscal/notas/route.ts",
      "app/api/fiscal/notas/[id]/route.ts",
      "app/api/fiscal/emitente/route.ts",
    ]) {
      expect(ler(rota), rota).not.toMatch(/export async function DELETE/);
    }
  });

  it("refazer o fechamento é substituir a competência, não apagar o histórico", () => {
    const servidor = ler("lib/folha/server.ts");
    expect(servidor).toMatch(/deleteMany\(\{ where: \{ empresaId, competencia \} \}\)/);
    expect(servidor).toContain("prisma.$transaction");
  });
});

describe("a leva não tocou no cálculo, na emissão nem nos vínculos", () => {
  const arquivosIntocados = [
    "lib/folha/calculo.ts",
    "lib/folha/planilha.ts",
    "lib/folha/importacao.ts",
    "app/api/folha/fechar-mes/route.ts",
    "app/api/folha/importar/route.ts",
    "app/api/folha/colaboradores/[id]/route.ts",
    "lib/nfse/emissao-server.ts",
    "lib/nfse/plugnotas.ts",
    "lib/nfse/nota.ts",
    "lib/desempenho/fechamento.ts",
    "lib/desempenho/fechamento-server.ts",
  ];

  /** A base da comparação. No CI os shards clonam raso: sem a base, não há o que comparar. */
  const base = (() => {
    for (const ref of ["origin/master", "master", process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`]) {
      if (!ref) continue;
      try {
        return execFileSync("git", ["merge-base", "HEAD", ref], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch { /* ref não está neste clone */ }
    }
    return null;
  })();

  it.skipIf(!base)("cálculo da folha, importação, emissão de NFS-e e CSV do Desempenho continuam como no master", () => {
    const mudados = execFileSync("git", ["diff", "--name-only", base!, "--", ...arquivosIntocados], { cwd: RAIZ, encoding: "utf8" })
      .split("\n").filter(Boolean);
    // COM-1 mudou o fechamento do Desempenho DE PROPÓSITO: a folha ganha a comissão e o fechamento gera a conta a
    // pagar por pessoa (o CSV ganha "Comissão" e "Total" só quando há comissão). Folha, importação e NFS-e intocadas.
    // pj4 (F21): o CSV da planilha (lib/folha/planilha › gerarCsv) passou a proteger a célula contra fórmula — só a
    // saída do CSV, o cálculo e a leitura da planilha ficam como estão.
    const mudouDeProposito = ["lib/desempenho/fechamento.ts", "lib/desempenho/fechamento-server.ts", "lib/folha/planilha.ts"];
    expect(mudados.filter((arq) => !mudouDeProposito.includes(arq))).toEqual([]);
  });

  it("os arquivos do cálculo, da emissão e do vínculo existem com o nome que a guarda cobra", () => {
    // sem isto, um arquivo renomeado faria a guarda acima passar comparando nada
    for (const arq of arquivosIntocados) expect(ler(arq).length, arq).toBeGreaterThan(0);
  });

  it("em lib/folha/server.ts só o retorno do fechamento mudou: o que é GRAVADO continua igual", () => {
    const src = ler("lib/folha/server.ts");
    // a foto é montada e gravada do mesmo jeito (o teste de PostgreSQL confere o conteúdo)
    expect(src).toContain("const { linhas } = await folhaAtual(empresaId, competencia);");
    expect(src).toContain("deleteMany({ where: { empresaId, competencia } })");
    expect(src).toContain("prisma.folhaSnapshot.createMany({ data })");
    // o acréscimo é só contagem devolvida para o aviso da tela
    expect(src).toContain("comDados: linhas.filter((l) => !l.semDados).length,");
  });

  it("o vínculo custo de pessoal ↔ Desempenho continua sendo o CSV do fechamento", () => {
    const rota = ler("app/api/desempenho/fechamentos/[id]/exportar/route.ts");
    expect(rota).toContain("csvDoFechamento");
    expect(rota).toContain('exigirPermissao("desempenho", "gerenciar")');
  });
});
