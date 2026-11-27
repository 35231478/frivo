/**
 * PONTAS SOLTAS DE CADASTRO (leva 5) — as regras puras (lib/cadastros/regras-arquivar):
 *  - endereço: principal e equipamentos ativos bloqueiam; contratos, PMOC e OS daquele local só avisam;
 *  - contato: acesso ao portal e principal avisam, nunca bloqueiam;
 *  - contrato: cancelar exige "Contratos › Excluir"; a saída de Ativo diz o que é cancelado junto;
 *  - nota de compra: descarta só a que não foi lançada;
 *  - modelos de checklist e de formulário: o uso aparece antes de inativar;
 *  - o texto padrão de endereço e contato volta a prometer a reativação (agora existe pela tela);
 *  - os filtros das listas: cancelados fora do padrão (contratos, pedidos, medições) e a busca das notas.
 */
import { describe, expect, it } from "vitest";
import {
  acaoDoStatusContrato, avisosInativarContato, avisosInativarEndereco, avisosInativarFormulario, avisosInativarModeloChecklist,
  avisosSaidaContrato, bloqueioInativarEndereco, motivoNaoDescartarNota, mostrarOpcaoInativo, textoInativar,
} from "@/lib/cadastros/regras-arquivar";
import { whereContratos, whereMedicoes, whereNotasCompra, wherePedidosCompra } from "@/lib/listas/filtros";
import { PRESETS, SECOES, pode } from "@/lib/permissoes";

/** O real formatado usa espaço não separável depois do "R$" */
const sp = (xs: string[]) => xs.map((x) => x.replace(/\u00a0/g, " "));

describe("endereço: o que bloqueia e o que só avisa", () => {
  it("principal bloqueia antes de tudo; equipamentos ativos bloqueiam; sem nada, libera", () => {
    expect(bloqueioInativarEndereco({ principal: true, equipamentosAtivos: 3 })).toBe("Endereço principal não pode ser inativado: marque outro endereço como principal antes.");
    expect(bloqueioInativarEndereco({ principal: false, equipamentosAtivos: 1 })).toBe("Tem 1 equipamento ativo neste endereço: mova ou inative os equipamentos antes.");
    expect(bloqueioInativarEndereco({ principal: false, equipamentosAtivos: 2 })).toBe("Tem 2 equipamentos ativos neste endereço: mova ou inative os equipamentos antes.");
    expect(bloqueioInativarEndereco({ principal: false, equipamentosAtivos: 0 })).toBeNull();
  });

  it("contratos, PMOC e OS daquele local: um aviso cada, no singular e no plural, até três nomes", () => {
    expect(avisosInativarEndereco({ contratosAtivos: ["CT-1"], pmocsAtivos: ["PMOC Loja"], osAbertas: ["OS-9"] })).toEqual([
      "Está em 1 contrato ativo (CT-1): continua atendendo este local até ser alterado.",
      "Tem 1 PMOC ativo (PMOC Loja): continua valendo até ser inativado.",
      "Tem 1 OS em aberto (OS-9): segue normalmente.",
    ]);
    expect(avisosInativarEndereco({ contratosAtivos: ["A", "B", "C", "D"], pmocsAtivos: ["P1", "P2"], osAbertas: ["O1", "O2"] })).toEqual([
      "Está em 4 contratos ativos (A, B, C e mais 1): continuam atendendo este local até ser alterado.",
      "Tem 2 PMOCs ativos (P1, P2): continuam valendo até ser inativado.",
      "Tem 2 OS em aberto (O1, O2): seguem normalmente.",
    ]);
    expect(avisosInativarEndereco({ contratosAtivos: [], pmocsAtivos: [], osAbertas: [] })).toEqual([]);
  });
});

describe("contato: só avisos", () => {
  it("acesso ao portal e contato principal", () => {
    expect(avisosInativarContato({ principal: true, temAcessoPortal: true })).toEqual([
      "Tem acesso ao Portal do Cliente: o acesso fica bloqueado enquanto estiver inativo.",
      "É o contato principal: escolha outro contato principal depois.",
    ]);
    expect(avisosInativarContato({ principal: false, temAcessoPortal: false })).toEqual([]);
    expect(avisosInativarContato({ principal: false, temAcessoPortal: true })).toHaveLength(1);
    expect(avisosInativarContato({ principal: true, temAcessoPortal: false })).toEqual(["É o contato principal: escolha outro contato principal depois."]);
  });

  it("endereço e contato agora reativam pela tela: o texto padrão promete a reativação", () => {
    expect(textoInativar("endereço", "Loja Centro").mensagem).toBe("Tem certeza? O endereço sai das listas e seletores; nada é apagado e pode ser reativado depois.");
    expect(textoInativar("contato", "Marina").titulo).toBe("Inativar contato Marina?");
  });
});

describe("contrato: cancelar tem permissão própria e o impacto vem antes", () => {
  it("só o Cancelado pede Contratos › Excluir; as outras trocas, Editar", () => {
    expect(acaoDoStatusContrato("CANCELADO")).toBe("excluir");
    for (const s of ["ATIVO", "SUSPENSO", "ENCERRADO", "EM_RENOVACAO", "AGUARDANDO_ASSINATURA", "VENCIDO"]) expect(acaoDoStatusContrato(s)).toBe("editar");
  });

  it("a permissão existe na matriz; o preset Financeiro (empresas novas) já a traz; o Supervisor não tem contratos", () => {
    expect(SECOES.flatMap((s) => s.modulos).find((m) => m.id === "contratos")!.acoes).toContain("excluir");
    expect(pode(PRESETS.FINANCEIRO, "contratos", "excluir", "OPERADOR")).toBe(true);
    expect(pode(PRESETS.ADMINISTRADOR, "contratos", "excluir", "OPERADOR")).toBe(true);
    expect(pode(PRESETS.SUPERVISOR, "contratos", "excluir", "OPERADOR")).toBe(false);
    // perfil gravado antes (só editar): não cancela, até o administrador marcar
    expect(pode({ contratos: { visualizar: true, editar: true } }, "contratos", "excluir", "OPERADOR")).toBe(false);
    // administrador master pode tudo, sem nada no banco
    expect(pode({}, "contratos", "excluir", "ADMIN")).toBe(true);
  });

  it("a saída de Ativo: OS agendadas e previsões canceladas, OS em andamento seguem", () => {
    expect(sp(avisosSaidaContrato({ osACancelar: ["OS-1"], previsoes: 1, valorPrevisoes: 800, osSeguem: ["OS-2"] }))).toEqual([
      "Cancela 1 OS agendada que ainda não começou (OS-1): sai da agenda.",
      "Cancela 1 previsão de cobrança em aberto (R$ 800,00): o que já foi faturado ou recebido não muda.",
      "Tem 1 OS já em andamento (OS-2): segue normalmente.",
    ]);
    expect(sp(avisosSaidaContrato({ osACancelar: ["A", "B"], previsoes: 6, valorPrevisoes: 4800, osSeguem: ["C", "D"] }))).toEqual([
      "Cancela 2 OS agendadas que ainda não começaram (A, B): saem da agenda.",
      "Cancela 6 previsões de cobrança em aberto (R$ 4.800,00): o que já foi faturado ou recebido não muda.",
      "Tem 2 OS já em andamento (C, D): seguem normalmente.",
    ]);
    expect(avisosSaidaContrato({ osACancelar: [], previsoes: 0, valorPrevisoes: 0, osSeguem: [] })).toEqual([]);
  });
});

describe("nota de compra: descartar só antes de lançar", () => {
  it("importada e conciliada descartam; lançada (ou com conta a pagar) não", () => {
    expect(motivoNaoDescartarNota({ status: "IMPORTADA", contasPagar: 0 })).toBeNull();
    expect(motivoNaoDescartarNota({ status: "CONCILIADA", contasPagar: 0 })).toBeNull();
    const msg = "Nota já lançada não se descarta: o estorno é pela conta a pagar e pelo ajuste de estoque.";
    expect(motivoNaoDescartarNota({ status: "LANCADA", contasPagar: 0 })).toBe(msg);
    expect(motivoNaoDescartarNota({ status: "CONCILIADA", contasPagar: 1 })).toBe(msg);
  });
});

describe("modelos: o uso aparece antes de inativar", () => {
  it("checklist: preenchimentos (nenhum, um, vários)", () => {
    expect(avisosInativarModeloChecklist(0)).toEqual([]);
    expect(avisosInativarModeloChecklist(1)).toEqual(["Já foi preenchido 1 vez: os preenchimentos continuam no histórico."]);
    expect(avisosInativarModeloChecklist(12)).toEqual(["Já foi preenchido 12 vezes: os preenchimentos continuam no histórico."]);
  });
  it("formulário: combinações de equipamento e tipo de OS", () => {
    expect(avisosInativarFormulario(0)).toEqual([]);
    expect(avisosInativarFormulario(1)).toEqual(["Em uso em 1 combinação de equipamento e tipo de OS: sai das próximas OS; as respostas já dadas ficam."]);
    expect(avisosInativarFormulario(3)[0]).toContain("Em uso em 3 combinações");
  });
});

describe("veículo: a opção Inativo do formulário só para quem pode inativar", () => {
  it("mesma regra do colaborador", () => {
    expect(mostrarOpcaoInativo(true, "ATIVO")).toBe(true);
    expect(mostrarOpcaoInativo(false, "ATIVO")).toBe(false);
    expect(mostrarOpcaoInativo(false, "INATIVO")).toBe(true);
  });
});

describe("listas: cancelados fora do padrão; busca das notas", () => {
  it("contratos: sem status, esconde o cancelado; status ou Mostrar cancelados traz", () => {
    expect(whereContratos("e1", {}).status).toEqual({ not: "CANCELADO" });
    expect(whereContratos("e1", { cancelados: "1" }).status).toBeUndefined();
    expect(whereContratos("e1", { status: "CANCELADO" }).status).toBe("CANCELADO");
    expect(whereContratos("e1", { status: "INATIVO" }).status).toEqual({ in: ["SUSPENSO", "ENCERRADO", "CANCELADO"] });
    expect(whereContratos("e1", { status: "VENCIDO" }).status).toEqual({ notIn: ["ENCERRADO", "CANCELADO"] });
  });

  it("pedidos de compra: idem (e Só abertos continua igual)", () => {
    expect(wherePedidosCompra("e1", {}).status).toEqual({ not: "CANCELADO" });
    expect(wherePedidosCompra("e1", { cancelados: "1" }).status).toBeUndefined();
    expect(wherePedidosCompra("e1", { status: "CANCELADO" }).status).toEqual({ in: ["CANCELADO"] });
    expect(wherePedidosCompra("e1", { abertos: "1" }).status).toEqual({ in: ["SOLICITADO", "COTANDO", "COMPRADO", "PARCIAL"] });
  });

  it("medições: idem, com os outros filtros e a empresa", () => {
    expect(whereMedicoes("e1", {})).toEqual({ empresaId: "e1", status: { not: "CANCELADA" } });
    expect(whereMedicoes("e1", { cancelados: "1" })).toEqual({ empresaId: "e1" });
    expect(whereMedicoes("e1", { status: "CANCELADA", clienteId: "c1", tipo: "MENSAL_FIXO" })).toEqual({ empresaId: "e1", status: "CANCELADA", clienteId: "c1", tipo: "MENSAL_FIXO" });
    const comBusca = whereMedicoes("e1", { busca: "MED-1" }, { gte: new Date("2026-01-01T03:00:00Z") });
    expect(comBusca.criadoEm).toEqual({ gte: new Date("2026-01-01T03:00:00Z") });
    expect(comBusca.OR).toHaveLength(3);
  });

  it("notas de compra: situação válida filtra; a busca cobre número, fornecedor e, com dígitos, CNPJ e chave", () => {
    expect(whereNotasCompra("e1", {})).toEqual({ empresaId: "e1" });
    expect(whereNotasCompra("e1", { status: "CONCILIADA" }).status).toBe("CONCILIADA");
    expect(whereNotasCompra("e1", { status: "QUALQUER" }).status).toBeUndefined();
    const texto = whereNotasCompra("e1", { q: "Paulista" }).OR;
    expect(texto).toEqual([
      { numero: { contains: "Paulista", mode: "insensitive" } },
      { emitenteNome: { contains: "Paulista", mode: "insensitive" } },
      { fornecedor: { nome: { contains: "Paulista", mode: "insensitive" } } },
    ]);
    const cnpj = whereNotasCompra("e1", { q: "11.222.333" }).OR;
    expect(cnpj).toContainEqual({ emitenteCnpj: { contains: "11222333" } });
    expect(cnpj).toContainEqual({ chaveAcesso: { contains: "11222333" } });
    // dois dígitos não bastam para procurar na chave (44 dígitos casariam quase tudo)
    expect(whereNotasCompra("e1", { q: "12" }).OR).toHaveLength(3);
  });
});
