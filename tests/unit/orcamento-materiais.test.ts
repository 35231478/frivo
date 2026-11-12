/**
 * Estoque E3.3 — materiais e peças no orçamento: a REGRA PURA (lib/orcamentos/materiais.ts) e o cálculo único
 * do orçamento com ela (lib/orcamento-helpers › montarValoresOrcamento). Prova:
 *  - materializar: o kit explode em itens soltos (quantidade editável independente), quantidade padrão = a da
 *    composição, venda = tabela do cliente ou padrão, custo interno separado;
 *  - material INCLUSO ajusta o serviço pela diferença do padrão (tubo 3→5, filtro secador 1→3, suporte 1→10);
 *    material novo (padrão 0) entra integral; usar menos abate; "não usado" (0) abate o padrão todo;
 *  - PEÇA (venda à parte) vira linha de produto (qtd × venda), fora do serviço; nunca entra no ajuste;
 *  - valor manual: o total digitado vale; serviço sem materiais segue como sempre (o total manda);
 *  - custo (último custo de compra) só no resumo interno: nunca no preço;
 *  - no orçamento inteiro: total dos serviços = base + ajuste; total dos produtos = produtos + peças; o cliente
 *    (versaoCliente) não vê material nenhum;
 *  - ação em massa "Definir categoria" (bônus): registrada em produtos com a permissão do cadastro; o formulário
 *    aceita só categoriaProdutoId (id ou vazio = tirar).
 */
import { describe, expect, it } from "vitest";
import type { MaterialEfetivo } from "@/lib/estoque/composicao";
import {
  ajusteDosMateriais, diferencaDoMaterial, ehPeca, erroDosMateriais, materialAvulso, materializarComposicao, pecasDosMateriais,
  prepararServicosComMateriais, resumoMateriais, valorDaLinha, type MaterialOrcamento,
} from "@/lib/orcamentos/materiais";
import { montarValoresOrcamento } from "@/lib/orcamento-helpers";
import { versaoCliente } from "@/lib/orcamentos/calculo";
import { orcamentoSchema } from "@/lib/validations";
import { ACOES_ITEM, ENTIDADE } from "@/lib/acoes-massa/acoes";
import { prepararDefinirCategoria } from "@/lib/acoes-massa/categoria-produtos";

const ef = (produtoId: string, nome: string, quantidade: number, comportamento: MaterialEfetivo["comportamento"], origem: MaterialEfetivo["origem"] = { tipo: "solto" }, unidade = "un"): MaterialEfetivo =>
  ({ produtoId, nome, unidade, quantidade, comportamento, origem, inativo: false });
const KIT = { tipo: "kit" as const, kitId: "k1", kitNome: "Kit instalação" };
// A composição do serviço "Instalação" expandida (E3.2): tubo e filtro inclusos (tubo vem do kit), suporte incluso, capacitor = peça
const EFETIVOS: MaterialEfetivo[] = [
  ef("tubo", "Tubo de cobre 1/4", 3, "INCLUSO_NO_SERVICO", KIT, "m"),
  ef("filtro", "Filtro secador", 1, "INCLUSO_NO_SERVICO", KIT),
  ef("suporte", "Suporte", 1, "INCLUSO_NO_SERVICO"),
  ef("capacitor", "Capacitor 35uF", 1, "VENDA_A_PARTE"),
];
const PRECOS = new Map([["tubo", 20], ["filtro", 35], ["suporte", 60], ["capacitor", 80]]);
const CUSTOS = new Map([["tubo", 12], ["filtro", 20], ["capacitor", 45]]);
const materializar = () => materializarComposicao(EFETIVOS, (id) => PRECOS.get(id), CUSTOS).map((m, i) => ({ ...m, id: `m${i}` }));
const porProduto = (ms: MaterialOrcamento[], id: string) => ms.find((m) => m.produtoId === id)!;
const com = (ms: MaterialOrcamento[], mudancas: Record<string, Partial<MaterialOrcamento>>) => ms.map((m) => (mudancas[m.produtoId!] ? { ...m, ...mudancas[m.produtoId!] } : m));

describe("materializar a composição no orçamento", () => {
  it("o kit explode em itens soltos; padrão = quantidade da composição; venda pela tabela/padrão; custo interno; origem guardada", () => {
    const ms = materializar();
    expect(ms.map((m) => [m.produtoId, m.quantidade, m.quantidadePadrao, m.valorVendaUnit, m.custoUnit, m.origem, m.kitNome, m.comportamento])).toEqual([
      ["tubo", 3, 3, 20, 12, "KIT", "Kit instalação", "INCLUSO_NO_SERVICO"],
      ["filtro", 1, 1, 35, 20, "KIT", "Kit instalação", "INCLUSO_NO_SERVICO"],
      ["suporte", 1, 1, 60, null, "SOLTO", null, "INCLUSO_NO_SERVICO"],
      ["capacitor", 1, 1, 80, 45, "SOLTO", null, "VENDA_A_PARTE"],
    ]);
    expect(ms.map((m) => m.unidade)).toEqual(["m", "un", "un", "un"]);
    // Não existe mais "quantidade de kit": cada item é uma linha própria
    expect(ms.filter((m) => m.origem === "KIT")).toHaveLength(2);
    // Produto sem preço = 0 (não quebra)
    expect(materializarComposicao([ef("x", "Sem preço", 2, "INCLUSO_NO_SERVICO")], () => undefined, new Map())[0]).toMatchObject({ valorVendaUnit: 0, custoUnit: null });
  });

  it("material avulso: padrão 0 (entra integral), comportamento pela categoria do produto (estranho = incluso)", () => {
    expect(materialAvulso({ produtoId: "p", nome: "Fita", comportamento: "VENDA_A_PARTE", valorVendaUnit: "12,5" as unknown as number, custoUnit: 7 })).toMatchObject({ quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 0, origem: "AVULSO", comportamento: "VENDA_A_PARTE" });
    expect(materialAvulso({ produtoId: "p", nome: "Fita", comportamento: "GRATIS", valorVendaUnit: 12.5, quantidade: 3 })).toMatchObject({ quantidade: 3, valorVendaUnit: 12.5, comportamento: "INCLUSO_NO_SERVICO", custoUnit: null, unidade: "un" });
  });
});

describe("material incluso ajusta o serviço pela diferença do padrão", () => {
  it("tubo 3→5 (+2 × 20), filtro secador 1→3 (+2 × 35), suporte 1→10 (+9 × 60): +40 +70 +540 = +650; a peça não entra", () => {
    const ms = com(materializar(), { tubo: { quantidade: 5 }, filtro: { quantidade: 3 }, suporte: { quantidade: 10 } });
    expect([porProduto(ms, "tubo"), porProduto(ms, "filtro"), porProduto(ms, "suporte"), porProduto(ms, "capacitor")].map(diferencaDoMaterial)).toEqual([40, 70, 540, 0]);
    expect(ajusteDosMateriais(ms)).toBe(650);
    // Serviço de 800: vale 1.450; o unitário efetivo acompanha
    expect(valorDaLinha({ quantidade: 1, valorUnitario: 800, materiais: ms })).toEqual({ temMateriais: true, valorBase: 800, ajuste: 650, valorManual: false, valorTotal: 1450, valorUnitario: 1450 });
  });

  it("no padrão nada muda; usar menos abate; 'não usado' (0) abate o padrão inteiro; material novo (padrão 0) entra integral; nunca fica negativo", () => {
    const ms = materializar();
    expect(ajusteDosMateriais(ms)).toBe(0);
    expect(valorDaLinha({ quantidade: 2, valorUnitario: 400, materiais: ms }).valorTotal).toBe(800);
    expect(ajusteDosMateriais(com(ms, { tubo: { quantidade: 2 } }))).toBe(-20);
    expect(ajusteDosMateriais(com(ms, { suporte: { quantidade: 0 } }))).toBe(-60);
    const avulso = materialAvulso({ produtoId: "fita", nome: "Fita", comportamento: "INCLUSO_NO_SERVICO", valorVendaUnit: 15, quantidade: 2 });
    expect(ajusteDosMateriais([...ms, avulso])).toBe(30);
    // Abatimento maior que a base: o serviço não fica negativo
    expect(valorDaLinha({ quantidade: 1, valorUnitario: 50, materiais: com(ms, { suporte: { quantidade: 0 }, tubo: { quantidade: 0 } }) }).valorTotal).toBe(0);
    // Centavos: 0,333 m × 20 = 6,66 (arredonda a 2 casas)
    expect(ajusteDosMateriais(com(ms, { tubo: { quantidade: 3.333 } }))).toBe(6.66);
  });

  it("valor manual: o total digitado vale (independente do cálculo); sem materiais, o serviço funciona como sempre", () => {
    const ms = com(materializar(), { tubo: { quantidade: 5 } });
    expect(valorDaLinha({ quantidade: 1, valorUnitario: 800, valorTotal: 999, valorManual: true, materiais: ms })).toMatchObject({ valorManual: true, valorTotal: 999, valorUnitario: 999, valorBase: 800, ajuste: 40 });
    expect(valorDaLinha({ quantidade: 2, valorUnitario: 800, valorTotal: 999, valorManual: true, materiais: ms }).valorUnitario).toBe(499.5);
    // Manual sem total digitado não vale: volta ao cálculo
    expect(valorDaLinha({ quantidade: 1, valorUnitario: 800, valorManual: true, materiais: ms }).valorTotal).toBe(840);
    // Sem materiais: o total manda (como sempre), unitário como veio
    expect(valorDaLinha({ quantidade: 3, valorUnitario: 33.33, valorTotal: 100 })).toEqual({ temMateriais: false, valorBase: null, ajuste: 0, valorManual: false, valorTotal: 100, valorUnitario: 33.33 });
    expect(valorDaLinha({ quantidade: 2, valorUnitario: 50, materiais: [] }).valorTotal).toBe(100);
  });
});

describe("peças (venda à parte) e o resumo interno", () => {
  it("peça vira linha de produto (qtd × venda), fora do serviço; peça com quantidade 0 não vira linha", () => {
    const ms = com(materializar(), { capacitor: { quantidade: 2 } });
    expect(pecasDosMateriais(ms)).toEqual([expect.objectContaining({ descricao: "Capacitor 35uF", quantidade: 2, valorUnitario: 80, valorTotal: 160 })]);
    expect(pecasDosMateriais(com(ms, { capacitor: { quantidade: 0 } }))).toEqual([]);
    expect(pecasDosMateriais(null)).toEqual([]);
    expect([ehPeca(porProduto(ms, "capacitor")), ehPeca(porProduto(ms, "tubo"))]).toEqual([true, false]);
    // Peça não ajusta o serviço, mesmo acima do padrão
    expect(ajusteDosMateriais(ms)).toBe(0);
  });

  it("custo é só interno: entra no resumo (margem), nunca no ajuste nem na peça; produto sem custo é contado", () => {
    const ms = com(materializar(), { tubo: { quantidade: 5 }, capacitor: { quantidade: 2 } });
    const r = resumoMateriais(ms);
    // Inclusos: tubo 5 × 12 = 60 + filtro 1 × 20 = 20 (suporte sem custo); peças: capacitor 2 × 45 = 90
    expect(r).toEqual({ ajuste: 40, pecas: 160, quantasPecas: 1, custoInclusos: 80, custoPecas: 90, custoTotal: 170, semCusto: 1 });
    // Mudar o custo não mexe em preço nenhum
    const caro = ms.map((m) => ({ ...m, custoUnit: 999 }));
    expect(ajusteDosMateriais(caro)).toBe(40);
    expect(pecasDosMateriais(caro)[0].valorTotal).toBe(160);
    expect(resumoMateriais(com(ms, { tubo: { quantidade: 0 } })).custoInclusos).toBe(20); // não usado não custa
  });

  it("conferência pura das linhas", () => {
    const ms = materializar();
    expect(erroDosMateriais(ms)).toBeNull();
    expect(erroDosMateriais([{ ...ms[0], descricao: " " }])).toMatch(/descrição/);
    expect(erroDosMateriais([{ ...ms[0], comportamento: "GRATIS" as never }])).toMatch(/Comportamento/);
    expect(erroDosMateriais([{ ...ms[0], quantidade: -1 }])).toMatch(/negativa/);
    expect(erroDosMateriais([{ ...ms[0], valorVendaUnit: -1 }])).toMatch(/negativo/);
    expect(erroDosMateriais([{ ...ms[0], custoUnit: -1 }])).toMatch(/negativo/);
    expect(erroDosMateriais([{ ...ms[0], origem: "MAGICA" as never }])).toMatch(/Origem/);
    expect(erroDosMateriais([{ ...ms[0], quantidade: 0 }])).toBeNull(); // "não usado" é válido
  });
});

describe("o orçamento inteiro com materiais (montarValoresOrcamento + versaoCliente)", () => {
  const entrada = (extra: Record<string, unknown> = {}) => orcamentoSchema.parse({
    clienteId: "c1",
    servicos: [
      { catalogoId: "s1", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 1450, materiais: com(materializar(), { tubo: { quantidade: 5 }, filtro: { quantidade: 3 }, suporte: { quantidade: 10 }, capacitor: { quantidade: 2 } }) },
      { catalogoId: "s2", descricao: "Limpeza", quantidade: 2, valorUnitario: 150 },
    ],
    produtos: [{ catalogoId: "p9", descricao: "Controle remoto", quantidade: 1, valorUnitario: 90 }],
    ...extra,
  });

  it("serviço = base + ajuste (o unitário gravado é o efetivo); produtos = os do usuário + as peças, nessa ordem; totais separados", () => {
    const v = montarValoresOrcamento(entrada(), 0);
    expect(v.servicos[0]).toMatchObject({ servicoId: "s1", valorBase: 800, ajusteMateriais: 650, valorManual: false, valorTotal: 1450, valorUnitario: 1450 });
    expect(v.servicos[0].materiais).toHaveLength(4);
    expect(v.servicos[0].materiais.map((m) => [m.produtoId, m.quantidade, m.quantidadePadrao, m.ordem])).toEqual([["tubo", 5, 3, 0], ["filtro", 3, 1, 1], ["suporte", 10, 1, 2], ["capacitor", 2, 1, 3]]);
    expect(v.servicos[1]).toMatchObject({ valorBase: null, ajusteMateriais: 0, valorManual: false, valorTotal: 300, valorUnitario: 150, materiais: [] });
    expect(v.produtos).toEqual([expect.objectContaining({ produtoId: "p9", valorTotal: 90, ordem: 0 })]);
    expect(v.pecas).toEqual([expect.objectContaining({ produtoId: "capacitor", descricao: "Capacitor 35uF", quantidade: 2, valorUnitario: 80, valorTotal: 160, ordem: 1, idxServico: 0, idxMaterial: 3 })]);
    // Totais: serviços 1.450 + 300; produtos 90 + 160 (peça à parte, separada do serviço)
    expect(v.campos).toMatchObject({ totalServicos: 1750, totalProdutos: 250, totalGeral: 2000 });
  });

  it("valor manual na linha vale no total; sem materiais no corpo nada muda (orçamento antigo)", () => {
    const manual = montarValoresOrcamento(entrada({ servicos: [{ catalogoId: "s1", descricao: "Instalação", quantidade: 1, valorUnitario: 800, valorTotal: 1000, valorManual: true, materiais: com(materializar(), { tubo: { quantidade: 5 } }) }] }), 0);
    expect(manual.servicos[0]).toMatchObject({ valorBase: 800, ajusteMateriais: 40, valorManual: true, valorTotal: 1000, valorUnitario: 1000 });
    expect(manual.campos.totalServicos).toBe(1000);
    const antigo = montarValoresOrcamento(orcamentoSchema.parse({ clienteId: "c1", servicos: [{ descricao: "X", quantidade: 3, valorUnitario: 33.33, valorTotal: 100 }], produtos: [] }), 5);
    expect(antigo.servicos[0]).toMatchObject({ valorTotal: 100, valorUnitario: 33.33, valorBase: null, ajusteMateriais: 0, valorManual: false, materiais: [] });
    expect(antigo.pecas).toEqual([]);
    expect(antigo.campos).toMatchObject({ totalServicos: 100, valorIss: 5, totalGeral: 105 });
  });

  it("o cliente vê a linha do serviço já ajustada e as peças como produtos; nenhum material/custo aparece; ISS embutido continua fechando", () => {
    const v = montarValoresOrcamento(entrada({ descontoServicos: 50 }), 5);
    const vc = versaoCliente({ servicos: v.servicos, produtos: [...v.produtos, ...v.pecas], descontoServicos: 50, issAliquota: 5 });
    expect(vc.servicos.map((s) => s.valorTotal).reduce((a, b) => a + b, 0)).toBe(vc.subtotalServicos);
    expect(vc.produtos.map((p) => [p.quantidade, p.valorTotal])).toEqual([[1, 90], [2, 160]]);
    expect(vc.totalProdutos).toBe(250);
    // Serviços líquidos 1.700 + ISS 85 = 1.785; total 2.035
    expect(vc.totalServicos).toBe(1785);
    expect(vc.totalGeral).toBe(2035);
    expect(JSON.stringify(vc)).not.toMatch(/custo|Tubo|Filtro secador|Suporte|material/i);
  });

  it("o schema recusa material inválido e campo estranho; aceita 'não usado' e manual", () => {
    const base = { clienteId: "c1", produtos: [] };
    const linha = (m: Record<string, unknown>) => ({ ...base, servicos: [{ descricao: "S", quantidade: 1, valorUnitario: 10, materiais: [m] }] });
    const ok = { descricao: "Tubo", comportamento: "INCLUSO_NO_SERVICO", quantidade: "2,5", quantidadePadrao: 3, valorVendaUnit: 20, custoUnit: null, origem: "KIT", kitNome: "K" };
    expect(orcamentoSchema.safeParse(linha(ok)).success).toBe(true);
    expect(orcamentoSchema.safeParse(linha({ ...ok, quantidade: 0 })).success).toBe(true);
    expect(orcamentoSchema.safeParse(linha({ ...ok, comportamento: "GRATIS" })).success).toBe(false);
    expect(orcamentoSchema.safeParse(linha({ ...ok, quantidade: -1 })).success).toBe(false);
    expect(orcamentoSchema.safeParse(linha({ ...ok, descricao: "" })).success).toBe(false);
    expect(orcamentoSchema.safeParse(linha({ ...ok, origem: "MAGICA" })).success).toBe(false);
    expect(orcamentoSchema.safeParse(linha({ ...ok, empresaId: "e2" })).success).toBe(false);
    const r = orcamentoSchema.safeParse(linha({ ...ok, quantidade: "2,5" }));
    expect(r.success && (r.data.servicos[0].materiais![0] as { quantidade: number }).quantidade).toBe(2.5);
    expect(orcamentoSchema.parse({ ...base, servicos: [{ descricao: "S", quantidade: 1, valorUnitario: 10 }] }).servicos[0]).toMatchObject({ valorManual: false });
  });
});

describe("ação em massa 'Definir categoria' (bônus)", () => {
  it("registrada só em produtos, com a permissão do cadastro (Configurações › gerenciar) e formulário próprio", () => {
    expect(ACOES_ITEM).toContain("definir-categoria");
    const def = ENTIDADE.produtos.acoes["definir-categoria"]!;
    expect(def).toMatchObject({ rotulo: "Definir categoria", formulario: "categoria-produto", permissao: [["configuracoes", "gerenciar"]] });
    for (const [e, d] of Object.entries(ENTIDADE)) if (e !== "produtos") expect(d.acoes["definir-categoria"], e).toBeUndefined();
    expect(Object.keys(ENTIDADE.produtos.acoes)).toEqual(["inativar", "reativar", "definir-categoria"]);
  });

  it("o formulário aceita só categoriaProdutoId: id (texto curto) ou vazio = tirar; nada escolhido ou campo estranho = erro", () => {
    expect(prepararDefinirCategoria({ categoriaProdutoId: " c1 " })).toEqual({ ok: true, dados: { categoriaProdutoId: "c1" } });
    expect(prepararDefinirCategoria({ categoriaProdutoId: null })).toEqual({ ok: true, dados: { categoriaProdutoId: null } });
    expect(prepararDefinirCategoria({ categoriaProdutoId: "" })).toEqual({ ok: true, dados: { categoriaProdutoId: null } });
    expect(prepararDefinirCategoria({})).toMatchObject({ ok: false, erro: expect.stringMatching(/Escolha/) });
    expect(prepararDefinirCategoria({ categoriaProdutoId: 5 })).toMatchObject({ ok: false });
    expect(prepararDefinirCategoria({ categoriaProdutoId: "x".repeat(41) })).toMatchObject({ ok: false });
    expect(prepararDefinirCategoria({ categoriaProdutoId: "c1", nome: "hack" })).toMatchObject({ ok: false, erro: expect.stringMatching(/não permitido: nome/) });
  });
});
