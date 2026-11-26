/**
 * PONTAS SOLTAS DE CADASTRO (leva 4) — as regras puras e os portões de página:
 *  - excluir medição só no rascunho sem conta nem nota; conta paga não cancela nem edita;
 *  - o modelo do checklist diário obrigatório não inativa; "Inativo" do colaborador só para quem inativa;
 *  - o texto de confirmação é um só (título, frase, botão), com e sem reativação;
 *  - o aviso de inativar cliente diz o que continua andando;
 *  - a busca das listas de OS, orçamentos e contratos acha o nome fantasia do cliente;
 *  - Nova OS e Novo orçamento exigem "criar" (antes abriam para quem só via).
 */
import { describe, expect, it, vi } from "vitest";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import {
  avisosInativarCliente, motivoNaoCancelarContaPagar, motivoNaoEditarContaPagar, motivoNaoExcluirMedicao,
  motivoNaoInativarModeloChecklist, mostrarOpcaoInativo, textoInativar, textoReativar,
} from "@/lib/cadastros/regras-arquivar";
import { motivoNaoCancelarPagar } from "@/lib/financeiro/acoes-lote";
import { whereContratos, whereOrcamentos, whereOrdens } from "@/lib/listas/filtros";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("@/lib/orcamentos/form-dados", () => ({ dadosNovoOrcamento: async () => ({}) }));
vi.mock("@/components/forms/orcamento-form", () => ({ OrcamentoForm: () => null }));

describe("medição: excluir só o rascunho limpo", () => {
  const m = (x: Partial<Parameters<typeof motivoNaoExcluirMedicao>[0]> = {}) => ({ status: "RASCUNHO", nfNumero: null, contasReceber: 0, notasFiscais: 0, ...x });
  it("rascunho sem conta e sem nota: pode", () => expect(motivoNaoExcluirMedicao(m())).toBeNull());
  it("qualquer etapa depois do rascunho: não (cancela)", () => {
    for (const status of ["AGUARDANDO_APROVACAO", "APROVADA", "NF_EMITIDA", "PAGO", "CANCELADA"])
      expect(motivoNaoExcluirMedicao(m({ status }))).toBe("Só o rascunho pode ser excluído. Depois de enviada, a medição é cancelada, não apagada.");
  });
  it("rascunho com conta, nota (NFS-e ou número manual): não", () => {
    expect(motivoNaoExcluirMedicao(m({ contasReceber: 1 }))).toBe("Esta medição já gerou conta a receber. Cancele em vez de excluir.");
    expect(motivoNaoExcluirMedicao(m({ notasFiscais: 1 }))).toBe("Esta medição já tem nota fiscal. Cancele em vez de excluir.");
    expect(motivoNaoExcluirMedicao(m({ nfNumero: "123" }))).toBe("Esta medição já tem nota fiscal. Cancele em vez de excluir.");
    expect(motivoNaoExcluirMedicao(m({ nfNumero: "  " }))).toBeNull(); // número em branco não é nota
  });
});

describe("conta a pagar: paga não cancela nem edita", () => {
  it("cancelar uma a uma: paga e cancelada não; em aberto e parcial sim (o lote segue mais rígido)", () => {
    expect(motivoNaoCancelarContaPagar({ status: "PAGO_TOTAL" })).toBe("Conta paga não pode ser cancelada.");
    expect(motivoNaoCancelarContaPagar({ status: "CANCELADO" })).toBe("Esta conta já está cancelada.");
    for (const status of ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"]) expect(motivoNaoCancelarContaPagar({ status })).toBeNull();
    // a mesma frase do lote, que além disso tira a parcial
    expect(motivoNaoCancelarPagar({ status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 } as any)).toBe(motivoNaoCancelarContaPagar({ status: "PAGO_TOTAL" }));
    expect(motivoNaoCancelarPagar({ status: "PAGO_PARCIAL", valorPago: 300, saldoRestante: 700 } as any)).not.toBeNull();
  });
  it("editar: encerrada (paga ou cancelada) não", () => {
    expect(motivoNaoEditarContaPagar({ status: "PAGO_TOTAL" })).toBe("Conta já paga não muda: lance um estorno ou um ajuste.");
    expect(motivoNaoEditarContaPagar({ status: "CANCELADO" })).toBe("Conta cancelada não muda.");
    for (const status of ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"]) expect(motivoNaoEditarContaPagar({ status })).toBeNull();
  });
});

describe("modelo de checklist do checklist diário", () => {
  it("ligado e é este modelo: não inativa; desligado, outro modelo ou sem configuração: inativa", () => {
    expect(motivoNaoInativarModeloChecklist("m1", { checklistDiarioAtivo: true, checklistDiarioTemplateId: "m1" })).toMatch(/^Modelo do checklist diário obrigatório/);
    expect(motivoNaoInativarModeloChecklist("m1", { checklistDiarioAtivo: false, checklistDiarioTemplateId: "m1" })).toBeNull();
    expect(motivoNaoInativarModeloChecklist("m2", { checklistDiarioAtivo: true, checklistDiarioTemplateId: "m1" })).toBeNull();
    expect(motivoNaoInativarModeloChecklist("m1", null)).toBeNull();
  });
});

describe("colaborador: a opção Inativo", () => {
  it("quem inativa vê; quem só edita não vê — a não ser que ele já esteja inativo", () => {
    expect(mostrarOpcaoInativo(true, "ATIVO")).toBe(true);
    expect(mostrarOpcaoInativo(false, "ATIVO")).toBe(false);
    expect(mostrarOpcaoInativo(false, undefined)).toBe(false);
    expect(mostrarOpcaoInativo(false, "INATIVO")).toBe(true);
  });
});

describe("o texto da confirmação: um jeito só", () => {
  it("inativar: título com o nome, a frase padrão e \"Sim, inativar\"", () => {
    expect(textoInativar("cliente", "Mercado do Zé")).toEqual({
      titulo: "Inativar cliente Mercado do Zé?",
      mensagem: "Tem certeza? O cliente sai das listas e seletores; nada é apagado e pode ser reativado depois.",
      confirmar: "Sim, inativar",
    });
    expect(textoInativar("equipe", "Norte", "f").mensagem).toBe("Tem certeza? A equipe sai das listas e seletores; nada é apagado e pode ser reativada depois.");
  });
  it("sem reativação pela tela (endereço, contato): não promete o \"reativado depois\"", () => {
    expect(textoInativar("endereço", "Depósito", "m", false)).toEqual({
      titulo: "Inativar endereço Depósito?",
      mensagem: "Tem certeza? O endereço sai das listas e seletores; nada é apagado.",
      confirmar: "Sim, inativar",
    });
  });
  it("sem nome: o título não fica com espaço sobrando", () => {
    expect(textoInativar("contato", "  ").titulo).toBe("Inativar contato?");
    expect(textoInativar("contato", null).titulo).toBe("Inativar contato?");
  });
  it("reativar", () => {
    expect(textoReativar("cliente", "Mercado do Zé")).toEqual({ titulo: "Reativar cliente Mercado do Zé?", mensagem: "O cliente volta a aparecer nas listas e nos seletores.", confirmar: "Reativar" });
    expect(textoReativar("equipe", "Norte", "f").mensagem).toBe("A equipe volta a aparecer nas listas e nos seletores.");
  });
});

describe("inativar cliente: o que continua andando", () => {
  const vazio = { contratosAtivos: [], osAbertas: [], orcamentosAbertos: 0, contasAbertas: 0, pmocsAtivos: 0 };
  it("nada em andamento: nenhum aviso", () => expect(avisosInativarCliente(vazio)).toEqual([]));
  it("um de cada (singular) e vários (plural, até 3 nomes)", () => {
    expect(avisosInativarCliente({ contratosAtivos: ["CT-1"], osAbertas: ["OS-1"], orcamentosAbertos: 1, contasAbertas: 1, pmocsAtivos: 1 })).toEqual([
      "Tem 1 contrato ativo (CT-1): continua gerando OS e cobrança até o encerramento.",
      "Tem 1 OS em aberto (OS-1): segue normalmente.",
      "Tem 1 orçamento em aberto.",
      "Tem 1 conta a receber em aberto: a cobrança continua.",
      "Tem 1 PMOC ativo.",
    ]);
    expect(avisosInativarCliente({ ...vazio, contratosAtivos: ["A", "B", "C", "D"], osAbertas: ["OS-1", "OS-2"], orcamentosAbertos: 2, contasAbertas: 3, pmocsAtivos: 2 })).toEqual([
      "Tem 4 contratos ativos (A, B, C e mais 1): continuam gerando OS e cobrança até o encerramento.",
      "Tem 2 OS em aberto (OS-1, OS-2): seguem normalmente.",
      "Tem 2 orçamentos em aberto.",
      "Tem 3 contas a receber em aberto: a cobrança continua.",
      "Tem 2 PMOCs ativos.",
    ]);
  });
});

describe("busca pelo nome fantasia do cliente", () => {
  const fantasia = (busca: string) => ({ cliente: { nomeFantasia: { contains: busca, mode: "insensitive" } } });
  it("OS, orçamentos e contratos procuram também no fantasia (além da razão social)", () => {
    for (const w of [whereOrdens("e1", { busca: "Zé" }), whereOrcamentos("e1", { busca: "Zé" }), whereContratos("e1", { busca: "Zé" })]) {
      expect(w.OR).toContainEqual(fantasia("Zé"));
      expect(w.OR).toContainEqual({ cliente: { nome: { contains: "Zé", mode: "insensitive" } } });
      expect(w.empresaId).toBe("e1");
    }
  });
  it("sem busca, nada de OR", () => {
    expect(whereOrdens("e1", {}).OR).toBeUndefined();
    expect(whereContratos("e1", {}).OR).toBeUndefined();
  });
});

describe("Nova OS e Novo orçamento exigem criar", () => {
  const como = (permissoes: any) => { sessao.atual = { user: { id: "u1", empresaId: "e1", role: "OPERADOR", permissoes } }; };
  it("Nova OS: só ver → volta para a lista; criar → abre", async () => {
    const { default: NovaOsLayout } = await import("@/app/(dashboard)/ordens/nova/layout");
    como(montarPermissoes({ ordens: ["visualizar"] }));
    await expect(NovaOsLayout({ children: "form" })).rejects.toThrow("REDIRECT /ordens");
    como(montarPermissoes({ ordens: ["visualizar", "criar"] }));
    await expect(NovaOsLayout({ children: "form" })).resolves.toBeTruthy();
  });
  it("Novo orçamento: só ver → volta para a lista; criar → abre", async () => {
    const { default: NovoOrcamentoPage } = await import("@/app/(dashboard)/orcamentos/novo/page");
    const sp = { searchParams: Promise.resolve({}) };
    como(montarPermissoes({ orcamentos: ["visualizar", "editar"] }));
    await expect(NovoOrcamentoPage(sp as any)).rejects.toThrow("REDIRECT /orcamentos");
    como(permissoesTotais());
    await expect(NovoOrcamentoPage(sp as any)).resolves.toBeTruthy();
  });
});
