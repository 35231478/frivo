/**
 * Pronto pra janeiro 3 — as regras puras das correções da varredura (docs/pronto-janeiro-3.md):
 *  - trava de preço de tabela na tela: item novo recebe o preço da tabela; o já gravado mantém; trocar para cliente sem
 *    tabela (ou item fora da tabela nova) destrava;
 *  - o botão "voltar à posição padrão" das anotações nunca cobre o botão;
 *  - o destino depois do login do portal: só rota interna do portal;
 *  - o valor e o arquivo do pedido do cliente (escritório e portal): "1.500" é mil e quinhentos; 413 vira o aviso de 3 MB;
 *  - filtros lembrados: o "de onde veio" (`de=`) não volta como filtro.
 */
import { describe, expect, it } from "vitest";
import { aplicarTabelaAoItem, itensComPrecoDeTabelaAlterado, marcarItensDaTabela, type ItemDaTela } from "@/lib/precos/trava-tabela";
import { posicaoDoVoltar } from "@/lib/anotacoes/posicao-botao";
import { destinoDoPortal, destinoSeguroDoPortal, linkDoPortal } from "@/lib/portal/senha-provisoria";
import { erroDoEnvio, lerValorPedido, MSG_ARQUIVO_PEDIDO_GRANDE, TAMANHO_MAX_PEDIDO } from "@/lib/pedido-cliente/arquivo";
import { paraLembrar } from "@/lib/listagem/filtros-lembrados";

describe("trava de preço de tabela na tela (orçamento)", () => {
  const tab = { s1: { valorFinal: 150 } };

  it("item NOVO (ainda não gravado) entra com o preço da tabela, travado sem a permissão, e o total acompanha", () => {
    const [it] = marcarItensDaTabela([{ catalogoId: "s1", valorUnitario: 120, quantidade: 2, valorTotal: 240 } as ItemDaTela & { quantidade: number; valorTotal: number }], tab, false);
    expect(it).toMatchObject({ valorUnitario: 150, valorTotal: 300, origemPreco: "contrato", valorTabela: 150, bloqueado: true });
    expect(it.valorGravado).toBeUndefined();
    // e não pede motivo: está no preço da tabela
    expect(itensComPrecoDeTabelaAlterado([it])).toEqual([]);
  });

  it("item JÁ GRAVADO mantém o preço salvo (abrir o orçamento não troca nada)", () => {
    const [it] = marcarItensDaTabela([{ catalogoId: "s1", valorUnitario: 120, valorGravado: 120 }], tab, true);
    expect(it).toMatchObject({ valorUnitario: 120, valorGravado: 120, bloqueado: false });
    expect(itensComPrecoDeTabelaAlterado([it])).toEqual([]);
  });

  it("trocar para um cliente SEM tabela (ou com outra tabela sem o item) destrava os itens da tabela anterior", () => {
    const marcado = aplicarTabelaAoItem({ catalogoId: "s1", valorUnitario: 1 }, tab.s1, false);
    const [sem] = marcarItensDaTabela([marcado], null, false);
    expect(sem).toMatchObject({ valorUnitario: 150, bloqueado: false, origemPreco: undefined, valorTabela: undefined });
    const [outra] = marcarItensDaTabela([marcado], { s9: { valorFinal: 10 } }, false);
    expect(outra.bloqueado).toBe(false);
  });

  it("nada a mudar: a mesma lista (o efeito da tela não re-renderiza à toa)", () => {
    const itens: ItemDaTela[] = [{ catalogoId: "x", valorUnitario: 1 }];
    expect(marcarItensDaTabela(itens, null, false)).toBe(itens);
    expect(marcarItensDaTabela(itens, tab, false)).toBe(itens);
  });
});

describe("anotações: o botão de voltar à posição padrão", () => {
  it("fica à esquerda do botão; encostado na borda esquerda, vai para a direita (nunca por cima)", () => {
    expect(posicaoDoVoltar({ x: 300, y: 100 }, 96)).toEqual({ left: 260, top: 102 });
    expect(posicaoDoVoltar({ x: 10, y: 50 }, 96)).toEqual({ left: 114, top: 52 });
    // o botão de 32 px não sobrepõe o principal (10 → 106)
    expect(posicaoDoVoltar({ x: 10, y: 50 }, 96).left).toBeGreaterThan(10 + 96);
  });
});

describe("portal: para onde vai depois de entrar", () => {
  it("só rota interna do portal; nada de outro site nem das telas de entrar/trocar", () => {
    expect(destinoSeguroDoPortal("/portal/pedidos-compra")).toBe("/portal/pedidos-compra");
    for (const ruim of ["//evil.test", "https://evil.test", "/portal//x", "/dashboard", "/portal/login", "/portal/trocar-senha", "/portal/x?y=1", "\\\\evil", null, 3]) {
      expect(destinoSeguroDoPortal(ruim), String(ruim)).toBeNull();
    }
  });
  it("já logado: a troca pendente vence; senão o destino pedido; senão o início", () => {
    expect(destinoDoPortal({ trocarSenha: true }, "/portal/pedidos-compra")).toBe("/portal/trocar-senha");
    expect(destinoDoPortal({ trocarSenha: false }, "/portal/pedidos-compra")).toBe("/portal/pedidos-compra");
    expect(destinoDoPortal({ trocarSenha: false }, "//evil")).toBe("/portal/dashboard");
  });
  it("o link do e-mail leva ao login com o destino", () => {
    expect(linkDoPortal("https://app.exemplo.test", "/portal/pedidos-compra")).toBe("https://app.exemplo.test/portal/login?destino=%2Fportal%2Fpedidos-compra");
  });
});

describe("pedido do cliente: valor e arquivo (escritório e portal, um jeito só)", () => {
  it("o valor no jeito brasileiro: \"1.500\" é mil e quinhentos (antes virava R$ 1,50)", () => {
    expect(lerValorPedido("1.500")).toBe(1500);
    expect(lerValorPedido("1.500,50")).toBe(1500.5);
    expect(lerValorPedido("R$ 2.000,00")).toBe(2000);
    expect(lerValorPedido("1500,5")).toBe(1500.5);
    expect(lerValorPedido("  ")).toBeNull();
    expect(lerValorPedido("abc")).toBeNaN();
  });
  it("o limite é 3 MB (cabe no JSON da hospedagem); o 413 vira o aviso do tamanho", () => {
    expect(TAMANHO_MAX_PEDIDO).toBe(3 * 1024 * 1024);
    expect(erroDoEnvio(413, null, "padrão")).toBe(MSG_ARQUIVO_PEDIDO_GRANDE);
    expect(erroDoEnvio(400, { erro: "Número obrigatório." }, "padrão")).toBe("Número obrigatório.");
    expect(erroDoEnvio(undefined, null, "padrão")).toBe("padrão");
  });
});

describe("filtros lembrados", () => {
  it("o \"veio do financeiro\" (de=) e a página não voltam; o resto sim", () => {
    expect(paraLembrar("de=contas-pagar&q=frio&pagina=3&periodo=todos")).toBe("q=frio&periodo=todos");
  });
});

describe("as ligações (cada tela usa a peça certa)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const ler = (f: string) => fs.readFileSync(path.resolve(__dirname, "../..", f), "utf8");

  it("cadastros padrão (Produtos, Serviços, Usuários…) lembram os filtros pelo mesmo hook das outras listas", () => {
    expect(ler("components/cadastros/cadastro-padrao.tsx")).toContain("useFiltrosLembrados(`cadastro-${entidade}`)");
  });
  it("o extrato de cada produto tem o próprio filtro lembrado", () => {
    expect(ler("app/(dashboard)/estoque/[produtoId]/page.tsx")).toContain("chave={`estoque-extrato-${produtoId}`}");
  });
  it("o lembrete do pedido leva ao login do portal com o destino; o login manda o destino e a ação o respeita", () => {
    expect(ler("lib/pedido-cliente/lembretes-server.ts")).toContain("linkDoPortal(baseUrl(), ROTA_PORTAL_PEDIDO)");
    expect(ler("components/portal/portal-login-form.tsx")).toContain('<input type="hidden" name="destino" value={destino} />');
    expect(ler("app/(portal)/portal/actions.ts")).toContain('destinoSeguroDoPortal(formData.get("destino")) ?? "/portal/dashboard"');
  });
  it("o rodapé do portal no celular não estoura com 7 itens (rótulo truncado, título completo)", () => {
    const s = ler("components/portal/portal-shell.tsx");
    expect(s).toContain("flex-1 min-w-0 flex flex-col");
    expect(s).toContain('<span className="max-w-full truncate">');
  });
  it("sino \"NF chegou nos seus pedidos\" com mais de um: a lista de pedidos (não só o primeiro)", () => {
    expect(ler("components/layout/header.tsx")).toContain('umOuLista(alertas?.nfPedidos, alertas?.nfPedidoId, (id) => `/compras/pedidos/${id}`, "/compras/pedidos?periodo=todos")');
  });
  it("a OS trava o preço do item da tabela do cliente no lápis e no editor (sem a permissão)", () => {
    const s = ler("components/os/os-orcamento.tsx");
    expect(s).toContain("const semPreco = (i.valorManual && comMateriais) || (naTabela(i) && !podeAlterarPrecoTabela);");
    expect(s).toContain('origemPreco: naTabela(i) ? "contrato" : undefined,');
  });
  it("Cliente › Portal: liberar um contato liga a chave \"Portal ativo\" da ficha", () => {
    expect(ler("components/forms/cliente-form.tsx")).toContain("onAcessoLiberado={() => setPortalAtivo(true)}");
  });
});
