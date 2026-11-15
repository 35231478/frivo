/**
 * Leva 8B — Financeiro (faturar e medições): guardas de FONTE.
 *
 * O que não pode voltar com um "refactor distraído":
 *  - o que mexe no faturamento (enviar, aprovar, registrar PC/NF/boleto/pagamento, cancelar, criar e
 *    editar medição) só aparece para quem tem Financeiro › medições — e a ficha, a criação e a
 *    edição barram na própria rota, como a lista já fazia;
 *  - "Ver página do cliente" é leitura: continua para quem só consulta;
 *  - toda ação confirma por toast; o erro continua na tela;
 *  - ⓘ na ficha e no formulário, e nenhuma instrução solta em parágrafo;
 *  - medição é faturamento: cancelar devolve as contas a receber ao previsto, nenhuma tela ou rota
 *    apaga medição, e o cancelamento é recusado quando já houve recebimento ou boleto.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const FICHA = "app/(dashboard)/financeiro/medicoes/[id]/page.tsx";
const NOVA = "app/(dashboard)/financeiro/medicoes/nova/page.tsx";
const EDITAR = "app/(dashboard)/financeiro/medicoes/[id]/editar/page.tsx";
const FATURA = "app/(dashboard)/financeiro/faturas/[id]/page.tsx";
const FATURAMENTO = "app/(dashboard)/financeiro/faturamento-contratos/page.tsx";
const LISTA = "app/(dashboard)/financeiro/medicoes/page.tsx";

const ACOES = "components/medicao/medicao-acoes.tsx";
const FORM = "components/medicao/medicao-form.tsx";
const ROTA_ACAO = "app/api/medicoes/[id]/acao/route.ts";

const TRAVA = (acao: string) => `if (!pode(u.permissoes, "financeiro", "${acao}", u.role)) redirect("/sem-permissao");`;

describe("o ⓘ e o vocabulário", () => {
  it("a ficha e o formulário explicam no ⓘ, não em parágrafo de instrução", () => {
    const ficha = ler(FICHA);
    expect(ficha).toMatch(/^const AJUDA =/m);
    expect(ficha).toContain("dica={AJUDA}");
    const form = ler(FORM);
    expect(form).toMatch(/^const AJUDA_NOVA =/m);
    expect(form).toMatch(/^const AJUDA_EDITAR =/m);
    expect(form).toContain('dica={mode === "novo" ? AJUDA_NOVA : AJUDA_EDITAR}');
  });

  it("o ⓘ da ficha conta a regra do cancelamento (contas voltam a previsto; com recebimento, recusa)", () => {
    const ajuda = ler(FICHA).match(/^const AJUDA = "(.*)";$/m)![1];
    expect(ajuda).toMatch(/previsto/i);
    expect(ajuda).toMatch(/recusad/i);
    expect(ajuda).toMatch(/Contas a receber/i);
  });

  it("nenhuma tela desta leva usa emoji nem plural abreviado", () => {
    const abreviado = /(medição|medicao|fatura|conta|nota|boleto|parcela)\((s|ns|es|is)\)/i;
    for (const arq of [FICHA, NOVA, EDITAR, FATURAMENTO, ACOES, FORM]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(abreviado);
      expect(src, arq).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    }
  });
});

describe("prioridade 1: faturar só para quem pode", () => {
  it("a ficha, a criação e a edição barram na rota, como a lista já fazia", () => {
    for (const arq of [FICHA, NOVA, EDITAR]) expect(ler(arq), arq).toContain(TRAVA("medicoes"));
    // a lista e o faturamento de contratos já barravam (não regride)
    expect(ler(LISTA)).toContain('pode(session!.user!.permissoes, "financeiro", "medicoes", session!.user!.role)');
    expect(ler(FATURAMENTO)).toContain('pode(session!.user!.permissoes, "financeiro", "medicoes", session!.user!.role)');
    // a fatura avulsa é a mesma tela da medição (reexport): herda a trava
    expect(ler(FATURA)).toContain('export { default } from "../../medicoes/[id]/page"');
  });

  it("o menu não leva a um beco: Medições só aparece para quem tem a permissão", () => {
    const src = ler("components/layout/sidebar.tsx");
    const linha = src.split("\n").find((l) => l.includes('href: "/financeiro/medicoes"'))!;
    expect(linha).toContain('acao: "medicoes"');
  });

  it("cada ação da ficha depende de Financeiro › medições; ver a página do cliente, não", () => {
    const src = ler(ACOES);
    expect(src).toContain('import { usePermissoes } from "@/components/providers/permissoes-provider";');
    expect(src).toContain('const podeMexer = usePermissoes().pode("financeiro", "medicoes");');
    // os seis blocos de ação (rascunho, aprovação, PC, NF, boleto, pagamento) + cancelar
    expect(src.match(/\{podeMexer &&/g) ?? []).toHaveLength(7);
    // leitura: a página do cliente fica fora da trava
    const linhaPublica = src.split("\n").find((l) => l.includes("data-pagina-cliente"))!;
    expect(linhaPublica).not.toContain("podeMexer");
  });

  it("a rota da ação exige a mesma permissão", () => {
    expect(ler(ROTA_ACAO)).toContain('exigirPermissao("financeiro", "medicoes")');
  });
});

describe("toda ação confirma por toast", () => {
  it("cada ação tem a sua frase, com o documento certo (medição ou fatura)", () => {
    const src = ler(ACOES);
    expect(src).toContain('import { confirmar, toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/^const FEITO = \(acao: string, doc: string\): string =>/m);
    for (const acao of ["ENVIAR", "APROVAR_MANUAL", "REGISTRAR_PC", "REGISTRAR_NF", "REGISTRAR_BOLETO", "REGISTRAR_PAGAMENTO", "CANCELAR"]) {
      expect(src, acao).toMatch(new RegExp(`${acao}:`));
    }
    expect(src).toContain('const doc = avulsa ? "Fatura" : "Medição";');
  });

  it("o erro continua na tela (é onde a pessoa está olhando)", () => {
    const src = ler(ACOES);
    expect(src).toMatch(/setFeedback\(\{ tipo: "erro"/);
    // nenhum "sucesso" sobrou no aviso da tela
    expect(src).not.toMatch(/setFeedback\(\{ tipo: "ok"/);
  });

  it("cancelar pergunta antes e diz o que acontece com as contas", () => {
    const src = ler(ACOES);
    expect(src).toMatch(/await confirmar\(\{/);
    expect(src).toMatch(/As contas a receber geradas voltam a previsto\./);
    expect(src).toMatch(/perigo: true/);
  });
});

describe("medição é faturamento: não há porta de saída", () => {
  it("a rota de ação não apaga medição nem conta", () => {
    const src = ler(ROTA_ACAO);
    expect(src).not.toMatch(/export async function DELETE/);
    expect(src).not.toMatch(/medicao\.delete|contaReceber\.delete/);
    // cancelar é status + desfazer o vínculo das contas
    expect(src).toContain('data: { status: "CANCELADA" }');
    expect(src).toContain("desfazerContasDaMedicao");
  });

  it("o cancelamento é recusado quando o dinheiro já se mexeu", () => {
    const src = ler(ROTA_ACAO);
    expect(src).toContain("cobrancasQueTravamMedicao");
    expect(src).toMatch(/Resolva no Contas a Receber antes de cancelar/);
    expect(src).toMatch(/status: 409/);
  });

  it("desfazer devolve a conta ao previsto, sem apagar", () => {
    const src = ler("lib/financeiro-server.ts");
    const fn = src.slice(src.indexOf("export async function desfazerContasDaMedicao"));
    expect(fn).toContain('status: "PREVISTO"');
    expect(fn.slice(0, 2000)).not.toContain("contaReceber.delete");
  });
});
