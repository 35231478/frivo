/**
 * ACABAMENTOS DO GO-LIVE (leva 3) — as regras puras.
 *  a) Orçamentos: um termo só para a validade que passou — "Vencido";
 *  b) Satisfação do cliente = média das notas do aceite das OS, com a quantidade;
 *  c) Sino: o técnico só recebe o que é dele; nota baixa do aceite é aviso do escritório;
 *  d) PMOC: Renovar cria plano → pmoc.criar (estrutural, aqui; o 403 real está no teste PG);
 *  e) "licitacoes": fora do código; a chave antiga nos perfis gravados não trava ninguém;
 *  f) Trilha do topo: o nome do registro no lugar do id.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LABELS_ETAPA, marcosCiclo, type EtapaCiclo } from "@/lib/orcamentos/ciclo";
import { resumoSatisfacao, satisfacaoPorCliente, mediaTexto, avaliacoesTexto, SEM_AVALIACAO } from "@/lib/clientes/satisfacao";
import { escopoDoSino, ehNotaBaixa, NOTA_BAIXA_ACEITE } from "@/lib/alertas/sino";
import {
  MODULOS, MODULOS_REMOVIDOS, PRESETS, SECOES, moduloDaRota, montarPermissoes, permissoesExcedentes, permissoesTotais, portaoBarra,
} from "@/lib/permissoes";
import { gerarBreadcrumb, ehIdDeRegistro } from "@/components/layout/header";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");

/* ───────────────────────── a) orçamentos: "Vencido" ───────────────────────── */

describe("a) orçamentos: a validade que passou se chama Vencido — em toda a área", () => {
  it("o selo e o marco do ciclo dizem Vencido (a chave interna continua EXPIRADO)", () => {
    expect(LABELS_ETAPA.EXPIRADO).toBe("Vencido");
    expect(Object.values(LABELS_ETAPA)).not.toContain("Expirado");
    const venceu = { status: "ENVIADO", enviadoEm: "2026-11-01T12:00:00Z", visualizadoEm: null, validadeEm: "2026-11-10T00:00:00Z", criadoEm: "2026-10-30T12:00:00Z" };
    const marcos = marcosCiclo(venceu as any, new Date("2026-11-26T15:00:00Z"));
    expect(marcos.find((m) => (m.etapa as EtapaCiclo) === "EXPIRADO")?.rotulo).toBe("Vencido (passou da validade sem resposta)");
  });

  it("nenhum texto da área (o que o cliente e o escritório leem) fala mais em expirado/expirou/expire", () => {
    const arquivos = [
      "lib/orcamentos/ciclo.ts", "app/(publico)/orcamento/[token]/page.tsx", "app/api/publico/orcamentos/[token]/aprovar/route.ts",
      "app/api/publico/orcamentos/[token]/recusar/route.ts", "components/orcamento/painel-totais-orcamentos.tsx",
      "components/orcamento/orcamentos-periodo.tsx", "components/orcamento/ciclo-orcamento.tsx", "components/orcamento/acoes-envio.tsx",
      "components/config/email-config-client.tsx",
    ];
    for (const f of arquivos) {
      // só os TEXTOS (entre aspas) contam: a chave EXPIRADO e nomes de variável não aparecem para ninguém
      const textos = [...fonte(f).matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2]).filter((t) => t && !/^[A-Z_]+$/.test(t));
      // fora dos ${…} (código) e sem a chave em maiúsculas: "Expirado", "expirado", "expirou", "expire"
      const lidos = textos.map((t) => t.replace(/\$\{[^}]*\}/g, ""));
      expect(lidos.filter((t) => /[Ee]xpirad[oa]|expirou|expire\b/.test(t)), f).toEqual([]);
    }
    const emails = fonte("lib/email-templates.ts");
    expect(emails).toContain('assunto: "Orçamento {{numero_orcamento}} venceu — podemos renovar?"');
    expect(emails).toContain("venceu sem resposta");
    expect(emails).toContain("antes do vencimento");
    expect(emails).not.toMatch(/orçamento[^"]*expir/i);
  });

  it("card, filtro e selo usam a mesma palavra", () => {
    expect(fonte("components/orcamento/orcamentos-periodo.tsx")).toContain('rotulo: "Vencidos"');
    expect(fonte("components/orcamento/painel-totais-orcamentos.tsx")).toContain('rotulo: "Vencidos"');
    expect(fonte("app/(publico)/orcamento/[token]/page.tsx")).toContain('titulo="Orçamento vencido"');
  });
});

/* ───────────────────────── b) satisfação ───────────────────────── */

describe("b) satisfação = média do aceite das OS", () => {
  it("média com uma casa e a quantidade; só notas inteiras de 1 a 5 contam", () => {
    expect(resumoSatisfacao([5, 4, 5, 5])).toEqual({ media: 4.8, avaliacoes: 4 });
    expect(resumoSatisfacao([3, 2])).toEqual({ media: 2.5, avaliacoes: 2 });
    expect(resumoSatisfacao([1])).toEqual({ media: 1, avaliacoes: 1 });
    expect(resumoSatisfacao([4, null, undefined, 0, 6, 3.5, 5])).toEqual({ media: 4.5, avaliacoes: 2 });
    expect(resumoSatisfacao([])).toEqual(SEM_AVALIACAO);
    expect(resumoSatisfacao([4, 4, 5])).toEqual({ media: 4.3, avaliacoes: 3 }); // 4,333… → 4,3
  });

  it("agrupa por cliente; aceite sem nota não entra", () => {
    const m = satisfacaoPorCliente([
      { clienteId: "a", avaliacao: 5 }, { clienteId: "b", avaliacao: 2 }, { clienteId: "a", avaliacao: 3 }, { clienteId: "c", avaliacao: null },
    ]);
    expect(m.get("a")).toEqual({ media: 4, avaliacoes: 2 });
    expect(m.get("b")).toEqual({ media: 2, avaliacoes: 1 });
    expect(m.has("c")).toBe(false);
  });

  it("textos: \"4,8\" e \"1 avaliação\" / \"12 avaliações\"", () => {
    expect(mediaTexto(4.8)).toBe("4,8");
    expect(mediaTexto(5)).toBe("5,0");
    expect(avaliacoesTexto(1)).toBe("1 avaliação");
    expect(avaliacoesTexto(12)).toBe("12 avaliações");
  });

  it("a coluna mostra a média do aceite de cada cliente e não ordena pelo campo manual antigo", () => {
    expect(fonte("lib/listas/ordenacao.ts")).not.toContain("satisfacao");
    const lista = fonte("app/(dashboard)/clientes/page.tsx");
    expect(lista).toContain('{ id: "satisfacao", titulo: "Satisfação", largura: 110, oculta: true }');
    expect(lista).toContain("const satisfacao = await satisfacaoDosClientes(empresaId, clientes.map((c) => c.id));");
    expect(lista).toContain("satisfacao: <SatisfacaoCelula resumo={satisfacao.get(c.id)} />,");
    expect(lista).not.toContain("c.satisfacao");
  });

  it("o campo manual sai da tela e a edição não apaga o que estava gravado", () => {
    const form = fonte("components/forms/cliente-form.tsx");
    expect(form).not.toContain("StarRating");
    expect(form).not.toContain("setSatisfacao");
    expect(fonte("app/api/clientes/[id]/route.ts")).toContain("...(satisfacao !== undefined && { satisfacao }),");
  });
});

/* ───────────────────────── c) sino ───────────────────────── */

describe("c) sino: cada um recebe o que é dele", () => {
  const DA_EMPRESA = ["prazos", "comprasPendentes", "veiculos", "boletos", "orcamentos", "fiscal", "medicoes", "reajustes", "separacao", "pmoc", "admissoes", "notaBaixa"] as const;

  it("técnico no modo técnico: só aceites das OS dele e a NF dos próprios pedidos — nada da empresa inteira", () => {
    const e = escopoDoSino({ permissoes: PRESETS.TECNICO, role: "TECNICO", restrito: true });
    for (const k of DA_EMPRESA) expect(e[k], k).toBe(false);
    expect(e.aceites).toBe(true);
    expect(e.nfDosMeusPedidos).toBe(true);
    // mesmo um técnico com permissões a mais, se está no modo técnico, não recebe o da empresa
    const comTudo = escopoDoSino({ permissoes: permissoesTotais(), role: "TECNICO", restrito: true });
    for (const k of DA_EMPRESA) expect(comTudo[k], k).toBe(false);
  });

  it("escritório: o que a permissão deixa — e a nota baixa para quem vê OS", () => {
    const sup = escopoDoSino({ permissoes: PRESETS.SUPERVISOR, role: "OPERADOR", restrito: false });
    expect(sup).toMatchObject({ prazos: true, veiculos: true, notaBaixa: true, aceites: true, separacao: true, boletos: false, orcamentos: false, fiscal: false });
    const fin = escopoDoSino({ permissoes: PRESETS.FINANCEIRO, role: "OPERADOR", restrito: false });
    expect(fin).toMatchObject({ boletos: true, orcamentos: true, fiscal: true, comprasPendentes: true, notaBaixa: true, veiculos: false });
    const admin = escopoDoSino({ permissoes: null, role: "ADMIN", restrito: false });
    for (const k of DA_EMPRESA) expect(admin[k], k).toBe(true);
    // sem ver OS, nada de aceite nem nota baixa
    const semOs = escopoDoSino({ permissoes: montarPermissoes({ financeiro: ["visualizar", "contasReceber"] }), role: "OPERADOR", restrito: false });
    expect([semOs.aceites, semOs.notaBaixa, semOs.prazos]).toEqual([false, false, false]);
  });

  it("nota baixa: 1 ou 2 estrelas; sem nota não é nota baixa", () => {
    expect(NOTA_BAIXA_ACEITE).toBe(2);
    expect([1, 2, 3, 5].map(ehNotaBaixa)).toEqual([true, true, false, false]);
    expect([null, undefined, 0].map(ehNotaBaixa)).toEqual([false, false, false]);
  });

  it("a rota usa a regra (não há conferência de permissão solta) e soma a nota baixa no total", () => {
    const rota = fonte("app/api/alertas/route.ts");
    expect(rota).toContain("const e = escopoDoSino({ permissoes, role, restrito: escopoTecnico.restrito });");
    expect(rota).not.toMatch(/\bpode\(/);
    expect(rota).toContain("{ separarNotaBaixa: e.notaBaixa }");
    expect(rota).toContain("aceites.avaliacoesBaixas");
  });
});

/* ───────────────────────── d) PMOC ───────────────────────── */

describe("d) PMOC: Renovar exige pmoc.criar — tela e rota", () => {
  it("o botão, a rota (prévia e renovação) e a frase do aviso pedem \"criar\"", () => {
    expect(fonte("components/pmoc/pmoc-renovar.tsx")).toContain('if (!pode("pmoc", "criar")) return null;');
    const rota = fonte("app/api/pmocs/[id]/renovacao/route.ts");
    expect(rota.match(/exigirPermissao\("pmoc", "criar"\)/g)?.length).toBe(2);
    expect(rota).not.toContain('exigirPermissao("pmoc", "editar")');
    expect(fonte("components/pmoc/pmoc-editor.tsx")).toContain('{pode("pmoc", "criar") && " Use “Renovar”');
  });
});

/* ───────────────────────── e) licitações ───────────────────────── */

describe("e) o módulo fantasma \"licitacoes\" saiu", () => {
  it("não está no cadastro de perfis, no portão, nem no preset Financeiro", () => {
    expect(MODULOS.map((m) => m.id)).not.toContain("licitacoes");
    expect(SECOES.flatMap((s) => s.modulos.map((m) => m.label))).not.toContain("Licitações");
    expect(moduloDaRota("/licitacoes")).toBeNull();
    expect(portaoBarra("/licitacoes", montarPermissoes({}), "OPERADOR")).toBe(false); // rota inexistente: 404 da casa
    expect(Object.keys(PRESETS.FINANCEIRO)).not.toContain("licitacoes");
    expect(MODULOS_REMOVIDOS).toEqual(["licitacoes"]);
  });

  it("a chave antiga nos perfis gravados não trava quem edita um perfil (permissão invisível não conta)", () => {
    const gestor = montarPermissoes({ financeiro: ["visualizar"] });
    const perfilAntigo = { ...montarPermissoes({ financeiro: ["visualizar"] }), licitacoes: { visualizar: true, gerenciar: true } };
    expect(permissoesExcedentes(gestor, perfilAntigo as any)).toEqual([]);
    // e um módulo que existe continua sendo conferido
    expect(permissoesExcedentes(gestor, { ...perfilAntigo, estoque: { visualizar: true } } as any)).toEqual(["estoque.visualizar"]);
  });
});

/* ───────────────────────── f) trilha ───────────────────────── */

describe("f) trilha do topo: o nome do registro, não o id", () => {
  const OS = "cmwxrblvo00107dr38pvjmc4b", CLI = "cmx0clienteaaaaaaaaaaaaa1", ORC = "cmx0orcamentoaaaaaaaaaaa1";
  it("com o nome informado pela página, o id vira o nome; sem nome, \"Detalhes\"", () => {
    const nomes = new Map([[OS, "OS-2024-0001"], [CLI, "Clínica Vida Plena"], [ORC, "ORC-L3-001"]]);
    expect(gerarBreadcrumb(`/ordens/${OS}`, nomes).map((i) => i.label)).toEqual(["Ordens de serviço", "OS-2024-0001"]);
    expect(gerarBreadcrumb(`/clientes/${CLI}/editar`, nomes).map((i) => i.label)).toEqual(["Clientes", "Clínica Vida Plena", "Editar"]);
    expect(gerarBreadcrumb(`/orcamentos/${ORC}`, nomes).map((i) => i.label)).toEqual(["Orçamentos", "ORC-L3-001"]);
    expect(gerarBreadcrumb(`/ordens/${OS}`).map((i) => i.label)).toEqual(["Ordens de serviço", "Detalhes"]);
    // o link do item continua sendo o endereço do registro
    expect(gerarBreadcrumb(`/clientes/${CLI}/editar`, nomes)[1].href).toBe(`/clientes/${CLI}`);
  });

  it("só id vira nome: palavra da rota nunca é trocada", () => {
    expect(ehIdDeRegistro(OS)).toBe(true);
    expect(ehIdDeRegistro("editar")).toBe(false);
    expect(gerarBreadcrumb("/clientes/novo", new Map([["novo", "x"]])).map((i) => i.label)).toEqual(["Clientes", "Novo"]);
    // palavra sem rótulo fixo também não: só segmento com cara de id troca pelo nome
    expect(gerarBreadcrumb("/clientes/importados", new Map([["importados", "x"]])).map((i) => i.label)).toEqual(["Clientes", "Importados"]);
  });

  it("as três telas informam o nome; o registro do nome é só no navegador (efeito, não render)", () => {
    expect(fonte("components/os/os-detalhe.tsx")).toContain("<NomeNaTrilha id={os.id} nome={os.chamadoNumero ?? os.numero} />");
    expect(fonte("components/forms/cliente-form.tsx")).toContain("<NomeNaTrilha id={initialData!.id} nome={initialData!.nomeFantasia || initialData!.nome} />");
    expect(fonte("app/(dashboard)/orcamentos/[id]/page.tsx")).toContain("<NomeNaTrilha id={orcamento.id} nome={orcamento.codigo} />");
    const comp = fonte("components/layout/nome-na-trilha.tsx");
    expect(comp).toMatch(/useEffect\(\(\) => \{[\s\S]*nomes\.set\(id, n\)/);
    expect(comp).toContain("() => 0,"); // no servidor, a versão é sempre 0 (nada compartilhado entre requisições)
  });
});
