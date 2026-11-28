/**
 * Leva G — as regras puras:
 *  - preço de tabela travado (lib/precos/trava-tabela): o que conta como alteração, o veredito (403 sem a
 *    permissão, 400 sem motivo), a linha da trilha, as marcas da tela e o preço comparável do serviço;
 *  - a permissão "Alterar preço de tabela" no padrão dos perfis (o administrador tem; perfil antigo não);
 *  - tabela de preço: filtro, "selecionar todos" do filtro e os escolhidos (lib/tabela-preco-selecao);
 *  - Meu perfil: abas, a aba pela URL, o que mudou nos dados e o papel uma vez só (lib/perfil/abas);
 *  - botão de anotações arrastável: posição gravada, presa na tela, arraste × clique (lib/anotacoes/posicao-botao);
 *  - os corpos das rotas aceitam o motivo.
 */
import { describe, expect, it, vi } from "vitest";
import {
  alteracoesDePrecoDeTabela, chaveCatalogo, conferirPrecoDeTabela, itensComPrecoDeTabelaAlterado, marcarItensDaTabela, MOTIVO_MAX,
  PERMISSAO_PRECO_TABELA, textoDaTrilha, type ItemDaTela,
} from "@/lib/precos/trava-tabela";
import { ACOES_LABEL, montarPermissoes, pode, SECOES, permissoesTotais } from "@/lib/permissoes";
import { alternarTodos, escolhidos, estadoDeTodos, filtrarCatalogo } from "@/lib/tabela-preco-selecao";
import { abaInicialDoPerfil, abasDoPerfil, alteracoesDoPerfil, linhaDaConta } from "@/lib/perfil/abas";
import { chavePosicaoBotao, ehArraste, lerPosicao, limitarPosicao, posicaoArrastada } from "@/lib/anotacoes/posicao-botao";
import { itemOsSchema, linhaOrcamentoContextoSchema, linhaOsContextoSchema, orcamentoSchema } from "@/lib/validations";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const tabela = new Map([[chaveCatalogo("servico", "s1"), 150], [chaveCatalogo("produto", "p1"), 80]]);
const sv = (valorUnitario: number, catalogoId: string | null = "s1") => ({ tipo: "servico" as const, catalogoId, descricao: "Limpeza", valorUnitario });

describe("preço de tabela travado — o que é alteração", () => {
  it("no preço da tabela, fora da tabela, sem catálogo e cliente sem tabela: não é", () => {
    expect(alteracoesDePrecoDeTabela([sv(150), { tipo: "produto", catalogoId: "p1", descricao: "Filtro", valorUnitario: 80 }], tabela)).toEqual([]);
    expect(alteracoesDePrecoDeTabela([sv(10, "s2")], tabela)).toEqual([]);
    expect(alteracoesDePrecoDeTabela([sv(10, null)], tabela)).toEqual([]);
    expect(alteracoesDePrecoDeTabela([sv(10)], new Map())).toEqual([]);
    // tolerância de centavo (arredondamento)
    expect(alteracoesDePrecoDeTabela([sv(150.004)], tabela)).toEqual([]);
  });

  it("preço diferente do da tabela: é (serviço e produto, mesmo id em tipos diferentes não se confunde)", () => {
    expect(alteracoesDePrecoDeTabela([sv(120)], tabela)).toEqual([{ descricao: "Limpeza", valorTabela: 150, valorNovo: 120 }]);
    expect(alteracoesDePrecoDeTabela([{ tipo: "produto", catalogoId: "s1", descricao: "X", valorUnitario: 1 }], tabela)).toEqual([]);
    expect(alteracoesDePrecoDeTabela([{ tipo: "produto", catalogoId: "p1", descricao: "Filtro", valorUnitario: 81 }], tabela)).toHaveLength(1);
    expect(alteracoesDePrecoDeTabela([sv(160)], tabela)).toHaveLength(1); // para cima também
  });

  it("o preço já gravado antes não é alteração (editar sem mexer no preço); outro valor, sim", () => {
    const antes = new Map([[chaveCatalogo("servico", "s1"), [120]]]);
    expect(alteracoesDePrecoDeTabela([sv(120)], tabela, antes)).toEqual([]);
    expect(alteracoesDePrecoDeTabela([sv(110)], tabela, antes)).toHaveLength(1);
  });

  it("veredito: sem alteração ok; sem a permissão 403 (com os itens); com ela, sem motivo 400; com motivo ok (aparado e limitado)", () => {
    const alt = alteracoesDePrecoDeTabela([sv(120)], tabela);
    expect(conferirPrecoDeTabela([], { podeAlterar: false })).toEqual({ ok: true, motivo: null });
    const sem = conferirPrecoDeTabela(alt, { podeAlterar: false, motivo: "um motivo bom" });
    expect(sem).toMatchObject({ ok: false, status: 403 });
    expect(!sem.ok && sem.erro).toMatch(/Limpeza.*Alterar preço de tabela/);
    expect(conferirPrecoDeTabela(alt, { podeAlterar: true })).toMatchObject({ ok: false, status: 400 });
    expect(conferirPrecoDeTabela(alt, { podeAlterar: true, motivo: "  ok  " })).toMatchObject({ ok: false, status: 400 });
    expect(conferirPrecoDeTabela(alt, { podeAlterar: true, motivo: "  Desconto negociado  " })).toEqual({ ok: true, motivo: "Desconto negociado" });
    const longo = conferirPrecoDeTabela(alt, { podeAlterar: true, motivo: "x".repeat(400) });
    expect(longo.ok && longo.motivo!.length).toBe(MOTIVO_MAX);
  });

  it("a linha da trilha: item, de → para e o motivo", () => {
    const t = textoDaTrilha([{ descricao: "Limpeza", valorTabela: 150, valorNovo: 120 }, { descricao: "Filtro", valorTabela: 80, valorNovo: 70.5 }], "Desconto");
    expect(t).toBe("Preço de tabela alterado: Limpeza (R$ 150,00 → R$ 120,00); Filtro (R$ 80,00 → R$ 70,50). Motivo: Desconto");
  });

  it("na tela: marca só os itens da tabela, trava sem a permissão e guarda o valor gravado", () => {
    // Itens de um orçamento salvo chegam com o valor gravado (o formulário anota ao abrir); o item novo, sem (pronto-janeiro-3)
    const itens: ItemDaTela[] = [{ catalogoId: "s1", valorUnitario: 120, valorGravado: 120 }, { catalogoId: "s9", valorUnitario: 5 }, { catalogoId: null, valorUnitario: 1 }];
    const tab = { s1: { valorFinal: 150 } };
    const sem = marcarItensDaTabela(itens, tab, false);
    expect(sem[0]).toEqual({ catalogoId: "s1", valorUnitario: 120, origemPreco: "contrato", valorTabela: 150, bloqueado: true, valorGravado: 120 });
    expect(sem[1]).toBe(itens[1]);
    expect(sem[2]).toBe(itens[2]);
    expect(marcarItensDaTabela(itens, tab, true)[0].bloqueado).toBe(false);
    expect(marcarItensDaTabela(itens, null, false)).toBe(itens);
    // marcar de novo não troca o valor gravado
    expect(marcarItensDaTabela([{ ...sem[0], valorUnitario: 130 }], tab, true)[0].valorGravado).toBe(120);
  });

  it("na tela: pede o motivo só para o que mudou (nem o da tabela, nem o gravado; total manual não conta)", () => {
    const base = { catalogoId: "s1", origemPreco: "contrato", valorTabela: 150 };
    expect(itensComPrecoDeTabelaAlterado([{ ...base, valorUnitario: 150 }])).toHaveLength(0);
    expect(itensComPrecoDeTabelaAlterado([{ ...base, valorUnitario: 120 }])).toHaveLength(1);
    expect(itensComPrecoDeTabelaAlterado([{ ...base, valorUnitario: 120, valorGravado: 120 }])).toHaveLength(0);
    expect(itensComPrecoDeTabelaAlterado([{ ...base, valorUnitario: 120, valorManual: true }])).toHaveLength(0);
    expect(itensComPrecoDeTabelaAlterado([{ ...base, origemPreco: "padrao", valorUnitario: 1 }])).toHaveLength(0);
  });

  it("serviço com materiais: compara a BASE unitária (valorBase é o total da base); total manual compara o unitário", async () => {
    const { precoComparavelDoServico } = await import("@/lib/precos/trava-tabela-server");
    expect(precoComparavelDoServico({ valorUnitario: 175, quantidade: 2, valorBase: 300, valorManual: false })).toBe(150);
    expect(precoComparavelDoServico({ valorUnitario: 175, quantidade: 2, valorBase: 300, valorManual: true })).toBe(175);
    expect(precoComparavelDoServico({ valorUnitario: 150, quantidade: 3, valorBase: null })).toBe(150);
  });
});

describe("a permissão \"Alterar preço de tabela\"", () => {
  it("no padrão dos perfis: módulo Orçamentos, com rótulo; o administrador tem; perfil sem a marca não", () => {
    expect(PERMISSAO_PRECO_TABELA).toEqual(["orcamentos", "alterarPrecoTabela"]);
    expect(ACOES_LABEL.alterarPrecoTabela).toBe("Alterar preço de tabela");
    const orc = SECOES.flatMap((s) => s.modulos).find((m) => m.id === "orcamentos")!;
    expect(orc.acoes).toContain("alterarPrecoTabela");
    expect(pode({}, "orcamentos", "alterarPrecoTabela", "ADMIN")).toBe(true);
    expect(pode({}, "orcamentos", "alterarPrecoTabela", "SUPER_ADMIN")).toBe(true);
    // Perfil gravado antes (sem a chave) fica travado; marcado, pode
    const antigo = montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] });
    expect(pode(antigo, "orcamentos", "alterarPrecoTabela", "OPERADOR")).toBe(false);
    expect(pode(montarPermissoes({ orcamentos: ["alterarPrecoTabela"] }), "orcamentos", "alterarPrecoTabela", "OPERADOR")).toBe(true);
    expect(permissoesTotais().orcamentos.alterarPrecoTabela).toBe(true);
  });

  it("os corpos das rotas aceitam o motivo (as rotas da OS são estritas)", () => {
    expect(itemOsSchema.safeParse({ descricao: "X", motivoPrecoTabela: "motivo bom" }).success).toBe(true);
    expect(linhaOsContextoSchema.safeParse({ valorUnitario: 10, motivoPrecoTabela: "motivo bom" }).success).toBe(true);
    expect(linhaOrcamentoContextoSchema.safeParse({ valorUnitario: 10, motivoPrecoTabela: "motivo bom" }).success).toBe(true);
    expect(linhaOsContextoSchema.safeParse({ outra: 1 }).success).toBe(false);
    expect(orcamentoSchema.safeParse({ clienteId: "c1", motivoPrecoTabela: "motivo bom" }).success).toBe(true);
    expect(itemOsSchema.safeParse({ descricao: "X", motivoPrecoTabela: "x".repeat(301) }).success).toBe(false);
  });
});

describe("tabela de preço — adicionar em massa", () => {
  const cat = [
    { id: "a", nome: "Limpeza de split", kind: "SERVICO" as const, codigo: "LIMP01" },
    { id: "b", nome: "Instalação", kind: "SERVICO" as const, codigo: "INST01" },
    { id: "c", nome: "Filtro secador", kind: "PRODUTO" as const, codigo: 7 },
    { id: "d", nome: "Gás R410A", kind: "PRODUTO" as const, codigo: 8 },
  ];
  it("filtro: fora da tabela, pelo tipo, pelo nome sem acento e pelo código", () => {
    expect(filtrarCatalogo(cat, { q: "", tipo: "TODOS", jaNaTabela: new Set(["b"]) }).map((c) => c.id)).toEqual(["a", "c", "d"]);
    expect(filtrarCatalogo(cat, { q: "", tipo: "PRODUTO", jaNaTabela: new Set() }).map((c) => c.id)).toEqual(["c", "d"]);
    expect(filtrarCatalogo(cat, { q: "INSTALACAO", tipo: "TODOS", jaNaTabela: new Set() }).map((c) => c.id)).toEqual(["b"]);
    expect(filtrarCatalogo(cat, { q: "limp01", tipo: "TODOS", jaNaTabela: new Set() }).map((c) => c.id)).toEqual(["a"]);
    expect(filtrarCatalogo(cat, { q: "8", tipo: "TODOS", jaNaTabela: new Set() }).map((c) => c.id)).toEqual(["d"]);
  });

  it("selecionar todos: só os do filtro atual; de novo desmarca só eles; o resto da seleção fica", () => {
    const visiveis = cat.filter((c) => c.kind === "PRODUTO");
    let sel = new Set(["a"]);
    expect(estadoDeTodos(sel, visiveis)).toBe("nenhum");
    sel = alternarTodos(sel, visiveis);
    expect([...sel].sort()).toEqual(["a", "c", "d"]);
    expect(estadoDeTodos(sel, visiveis)).toBe("todos");
    sel.delete("d");
    expect(estadoDeTodos(sel, visiveis)).toBe("alguns");
    sel = alternarTodos(sel, visiveis); // alguns → todos
    expect(estadoDeTodos(sel, visiveis)).toBe("todos");
    sel = alternarTodos(sel, visiveis); // todos → nenhum dos visíveis
    expect([...sel]).toEqual(["a"]);
    expect(estadoDeTodos(new Set(), [])).toBe("nenhum");
  });

  it("os escolhidos saem na ordem do catálogo e sem os que já estão na tabela", () => {
    expect(escolhidos(cat, new Set(["d", "a", "b"]), new Set(["b"])).map((c) => c.id)).toEqual(["a", "d"]);
  });
});

describe("Meu perfil", () => {
  it("abas: Dados e Segurança; Preferências só com as notificações; a da URL, com os nomes antigos levados ao lugar novo", () => {
    expect(abasDoPerfil({ notificacoes: false }).map((a) => a.label)).toEqual(["Dados", "Segurança"]);
    const todas = abasDoPerfil({ notificacoes: true });
    expect(todas.map((a) => a.label)).toEqual(["Dados", "Segurança", "Preferências"]);
    expect(abaInicialDoPerfil("seguranca", todas)).toBe("seguranca");
    expect(abaInicialDoPerfil("foto", todas)).toBe("dados");
    expect(abaInicialDoPerfil("conta", todas)).toBe("dados");
    expect(abaInicialDoPerfil("notificacoes", todas)).toBe("preferencias");
    expect(abaInicialDoPerfil("preferencias", abasDoPerfil({ notificacoes: false }))).toBe("dados");
    expect(abaInicialDoPerfil(null, todas)).toBe("dados");
    expect(abaInicialDoPerfil("../x", todas)).toBe("dados");
  });

  it("o que mudou: só os campos alterados; telefone vazio apaga; e-mail só quando editável, com confirmação e senha", () => {
    const antes = { nome: "Ana", email: "ana@ficticio.test", telefone: "" };
    expect(alteracoesDoPerfil(antes, { ...antes }, { emailEditavel: true })).toBeNull();
    expect(alteracoesDoPerfil(antes, { ...antes, nome: " Ana Maria " }, { emailEditavel: true })).toEqual({ nome: "Ana Maria" });
    expect(alteracoesDoPerfil(antes, { ...antes, telefone: "(11) 90000-0000" }, { emailEditavel: true })).toEqual({ telefone: "(11) 90000-0000" });
    expect(alteracoesDoPerfil({ ...antes, telefone: "11" }, { ...antes, telefone: " " }, { emailEditavel: true })).toEqual({ telefone: null });
    expect(alteracoesDoPerfil(antes, { ...antes, email: "nova@ficticio.test", confirmacaoEmail: "nova@ficticio.test", senhaAtual: "s" }, { emailEditavel: true }))
      .toEqual({ email: "nova@ficticio.test", confirmacaoEmail: "nova@ficticio.test", senhaAtual: "s" });
    expect(alteracoesDoPerfil(antes, { ...antes, email: "nova@ficticio.test" }, { emailEditavel: false })).toBeNull();
    expect(alteracoesDoPerfil(antes, { ...antes, email: "ANA@ficticio.test" }, { emailEditavel: true })).toBeNull();
  });

  it("o perfil de acesso aparece UMA vez (o nome do perfil, ou o papel)", () => {
    expect(linhaDaConta(null, "Administrador", "Clima Total")).toBe("Administrador · Clima Total");
    expect(linhaDaConta("Financeiro", "Operador", "Clima Total")).toBe("Financeiro · Clima Total");
    expect(linhaDaConta("  ", "Gestor", "")).toBe("Gestor");
  });
});

describe("botão de anotações arrastável", () => {
  const janela = { w: 1440, h: 900 };
  const botao = { w: 110, h: 36 };
  it("posição por usuário; leitura tolerante (nada, lixo, número inválido = posição padrão)", () => {
    expect(chavePosicaoBotao("u1")).toBe("frivo:anotacoes-botao:u1");
    expect(chavePosicaoBotao("u1")).not.toBe(chavePosicaoBotao("u2"));
    expect(lerPosicao(JSON.stringify({ x: 10, y: 20 }))).toEqual({ x: 10, y: 20 });
    for (const t of [null, "", "lixo", "[]", '{"x":"1","y":2}', '{"x":1}', '{"x":null,"y":1}', "123"]) expect(lerPosicao(t), String(t)).toBeNull();
  });

  it("nunca sai da área visível (com a folga), nem se a janela encolher", () => {
    expect(limitarPosicao({ x: -50, y: -9 }, botao, janela)).toEqual({ x: 8, y: 8 });
    expect(limitarPosicao({ x: 5000, y: 5000 }, botao, janela)).toEqual({ x: 1440 - 110 - 8, y: 900 - 36 - 8 });
    expect(limitarPosicao({ x: 100.6, y: 200.2 }, botao, janela)).toEqual({ x: 101, y: 200 });
    expect(limitarPosicao({ x: 500, y: 500 }, botao, { w: 100, h: 30 })).toEqual({ x: 8, y: 8 }); // janela menor que o botão
  });

  it("arraste × clique: abaixo do limiar é clique; o botão anda o quanto o ponteiro andou", () => {
    expect(ehArraste({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(ehArraste({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true);
    expect(posicaoArrastada({ x: 1000, y: 800 }, { x: 1050, y: 820 }, { x: 950, y: 600 }, botao, janela)).toEqual({ x: 900, y: 580 });
    expect(posicaoArrastada({ x: 1000, y: 800 }, { x: 1050, y: 820 }, { x: 3000, y: 3000 }, botao, janela)).toEqual({ x: 1322, y: 856 });
  });
});
