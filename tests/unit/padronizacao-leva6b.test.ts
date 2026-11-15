/**
 * Leva 6B — Comercial: a lista de Orçamentos, os Leads do site e as sugestões de item.
 *
 * Guardas de FONTE (o que some com um "refactor distraído"):
 *  - "Novo orçamento" só para quem tem Orçamentos › criar, a mesma regra do POST da rota;
 *  - ⓘ no título das duas telas, e nenhuma instrução solta em parágrafo;
 *  - leads: a tabela própria virou a tabela da casa, com cartões no celular e lista vazia da casa;
 *  - leads: Descartar/Reabrir é o componente da casa (nada paralelo), com o filtro "Descartados";
 *  - a rota de sugestões exige Orçamentos › criar e não conta orçamento cancelado;
 *  - vocabulário: plural escrito e caixa de frase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const LISTA = "app/(dashboard)/orcamentos/page.tsx";
const LEADS = "app/(dashboard)/leads-site/page.tsx";
const ROTA_SUG = "app/api/orcamentos/sugestoes/route.ts";
const FORM = "components/forms/orcamento-form.tsx";

describe("prioridade nº 1 — o que grava só aparece para quem pode", () => {
  it("/orcamentos: 'Novo orçamento' passa por Orçamentos › criar, como o POST da rota", () => {
    const src = ler(LISTA);
    expect(src).toMatch(/const podeCriar = pode\(session!\.user!\.permissoes, "orcamentos", "criar", session!\.user!\.role\)/);
    expect(src).toMatch(/\{podeCriar && \(\s*<Link\s+href="\/orcamentos\/novo"/);
    expect(ler("app/api/orcamentos/route.ts")).toContain('exigirPermissao("orcamentos", "criar")');
  });

  it("leads: Descartar/Reabrir é o componente da casa, pelas rotas que já existem", () => {
    const src = ler(LEADS);
    expect(src).toContain('import { InativarRegistro } from "@/components/ui/inativar-registro";');
    expect(src).toMatch(/url=\{`\/api\/orcamentos\/\$\{l\.id\}`\}\s+modulo="orcamentos"\s+acaoReativar="editar"/);
    expect(src).toContain('rotuloInativar="Descartar" rotuloReativar="Reabrir"');
    // nada paralelo: a tela não inventa fetch/rota própria para descartar
    expect(src).not.toMatch(/fetch\(/);
    const rota = ler("app/api/orcamentos/[id]/route.ts");
    expect(rota).toContain('exigirPermissao("orcamentos", "excluir")');
    expect(rota).toContain('exigirPermissao("orcamentos", "editar")');
  });

  it("a rota de sugestões exige Orçamentos › criar e ignora orçamento cancelado", () => {
    const src = ler(ROTA_SUG);
    expect(src).toContain('exigirPermissao("orcamentos", "criar")');
    expect(src).toMatch(/status: \{ not: "CANCELADO" as const \}/);
    expect(src).toMatch(/criadoEm: \{ gte: inicioDaJanela\(\) \}/);
    // o orçamento aberto não se sugere a si mesmo
    expect(src).toMatch(/excluirId \? \{ id: \{ not: excluirId \} \} : \{\}/);
  });
});

describe("as telas no padrão da casa", () => {
  it("as duas telas têm ⓘ no título", () => {
    for (const [arq, rotulo] of [[LISTA, "Orçamentos"], [LEADS, "Leads do site"]] as const) {
      const src = ler(arq);
      expect(src, arq).toContain('import { Dica } from "@/components/ui/dica";');
      expect(src, arq).toContain(`<Dica texto={AJUDA} rotulo="${rotulo}" lado="direita" />`);
      expect(src, arq).toMatch(/^const AJUDA =/m);
    }
  });

  it("leads: a tabela própria virou a tabela da casa, com cartões no celular", () => {
    const src = ler(LEADS);
    expect(src).toMatch(/<TabelaProUrl\s/);
    expect(src).toContain('tela="leads-site"');
    expect(src).toMatch(/<ul className="md:hidden[^"]*" data-cartoes>/);
    // nenhuma <table> escrita à mão sobrou
    expect(src).not.toMatch(/<table/);
    expect(src).not.toMatch(/<thead/);
  });

  it("leads: lista vazia e paginação são as da casa", () => {
    const src = ler(LEADS);
    expect(src).toContain('import { ListaVazia } from "@/components/listagem/listagem-ui";');
    expect(src).toContain("<ListaVazia mensagem=");
    expect(src).toContain("<PaginacaoUrl");
  });

  it("leads: o filtro 'Descartados' existe e 'Todos' esconde os descartados", () => {
    const src = ler(LEADS);
    const filtros = src.match(/const FILTROS[\s\S]*?\n\];/)![0];
    expect(filtros).toContain('{ key: "descartados", label: "Descartados", status: ["CANCELADO"] }');
    const todos = filtros.match(/\{ key: "todos"[^\n]*/)![0];
    expect(todos).not.toContain("CANCELADO");
  });

  it("leads: cada linha leva à ficha do cliente e ao orçamento", () => {
    const src = ler(LEADS);
    expect(src).toMatch(/href=\{`\/clientes\/\$\{l\.clienteId\}`\}/);
    expect(src).toMatch(/href=\{`\/orcamentos\/\$\{l\.id\}`\}/);
  });

  it("leads: quem descartou e quando sai da linha do tempo que já existe", () => {
    const src = ler(LEADS);
    expect(src).toMatch(/prisma\.orcamentoEvento\.findMany\(/);
    // o evento do descarte é o que terminou em "Cancelado" — não qualquer troca de status
    expect(src).toMatch(/if \(!\/cancelad\/i\.test\(e\.detalhe \?\? ""\)\) continue;/);
    expect(src).toMatch(/Descartado por \$\{d\.quem\} em \$\{formatarData\(d\.quando\)\}/);
  });
});

describe("as sugestões de item na tela", () => {
  it("o formulário usa o componente e o hook da casa, sem preencher sozinho", () => {
    const src = ler(FORM);
    expect(src).toContain('import { SugestoesItens, useSugestoesItens, type ItemSugerido } from "@/components/orcamento/sugestoes-itens";');
    expect(src).toContain("const sugestoesItens = useSugestoesItens(clienteId, inicial?.id);");
    // uma faixa para serviços e outra para produtos
    expect(src).toContain('tipo="SERVICO" itens={sugestoesItens}');
    expect(src).toContain('tipo="PRODUTO" itens={sugestoesItens}');
    // a linha entra com o último preço praticado e segue editável
    expect(src).toMatch(/valorUnitario: s\.valorUnitario, valorTotal: s\.valorUnitario/);
  });

  it("a faixa não repete o que já está na lista e pode ser dispensada", () => {
    const src = ler("components/orcamento/sugestoes-itens.tsx");
    expect(src).toMatch(/itens\.filter\(\(s\) => s\.tipo === tipo && !jaNaLista\(s\)\)/);
    expect(src).toContain("data-dispensar-sugestoes");
    expect(src).toMatch(/if \(dispensada \|\| alvo\.length === 0\) return null;/);
  });
});

describe("vocabulário", () => {
  it("caixa de frase nos botões e títulos", () => {
    expect(ler(LISTA)).toContain("Novo orçamento");
    expect(ler(LISTA)).not.toContain("Novo Orçamento");
    expect(ler(LEADS)).toContain("Leads do site");
    expect(ler(LEADS)).not.toContain("Leads do Site");
  });

  it("leads: plural escrito, sem '(s)'", () => {
    const src = ler(LEADS);
    expect(src).toMatch(/total === 1 \? "1 lead" : `\$\{total\} leads`/);
    expect(src).toMatch(/novos24h === 1 \? "1 novo em 24h" : `\$\{novos24h\} novos em 24h`/);
    expect(src).not.toMatch(/lead\(s\)|novo\(s\)/);
  });
});
