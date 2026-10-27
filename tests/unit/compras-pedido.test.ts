/**
 * Pedido de Compra completo — regras puras (lib/compras/pedido.ts) e o filtro da lista central:
 * ciclo/status automático, trava ao concluir/cancelar, número PCI-AAAA-NNNN, origem (OS / orçamento
 * dentro de OS / orçamento / avulso), quem vê/envia/edita, histórico da edição, dica da última compra,
 * o que falta para enviar ao fornecedor e a busca/filtros da lista.
 */
import { describe, expect, it } from "vitest";
import {
  CICLO_PEDIDO, LABEL_STATUS_PEDIDO, MOTIVO_AVULSO_PADRAO, codigoPedidoCompra, faltaParaEnviar, mensagemFornecedor, mudancasPedido,
  origemDoPedido, pedidoEditavel, pedidoEncerrado, podeEditarPedido, podeEnviarPedido, podeVerPedido, statusAposEnvio, temAcessoCompras,
  textoUltimaCompra, totalEstimadoPedido, valorSugerido, type PedidoComparavel,
} from "@/lib/compras/pedido";
import { montarPermissoes, permissoesVazias } from "@/lib/permissoes";
import { wherePedidosCompra } from "@/lib/listas/filtros";

const usuario = (permissoes: any, id = "u1", role = "OPERADOR") => ({ id, role, permissoes });
const pedido = (extra: Partial<{ ordemServicoId: string | null; orcamentoId: string | null; compradorId: string | null; solicitanteId: string | null }> = {}) =>
  ({ ordemServicoId: null, orcamentoId: null, compradorId: null, solicitanteId: null, ...extra });

describe("ciclo e status automático", () => {
  it("a ordem do ciclo e os rótulos", () => {
    expect(CICLO_PEDIDO.map((s) => LABEL_STATUS_PEDIDO[s])).toEqual(["Solicitado", "Em cotação", "Parcial", "Concluída", "Cancelada"]);
  });
  it("baixar/enviar: só Solicitado vira Em cotação; os outros ficam", () => {
    expect(statusAposEnvio("SOLICITADO")).toBe("COTANDO");
    for (const s of ["COTANDO", "PARCIAL", "CONCLUIDO", "CANCELADO"]) expect(statusAposEnvio(s)).toBe(s);
  });
  it("concluída/cancelada (e o legado Entregue) travam a edição; o resto edita", () => {
    for (const s of ["CONCLUIDO", "CANCELADO", "ENTREGUE"]) { expect(pedidoEncerrado(s)).toBe(true); expect(pedidoEditavel(s)).toBe(false); }
    for (const s of ["SOLICITADO", "COTANDO", "PARCIAL", "COMPRADO"]) { expect(pedidoEncerrado(s)).toBe(false); expect(pedidoEditavel(s)).toBe(true); }
  });
  it("número PCI-AAAA-NNNN (4 dígitos, cresce depois de 9999)", () => {
    expect(codigoPedidoCompra(2026, 7)).toBe("PCI-2026-0007");
    expect(codigoPedidoCompra(2026, 12345)).toBe("PCI-2026-12345");
    expect(MOTIVO_AVULSO_PADRAO).toBe("Reposição de estoque");
  });
});

describe("origem do pedido", () => {
  const os = { id: "os1", numero: "OS-2026-0012" };
  it("direto da OS → a OS", () => {
    expect(origemDoPedido({ ordemServico: os })).toEqual({ tipo: "OS", os, orcamento: null });
  });
  it("orçamento dentro de uma OS → a OS (e o orçamento junto)", () => {
    expect(origemDoPedido({ orcamento: { id: "o1", codigo: "ORC-2026-0003", ordensServico: [os] } }))
      .toEqual({ tipo: "OS", os, orcamento: { id: "o1", codigo: "ORC-2026-0003" } });
  });
  it("orçamento solto → o orçamento; nada → avulso", () => {
    expect(origemDoPedido({ orcamento: { id: "o1", codigo: "ORC-1", ordensServico: [] } })).toEqual({ tipo: "ORCAMENTO", os: null, orcamento: { id: "o1", codigo: "ORC-1" } });
    expect(origemDoPedido({})).toEqual({ tipo: "AVULSO", os: null, orcamento: null });
    expect(origemDoPedido({ ordemServico: null, orcamento: null })).toEqual({ tipo: "AVULSO", os: null, orcamento: null });
  });
});

describe("quem vê, envia e edita", () => {
  const compras = montarPermissoes({ compras: ["visualizar"] });
  const comprasGer = montarPermissoes({ compras: ["visualizar", "gerenciar"] });
  const verOs = montarPermissoes({ ordens: ["visualizar"] });
  const editarOs = montarPermissoes({ ordens: ["visualizar", "editar"] });
  const editarOrc = montarPermissoes({ orcamentos: ["visualizar", "editar"] });

  it("ver: Compras, o comprador, quem vê a OS/orçamento de origem; avulso só Compras/comprador", () => {
    expect(podeVerPedido(usuario(compras), pedido())).toBe(true);
    expect(podeVerPedido(usuario(permissoesVazias()), pedido({ compradorId: "u1" }))).toBe(true);
    expect(podeVerPedido(usuario(verOs), pedido({ ordemServicoId: "os" }))).toBe(true);
    expect(podeVerPedido(usuario(verOs), pedido())).toBe(false);
    expect(podeVerPedido(usuario(verOs), pedido({ orcamentoId: "o" }))).toBe(false);
    expect(podeVerPedido(usuario(montarPermissoes({ orcamentos: ["visualizar"] })), pedido({ orcamentoId: "o" }))).toBe(true);
    expect(podeVerPedido(usuario(montarPermissoes({ financeiro: ["visualizar"] })), pedido())).toBe(false);
    expect(podeVerPedido(usuario(permissoesVazias(), "u1", "ADMIN"), pedido())).toBe(true);
  });
  it("enviar/baixar: Compras ou o comprador designado (quem só vê a OS, não)", () => {
    expect(podeEnviarPedido(usuario(compras), pedido())).toBe(true);
    expect(podeEnviarPedido(usuario(permissoesVazias()), pedido({ compradorId: "u1" }))).toBe(true);
    expect(podeEnviarPedido(usuario(permissoesVazias()), pedido({ compradorId: "u2" }))).toBe(false);
    expect(podeEnviarPedido(usuario(editarOs), pedido({ ordemServicoId: "os" }))).toBe(false);
  });
  it("editar: Compras › Gerenciar, comprador, solicitante ou quem edita a origem", () => {
    expect(podeEditarPedido(usuario(comprasGer), pedido())).toBe(true);
    expect(podeEditarPedido(usuario(compras), pedido())).toBe(false);
    expect(podeEditarPedido(usuario(permissoesVazias()), pedido({ compradorId: "u1" }))).toBe(true);
    expect(podeEditarPedido(usuario(permissoesVazias()), pedido({ solicitanteId: "u1" }))).toBe(true);
    expect(podeEditarPedido(usuario(permissoesVazias()), pedido({ solicitanteId: "u2", compradorId: "u3" }))).toBe(false);
    expect(podeEditarPedido(usuario(editarOs), pedido({ ordemServicoId: "os" }))).toBe(true);
    expect(podeEditarPedido(usuario(verOs), pedido({ ordemServicoId: "os" }))).toBe(false);
    expect(podeEditarPedido(usuario(editarOs), pedido({ orcamentoId: "o" }))).toBe(false);
    expect(podeEditarPedido(usuario(editarOrc), pedido({ orcamentoId: "o" }))).toBe(true);
  });
  it("comprador: só quem tem Compras (ADMIN tem tudo)", () => {
    expect(temAcessoCompras({ permissoes: compras })).toBe(true);
    expect(temAcessoCompras({ permissoes: montarPermissoes({ financeiro: ["visualizar"] }) })).toBe(false);
    expect(temAcessoCompras({ role: "ADMIN", permissoes: {} })).toBe(true);
    expect(temAcessoCompras({ role: null, permissoes: null })).toBe(false);
  });
});

describe("histórico da edição", () => {
  const base: PedidoComparavel = {
    prazoNecessario: "2026-11-05", compradorNome: "Marcos", fornecedorNome: null, observacao: "Urgente", motivo: null,
    itens: [
      { id: "i1", produtoId: "p1", descricao: "Filtro secador", quantidade: 4, unidade: "un" },
      { id: "i2", produtoId: null, descricao: "Fita isolante", quantidade: 2, unidade: "un" },
    ],
  };
  it("nada mudou → vazio (espaços e null × vazio não contam)", () => {
    expect(mudancasPedido(base, { ...base, observacao: " Urgente ", itens: base.itens.map((i) => ({ ...i })) })).toEqual([]);
    expect(mudancasPedido({ ...base, observacao: null }, { ...base, observacao: "" })).toEqual([]);
  });
  it("cada mudança vira uma linha legível", () => {
    const m = mudancasPedido(base, {
      prazoNecessario: "2026-11-10", compradorNome: "Paulo", fornecedorNome: "Frigelar", observacao: "", motivo: "Reposição",
      itens: [
        { id: "i1", produtoId: "p1", descricao: "Filtro secador", quantidade: 6.5, unidade: "un" },
        { id: null, produtoId: "p9", descricao: "Gás R410A", quantidade: 1, unidade: "kg" },
      ],
    });
    expect(m).toEqual([
      "Prazo necessário: 05/11/2026 → 10/11/2026",
      "Comprador: Marcos → Paulo",
      "Fornecedor: — → Frigelar",
      "Observação removida",
      "Motivo: — → Reposição",
      "Quantidade de Filtro secador: 4 un → 6,5 un",
      "Item adicionado: Gás R410A (1 kg)",
      "Item removido: Fita isolante",
    ]);
  });
  it("trocar o produto/descrição, a unidade, tirar o prazo e o comprador", () => {
    const m = mudancasPedido(base, {
      ...base, prazoNecessario: null, compradorNome: null, observacao: "Outra",
      itens: [{ ...base.itens[0], produtoId: "p2", descricao: "Filtro 053" }, { ...base.itens[1], unidade: "rolo" }],
    });
    expect(m).toEqual([
      "Prazo necessário: 05/11/2026 → —", "Comprador: Marcos → —", "Observação alterada",
      "Item alterado: Filtro secador → Filtro 053", "Quantidade de Fita isolante: 2 un → 2 rolo",
    ]);
    // Só o produto (mesma descrição) também conta como item alterado
    expect(mudancasPedido(base, { ...base, itens: [{ ...base.itens[0], produtoId: null }, base.itens[1]] })).toEqual(["Item alterado: Filtro secador → Filtro secador"]);
  });
});

describe("última compra (dica do estimado)", () => {
  const fmt = { moeda: (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`, data: () => "15/10/2026" };
  it("texto com valor, fornecedor e data (sem fornecedor, só o que há)", () => {
    expect(textoUltimaCompra({ valorUnitario: 18.45, fornecedor: "Frigelar", data: "2026-10-15" }, fmt)).toBe("Última compra: R$ 18,45 — Frigelar — 15/10/2026");
    expect(textoUltimaCompra({ valorUnitario: 18.5, fornecedor: null, data: "2026-10-15" }, fmt)).toBe("Última compra: R$ 18,50 — 15/10/2026");
  });
  it("valor sugerido em centavos com vírgula; sem histórico, vazio", () => {
    expect(valorSugerido({ valorUnitario: 18.454, fornecedor: null, data: "x" })).toBe("18,45");
    expect(valorSugerido({ valorUnitario: 3, fornecedor: null, data: "x" })).toBe("3,00");
    expect(valorSugerido(null)).toBe("");
    expect(valorSugerido(undefined)).toBe("");
    expect(valorSugerido({ valorUnitario: 0, fornecedor: null, data: "x" })).toBe("");
    expect(valorSugerido({ valorUnitario: NaN, fornecedor: null, data: "x" })).toBe("");
  });
  it("total estimado: qtd × estimado; sem estimativa não conta", () => {
    expect(totalEstimadoPedido([{ quantidade: 4, valorEstimado: 18.45 }, { quantidade: 2, valorEstimado: null }, { quantidade: 1.5, valorEstimado: 10 }])).toBe(88.8);
    expect(totalEstimadoPedido([])).toBe(0);
  });
});

describe("envio ao fornecedor", () => {
  const f = { id: "f", nome: "Frigelar", email: "v@f.com", telefone: "1133334444", ativo: true };
  it("o que falta por canal (baixar nunca precisa de contato)", () => {
    expect(faltaParaEnviar("BAIXAR", null)).toBeNull();
    expect(faltaParaEnviar("EMAIL", null)).toBe("Escolha o fornecedor do pedido para enviar.");
    expect(faltaParaEnviar("WHATSAPP", null)).toBe("Escolha o fornecedor do pedido para enviar.");
    expect(faltaParaEnviar("EMAIL", f)).toBeNull();
    expect(faltaParaEnviar("WHATSAPP", f)).toBeNull();
    expect(faltaParaEnviar("EMAIL", { ...f, email: " " })).toBe("O fornecedor Frigelar não tem e-mail no cadastro.");
    expect(faltaParaEnviar("WHATSAPP", { ...f, telefone: null })).toBe("O fornecedor Frigelar não tem telefone no cadastro.");
    expect(faltaParaEnviar("WHATSAPP", { ...f, email: null })).toBeNull();
  });
  it("mensagem do WhatsApp com número, empresa, prazo e link", () => {
    expect(mensagemFornecedor({ numero: "PCI-2026-0002", empresa: "Clima Total", contato: "Ana Lima", prazo: "05/11/2026", link: "https://x/pc" }))
      .toBe("Olá, Ana! Segue o Pedido de Compra Nº PCI-2026-0002 de Clima Total para cotação (necessário até 05/11/2026):\nhttps://x/pc\n\nPor favor, informe preço, validade e prazo de entrega.");
    expect(mensagemFornecedor({ numero: "N", empresa: "E", link: "L" })).toBe("Olá! Segue o Pedido de Compra Nº N de E para cotação:\nL\n\nPor favor, informe preço, validade e prazo de entrega.");
  });
});

describe("filtro da lista central", () => {
  it("sempre a empresa; status junta o legado; abertos; comprador", () => {
    expect(wherePedidosCompra("e1", {})).toEqual({ empresaId: "e1" });
    expect(wherePedidosCompra("e1", { status: "COTANDO" }).status).toEqual({ in: ["COTANDO", "COMPRADO"] });
    expect(wherePedidosCompra("e1", { status: "CONCLUIDO" }).status).toEqual({ in: ["CONCLUIDO", "ENTREGUE"] });
    expect(wherePedidosCompra("e1", { status: "XYZ" }).status).toBeUndefined();
    expect(wherePedidosCompra("e1", { abertos: "1" }).status).toEqual({ in: ["SOLICITADO", "COTANDO", "COMPRADO", "PARCIAL"] });
    expect(wherePedidosCompra("e1", { abertos: "1", status: "CANCELADO" }).status).toEqual({ in: ["CANCELADO"] });
    expect(wherePedidosCompra("e1", { compradorId: "u9" }).compradorId).toBe("u9");
  });
  it("origem e busca viram condições no AND", () => {
    expect(wherePedidosCompra("e1", { origem: "AVULSO" }).AND).toEqual([{ ordemServicoId: null, orcamentoId: null }]);
    expect(wherePedidosCompra("e1", { origem: "OS" }).AND[0].OR).toHaveLength(2);
    expect(wherePedidosCompra("e1", { origem: "ORCAMENTO" }).AND[0]).toMatchObject({ ordemServicoId: null, orcamentoId: { not: null } });
    const q = wherePedidosCompra("e1", { q: "  filtro " }).AND[0].OR;
    expect(q).toContainEqual({ numero: { contains: "filtro", mode: "insensitive" } });
    expect(q).toContainEqual({ itens: { some: { descricao: { contains: "filtro", mode: "insensitive" } } } });
    expect(q).toContainEqual({ fornecedor: { nome: { contains: "filtro", mode: "insensitive" } } });
    expect(wherePedidosCompra("e1", { q: "   " }).AND).toBeUndefined();
  });
});
