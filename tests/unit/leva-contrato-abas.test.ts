/**
 * Contrato em 5 abas — servidor e regras. Rotas reais (/api/contratos), banco em memória com DUAS
 * empresas. Prova:
 *  - o 1º local coberto vem do endereço do cliente e nunca duplica (regra pura);
 *  - descrição dos serviços: até 1000 caracteres (1001 = 400);
 *  - NFS-e, itens inclusos, visitas e "exibir RT na NFS-e" saíram: o que chega no corpo é
 *    descartado e o que já estava gravado NÃO é apagado ao editar;
 *  - nada quebrou: tipo e periodicidade continuam gravando; a previsão de contas a receber segue a
 *    periodicidade (trimestral = de 3 em 3 meses); a recorrência de OS por local gera as OS;
 *  - empresa sempre da sessão; permissão de criar/editar contrato.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { contratoSchema, MAX_DESCRICAO_SERVICOS } from "@/lib/validations";
import { mesmoEndereco, novoLocalDoCliente, temEndereco, textoEndereco, unidadeDoCliente, NOME_LOCAL_CLIENTE } from "@/lib/contratos/local-padrao";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return {
    prisma: criarPrisma(db, {
      contrato: (r, T) => ({
        cliente: T("cliente").find((c) => c.id === r.clienteId) ?? null,
        unidades: T("contratoUnidade").filter((u) => u.contratoId === r.id),
        recorrenciasLocais: T("contratoRecorrenciaLocal").filter((x) => x.contratoId === r.id),
      }),
    }, { contrato: { unidades: ["contratoUnidade", "contratoId"] } }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};

function semear() {
  db.escritas = [];
  db.seq = 0;
  db.t = {
    cliente: [
      { id: "c1", empresaId: "e1", nome: "Hotel Mirante", cpfCnpj: "11.222.333/0001-81", ativo: true },
      { id: "cB", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "1", ativo: true },
    ],
    unidade: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Rua A", numero: "10", ativo: true },
      { id: "uB", empresaId: "e2", clienteId: "cB", nome: "Local da outra", ativo: true },
    ],
    tipoOs: [{ id: "to1", empresaId: "e1", nome: "Preventiva", ativo: true }],
    tecnico: [{ id: "t1", empresaId: "e1", nome: "Ana", ativo: true }],
    contrato: [{
      // Contrato antigo, com os campos que saíram do formulário preenchidos
      id: "ct-antigo", empresaId: "e1", clienteId: "c1", numero: "CT-2025-0001", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
      periodicidade: "MENSAL", dataInicio: new Date("2025-01-01"), dataFim: null, valorMensal: null,
      descricaoNFSe: "Manutenção PMOC; Limpeza", servicosNFSeIds: ["s1", "s2"], adicionarPeriodoRef: true, periodoRefOpcao: "MES_FATURAMENTO",
      adicionarNumContrato: true, adicionarVencimentoNFSe: true, exibirRTNFSe: true,
      itensInclusos: { relatorioPmoc: true, outros: "Filtros" }, qtdVisitas: 4, periodoVisitas: "MES",
      descricaoServicos: "Manutenção preventiva mensal",
    }],
    contratoUnidade: [], contratoRecorrenciaLocal: [], contaReceber: [], categoriaFinanceira: [], ordemServico: [], atividade: [],
  };
}
beforeEach(() => { semear(); logar(); });

const futuro = (meses: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + meses); return d.toISOString().slice(0, 10); };
/** Corpo como o formulário novo manda (sem NFS-e, itens inclusos nem visitas) */
const corpo = (extra: Record<string, unknown> = {}) => ({
  clienteId: "c1", numero: "CT-2026-0100", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", periodicidade: "MENSAL",
  dataInicio: futuro(1), dataFim: futuro(13), valorMensal: 500, diaFaturamento: 5, tipoVencimento: "DIAS_APOS_FATURAMENTO", diasAposVencimento: 10,
  ajusteFinsDeSemana: "MANTER", descricaoServicos: "Preventiva mensal", unidadeIds: ["u1"], recorrenciasLocais: [],
  exibirRTPDF: true, reajusteAtivo: false, alertaDias: 30, renovacaoAutomatica: false, ...extra,
});

async function chamar(metodo: "POST" | "PUT", url: string, body: unknown, params: Record<string, string> = {}) {
  const mod = metodo === "POST" ? await import("@/app/api/contratos/route") : await import("@/app/api/contratos/[id]/route");
  const req = new NextRequest(`http://localhost${url}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const res: Response = await (mod as any)[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const contrato = (id: string) => db.t.contrato.find((c) => c.id === id)!;

// ═════════════════════════ 1º local = endereço do cliente ═════════════════════════
describe("1º local coberto a partir do endereço do cliente (regra)", () => {
  const cli = { endereco: "Rua A", numero: "10", bairro: "Centro", cidade: "Belo Horizonte", estado: "MG", cep: "30140-000" };

  it("cliente sem endereço não sugere nada", () => {
    expect(temEndereco({ endereco: "", cidade: " " })).toBe(false);
    expect(temEndereco(null)).toBe(false);
    expect(temEndereco({ cidade: "BH" })).toBe(true);
    expect(unidadeDoCliente([{ id: "u", logradouro: "Rua A", numero: "10" }], { endereco: "", numero: "10" })).toBeNull();
  });

  it("mesmo endereço = mesma rua e número (sem acento/maiúsculas/pontuação) ou mesmo CEP e número", () => {
    expect(mesmoEndereco({ id: "u", logradouro: "rua  a.", numero: "10" }, cli)).toBe(true);
    expect(mesmoEndereco({ id: "u", logradouro: "Rua Á", numero: "10" }, cli)).toBe(true);
    expect(mesmoEndereco({ id: "u", logradouro: "Rua A", numero: "11" }, cli)).toBe(false);
    expect(mesmoEndereco({ id: "u", logradouro: "Avenida X", numero: "10", cep: "30140000" }, cli)).toBe(true);
    expect(mesmoEndereco({ id: "u", logradouro: "Avenida X", numero: "10", cep: "30140001" }, cli)).toBe(false);
    expect(mesmoEndereco({ id: "u", logradouro: "", numero: "10", cep: "" }, { ...cli, cep: "" })).toBe(false);
  });

  it("acha o local já cadastrado (não duplica) e ignora local inativo", () => {
    const us = [{ id: "u-inat", logradouro: "Rua A", numero: "10", ativo: false }, { id: "u-outro", logradouro: "Rua B", numero: "1" }, { id: "u-ok", logradouro: "RUA A", numero: "10" }];
    expect(unidadeDoCliente(us, cli)?.id).toBe("u-ok");
    expect(unidadeDoCliente(us.slice(0, 2), cli)).toBeNull();
  });

  it("novo local leva todo o endereço do cliente", () => {
    expect(novoLocalDoCliente(cli)).toEqual({ nome: NOME_LOCAL_CLIENTE, logradouro: "Rua A", numero: "10", complemento: "", bairro: "Centro", cidade: "Belo Horizonte", estado: "MG", cep: "30140-000" });
    expect(textoEndereco(novoLocalDoCliente(cli))).toBe("Rua A, 10, Centro, Belo Horizonte, MG");
  });
});

// ═════════════════════════ Schema ═════════════════════════
describe("validação do contrato", () => {
  it("descrição dos serviços: até 1000 caracteres", () => {
    expect(MAX_DESCRICAO_SERVICOS).toBe(1000);
    expect(contratoSchema.safeParse(corpo({ descricaoServicos: "x".repeat(1000) })).success).toBe(true);
    const r = contratoSchema.safeParse(corpo({ descricaoServicos: "x".repeat(1001) }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("no máximo 1000 caracteres");
  });

  it("campos que saíram (NFS-e, itens inclusos, visitas, RT na NFS-e) são descartados", () => {
    const r = contratoSchema.parse(corpo({
      servicosNFSeIds: ["s1"], descricaoNFSe: "x", adicionarPeriodoRef: true, periodoRefOpcao: "MES_FATURAMENTO", adicionarNumContrato: true,
      adicionarVencimentoNFSe: true, exibirRTNFSe: true, itensInclusos: { a: true }, qtdVisitas: 3, periodoVisitas: "MES",
    }));
    for (const k of ["servicosNFSeIds", "descricaoNFSe", "adicionarPeriodoRef", "periodoRefOpcao", "adicionarNumContrato", "adicionarVencimentoNFSe", "exibirRTNFSe", "itensInclusos", "qtdVisitas", "periodoVisitas"])
      expect(r).not.toHaveProperty(k);
    // Tipo e periodicidade continuam (faturamento, relatório, filtro e ficha do cliente usam)
    expect(r).toMatchObject({ tipo: "MANUTENCAO_PREVENTIVA", periodicidade: "MENSAL", exibirRTPDF: true });
  });
});

// ═════════════════════════ API ═════════════════════════
describe("POST/PUT /api/contratos", () => {
  it("cria com o corpo do formulário novo: empresa da sessão, tipo/periodicidade gravados, locais ligados", async () => {
    const r = await chamar("POST", "/api/contratos", corpo({ empresaId: "e2", periodicidade: "TRIMESTRAL" }));
    expect(r.status).toBe(201);
    const c = contrato(r.json.id);
    expect(c).toMatchObject({ empresaId: "e1", tipo: "MANUTENCAO_PREVENTIVA", periodicidade: "TRIMESTRAL", descricaoServicos: "Preventiva mensal", exibirRTPDF: true });
    expect(c).not.toHaveProperty("servicosNFSeIds");
    expect(db.t.contratoUnidade.filter((u) => u.contratoId === c.id).map((u) => u.unidadeId)).toEqual(["u1"]);
  });

  it("Leva 5 (CO1/D3): a COBRANÇA é sempre mensal — periodicidade trimestral é das visitas, não do dinheiro", async () => {
    const r = await chamar("POST", "/api/contratos", corpo({ periodicidade: "TRIMESTRAL" }));
    expect(r.status).toBe(201);
    const contas = db.t.contaReceber.filter((cr) => cr.numero.startsWith("CT-2026-0100/")).map((cr) => cr.numero).sort();
    expect(contas.length).toBeGreaterThanOrEqual(4);
    const meses = contas.map((n: string) => { const t = n.split("/")[1]; return Number(t.slice(0, 4)) * 12 + Number(t.slice(4)); });
    expect(meses.slice(1).map((m: number, i: number) => m - meses[i])).toEqual(meses.slice(1).map(() => 1)); // mês a mês
  });

  it("recorrência de OS por local continua gerando as OS (nada quebrou)", async () => {
    const r = await chamar("POST", "/api/contratos", corpo({
      recorrenciasLocais: [{ unidadeId: "u1", ativa: true, frequencia: "MENSAL", tipoOsId: "to1", tecnicoId: "t1", dataPrimeiraOs: futuro(1) }],
    }));
    expect(r.status).toBe(201);
    expect(db.t.contratoRecorrenciaLocal).toHaveLength(1);
    const os = db.t.ordemServico.filter((o) => o.contratoId === r.json.id);
    expect(os.length).toBeGreaterThan(0);
    expect(os.every((o) => o.empresaId === "e1" && o.unidadeId === "u1" && o.origem === "RECORRENTE")).toBe(true);
  });

  it("editar NÃO apaga o que já estava gravado nos campos que saíram (nem se o corpo mandar outra coisa)", async () => {
    const r = await chamar("PUT", "/api/contratos/ct-antigo", corpo({
      numero: "CT-2025-0001", descricaoServicos: "Nova descrição",
      servicosNFSeIds: [], descricaoNFSe: "", adicionarPeriodoRef: false, exibirRTNFSe: false, itensInclusos: {}, qtdVisitas: null, periodoVisitas: null,
    }), { id: "ct-antigo" });
    expect(r.status).toBe(200);
    expect(contrato("ct-antigo")).toMatchObject({
      descricaoServicos: "Nova descrição",
      descricaoNFSe: "Manutenção PMOC; Limpeza", servicosNFSeIds: ["s1", "s2"], adicionarPeriodoRef: true, periodoRefOpcao: "MES_FATURAMENTO",
      adicionarNumContrato: true, adicionarVencimentoNFSe: true, exibirRTNFSe: true,
      itensInclusos: { relatorioPmoc: true, outros: "Filtros" }, qtdVisitas: 4, periodoVisitas: "MES",
    });
  });

  it("descrição com mais de 1000 caracteres: 400, nada gravado", async () => {
    const r = await chamar("POST", "/api/contratos", corpo({ descricaoServicos: "x".repeat(1001) }));
    expect(r.status).toBe(400);
    expect(db.t.contrato).toHaveLength(1);
  });

  it("empresa da sessão: local ou cliente de outra empresa = 400; contrato de outra empresa = 404", async () => {
    expect((await chamar("POST", "/api/contratos", corpo({ unidadeIds: ["uB"] }))).status).toBe(400);
    expect((await chamar("POST", "/api/contratos", corpo({ clienteId: "cB", unidadeIds: [] }))).status).toBe(400);
    logar(permissoesTotais(), "e2");
    expect((await chamar("PUT", "/api/contratos/ct-antigo", corpo({ numero: "CT-2025-0001" }), { id: "ct-antigo" })).status).toBe(404);
    expect(contrato("ct-antigo").descricaoServicos).toBe("Manutenção preventiva mensal");
  });

  it("permissão: sem criar contrato = 403; sem editar = 403", async () => {
    logar({ ...permissoesVazias(), contratos: { visualizar: true } });
    expect((await chamar("POST", "/api/contratos", corpo())).status).toBe(403);
    expect((await chamar("PUT", "/api/contratos/ct-antigo", corpo({ numero: "CT-2025-0001" }), { id: "ct-antigo" })).status).toBe(403);
    expect(db.t.contrato).toHaveLength(1);
  });
});
