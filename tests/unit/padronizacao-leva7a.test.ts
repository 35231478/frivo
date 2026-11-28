/**
 * Leva 7A — Estoque (saldos, extrato, separação e devolução): guardas de FONTE.
 *
 * O que não pode voltar com um "refactor distraído":
 *  - ⓘ no título das duas telas de estoque, e nenhuma instrução solta em parágrafo;
 *  - as duas filas (a separar / a devolver) na tabela da casa, com cartões no celular e lista vazia
 *    compartilhada — nada de <table> escrita à mão;
 *  - a planilha de trabalho da separação nos tokens da casa (PLANILHA), como a prévia do contrato;
 *  - toda gravação confirma por toast (lançar movimento, preço de venda);
 *  - o RAZÃO não tem porta de saída: nenhuma tela oferece excluir/editar movimento e a rota nem
 *    expõe DELETE/PUT — corrigir é lançar ajuste ou inventário, que entram como movimento novo;
 *  - separação e devolução só mudam a tela DEPOIS do ok do servidor.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const ESTOQUE = "app/(dashboard)/estoque/page.tsx";
const PRODUTO = "app/(dashboard)/estoque/[produtoId]/page.tsx";
const SEPARACAO = "app/(dashboard)/estoque/separacao/page.tsx";
const DEVOLUCAO = "app/(dashboard)/estoque/devolucao/page.tsx";
const LANCAR = "components/estoque/lancar-estoque.tsx";
const PRECO = "components/estoque/preco-venda.tsx";
const SEP_OS = "components/estoque/separacao-os.tsx";
const DEV_OS = "components/estoque/devolucao-os.tsx";
const ROTA_MOV = "app/api/estoque/[produtoId]/movimentacoes/route.ts";

describe("o ⓘ e o vocabulário", () => {
  it("as duas telas de estoque explicam no ⓘ do título", () => {
    for (const [arq, rotulo] of [[ESTOQUE, "Estoque"], [PRODUTO, "Extrato do estoque"]] as const) {
      const src = ler(arq);
      expect(src, arq).toContain('import { Dica } from "@/components/ui/dica";');
      expect(src, arq).toContain(`<Dica texto={AJUDA} rotulo="${rotulo}" lado="direita" />`);
      expect(src, arq).toMatch(/^const AJUDA =/m);
    }
  });

  it("o ⓘ conta a regra do razão: movimento não se apaga, corrige-se com ajuste", () => {
    const ajuda = (arq: string) => ler(arq).match(/^const AJUDA = "([\s\S]*?)";$/m)![1];
    expect(ajuda(ESTOQUE)).toMatch(/nenhum movimento é apagado/i);
    expect(ajuda(ESTOQUE)).toMatch(/ajuste/i);
    expect(ajuda(PRODUTO)).toMatch(/não se apaga nem se edita/i);
  });

  it("o botão do topo não promete importar NF para quem não lança", () => {
    const src = ler(ESTOQUE);
    expect(src).toMatch(/podeLancar \? "Importar NF de compra" : "Notas de compra"/);
    // e nem se veste de ação principal nesse caso
    expect(src).toMatch(/podeLancar\s*\n?\s*\?\s*"bg-primary-500/);
  });
});

describe("as filas na tabela da casa", () => {
  for (const [arq, tela] of [[SEPARACAO, "estoque-separacao"], [DEVOLUCAO, "estoque-devolucao"]] as const) {
    it(`${arq.includes("separacao") ? "A separar" : "A devolver"}: TabelaPro, cartões e lista vazia da casa`, () => {
      const src = ler(arq);
      expect(src).toContain('import { TabelaPro } from "@/components/listagem/tabela-pro";');
      expect(src).toMatch(/<TabelaPro\s/);
      expect(src).toContain(`tela="${tela}"`);
      expect(src).toMatch(/<ul className="divide-y divide-surface-border" data-cartoes>/);
      expect(src).toContain('import { ListaVazia } from "@/components/listagem/listagem-ui";');
      expect(src).toContain("<ListaVazia mensagem=");
      // a tabela escrita à mão saiu
      expect(src).not.toMatch(/<table/);
      expect(src).not.toMatch(/<thead/);
    });
  }

  it("as duas filas continuam sendo de quem separa (a página redireciona sem a permissão)", () => {
    for (const arq of [SEPARACAO, DEVOLUCAO]) {
      expect(ler(arq), arq).toMatch(/if \(!pode\(u\.permissoes, "estoque", "separar", u\.role\)\) redirect\("\/sem-permissao"\);/);
    }
  });
});

describe("a planilha de trabalho da separação", () => {
  it("usa os tokens da casa, não classes próprias", () => {
    const src = ler(SEP_OS);
    // Leva I.2 (13): a planilha é a TabelaPro, que traz os tokens da casa (lib/planilha) — não há mais <table> própria
    expect(src).toContain('import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";');
    expect(src).toContain("<TabelaPro");
    expect(src).not.toMatch(/<table[\s>]/);
    expect(ler("components/listagem/tabela-pro.tsx")).toContain("PLANILHA.tabela");
    // nada de cabeçalho/zebra escritos à mão
    expect(src).not.toContain('className="bg-surface-page text-[11px] font-semibold uppercase');
    expect(src).not.toContain('<tbody className="divide-y divide-surface-linha">');
  });
});

describe("toda gravação confirma por toast", () => {
  it("lançar movimento: toast com o que foi lançado e o saldo novo", () => {
    const src = ler(LANCAR);
    expect(src).toContain('import { toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/toast\(`\$\{FEITO\[op\]\}\. Saldo agora: \$\{formatarQtd\(j\.saldo\)\} \$\{un\}\.`\)/);
    // o toast diz qual operação foi
    const feito = src.match(/const FEITO: Record<Op, string> = \{[\s\S]*?\};/)![0];
    for (const t of ["Entrada lançada", "Saída lançada", "Ajuste lançado", "Inventário lançado"]) expect(feito).toContain(t);
  });

  it("preço de venda: toast no sucesso, tela só com erro", () => {
    const src = ler(PRECO);
    expect(src).toContain('import { toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/setMsg\(null\);\s*\n\s*toast\(`Preço salvo: \$\{moeda\(j\.preco\)\}\.`\)/);
  });

  it("separação e devolução já confirmavam por toast — e continuam", () => {
    for (const arq of [SEP_OS, DEV_OS]) expect(ler(arq), arq).toMatch(/toast\(/);
  });
});

describe("o razão não tem porta de saída", () => {
  it("a rota de movimentações só aceita POST (nada de apagar nem editar)", () => {
    const src = ler(ROTA_MOV);
    expect(src).toMatch(/export async function POST\(/);
    expect(src).not.toMatch(/export async function (DELETE|PUT|PATCH)\(/);
    expect(src).toContain('exigirPermissao("estoque", "gerenciar")');
  });

  it("nenhuma tela de estoque oferece excluir ou editar movimento", () => {
    for (const arq of [ESTOQUE, PRODUTO, LANCAR]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(/Excluir movimento|excluir-movimento|apagar movimento/i);
      expect(src, arq).not.toMatch(/method: "DELETE"/);
    }
  });

  it("o extrato continua mostrando AJUSTE e INVENTÁRIO como movimento (é assim que se corrige)", () => {
    expect(ler("lib/estoque/regras.ts")).toMatch(/AJUSTE/);
    expect(ler(LANCAR)).toMatch(/\{ id: "AJUSTE", label: "Ajuste"/);
    expect(ler(LANCAR)).toMatch(/\{ id: "INVENTARIO", label: "Inventário"/);
  });
});

describe("só grava depois do ok do servidor", () => {
  it("separação: a tela só muda com a resposta boa", () => {
    const src = ler(SEP_OS);
    expect(src).toMatch(/if \(!res\.ok\) \{ setErro\([\s\S]{0,80}\); return false; \}\s*\n\s*setDados\(d\.separacao\);/);
  });

  it("devolução: idem", () => {
    const src = ler(DEV_OS);
    expect(src).toMatch(/if \(!res\.ok\) \{ setErro\([\s\S]{0,80}\); return; \}\s*\n\s*setDados\(d\.separacao\);/);
  });

  it("o que tira saldo pergunta antes (confirmação da casa)", () => {
    for (const arq of [SEP_OS, DEV_OS]) expect(ler(arq), arq).toMatch(/await confirmar\(\{/);
  });
});
