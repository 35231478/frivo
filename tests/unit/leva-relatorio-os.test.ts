/**
 * Relatório da OS — layout por equipamento + configuração de impressão. Regras puras, montagem,
 * API e páginas reais com banco em memória (DUAS empresas). Prova:
 *  - config: padrões, mescla do salvo (lixo ignorado), quem vê cada seção em cada versão;
 *  - montagem: um bloco por equipamento ATENDIDO com o checklist e as fotos DAQUELE equipamento
 *    (nunca de outro), local + TAG, ordem pelo local; não atendidos à parte; formulário geral;
 *    assinatura replicada conta uma vez; resultado, equipe e veículo;
 *  - versão do cliente (link público) só com as seções "cliente vê"; versão interna (logado)
 *    com todas as ligadas; seção desligada não sai em nenhuma;
 *  - config salva por empresa, empresa sempre da sessão; permissão: Configurações ›
 *    visualizar lê, › gerenciar salva; Ordens › visualizar para a versão interna.
 * (O SQL em si roda num PostgreSQL real em sql-relatorio-os-config.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import {
  CONFIG_RELATORIO_PADRAO, configRelatorioSchema, mesclarConfigRelatorio, mostraSecao, SECOES_RELATORIO, type ConfigRelatorioOs,
} from "@/lib/relatorio-os/config";
import { montarRelatorioOs, valorResposta, type OsParaRelatorio } from "@/lib/relatorio-os/dados";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const por = (T: (m: string) => any[], m: string, id: string | null | undefined) => T(m).find((x) => x.id === id) ?? null;
  const resposta = (T: (m: string) => any[]) => (r: any) => ({ ...r, campo: por(T, "formularioCampo", r.campoId), formulario: por(T, "formularioTemplate", r.formularioId) });
  return {
    prisma: criarPrisma(db, {
      ordemServico: (os, T) => ({
        empresa: por(T, "empresa", os.empresaId),
        cliente: por(T, "cliente", os.clienteId),
        unidade: por(T, "unidade", os.unidadeId),
        contrato: (() => { const c = por(T, "contrato", os.contratoId); return c && { ...c, responsavelTecnico: por(T, "responsavelTecnico", c.responsavelTecnicoId) }; })(),
        equipamento: por(T, "equipamento", os.equipamentoId),
        atividades: T("atividadeOs").filter((a) => a.ordemServicoId === os.id).map((a) => ({
          ...a,
          tipoOs: por(T, "tipoOs", a.tipoOsId),
          tecnico: por(T, "tecnico", a.tecnicoId),
          equipe: por(T, "equipe", a.equipeId),
          veiculo: por(T, "veiculo", a.veiculoId),
          tecnicosEquipe: T("atividadeTecnico").filter((x) => x.atividadeId === a.id).map((x) => ({ tecnico: por(T, "tecnico", x.tecnicoId) })),
          respostas: T("atividadeResposta").filter((r) => r.atividadeId === a.id).map(resposta(T)),
          equipamentos: T("atividadeEquipamento").filter((v) => v.atividadeId === a.id).map((v) => ({ ...v, equipamento: por(T, "equipamento", v.equipamentoId) })),
          respostasEquipamento: T("respostaFormularioEquipamento").filter((r) => r.atividadeId === a.id).map(resposta(T)),
        })),
      }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", role = "OPERADOR") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role, permissoes } };
};
const so = (p: Record<string, Record<string, boolean>>): Permissoes => ({ ...permissoesVazias(), ...p });

const IMG = (s: string) => `data:image/png;base64,${s}`;
function semear() {
  db.escritas = [];
  db.t = {
    empresa: [
      { id: "e1", nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "11222333000181", email: "contato@clima.com", telefone: "11999990000", logo: null },
      { id: "e2", nome: "Outra", nomeFantasia: null, cnpj: "99888777000166", email: null, telefone: null, logo: null },
    ],
    configuracao: [],
    cliente: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia S.A.", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "12345678000199", endereco: "Rua A", numero: "10", cidade: "São Paulo", estado: "SP", email: "fin@hosp.com" },
      { id: "cB", empresaId: "e2", nome: "Cliente B", nomeFantasia: null, cpfCnpj: "1" },
    ],
    unidade: [{ id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista", cidade: "São Paulo", estado: "SP", cep: "01310-100" }],
    responsavelTecnico: [{ id: "rt1", nome: "Eng. Paulo Lima", crea: "SP-12345" }],
    contrato: [{ id: "k1", empresaId: "e1", numero: "CT-2026-003", artNumero: "ART-9", responsavelTecnicoId: "rt1" }],
    tipoOs: [{ id: "to1", nome: "Preventiva" }],
    tecnico: [{ id: "t1", nome: "João Silva" }, { id: "t2", nome: "Maria Souza" }],
    equipe: [{ id: "eq1", nome: "Alfa" }],
    veiculo: [{ id: "v1", placa: "ABC1D23", modelo: "Strada", marca: "Fiat" }],
    equipamento: [
      { id: "eqA", empresaId: "e1", unidadeId: "un1", tipo: "SPLIT", marca: "LG", modelo: "S4-W12", numeroSerie: "SN-A", patrimonio: "AC-07", nome: "Split da recepção", capacidade: "12000", setor: "2º andar", localizacao: "Recepção", tipoEquipamento: { nome: "Split Hi-Wall" } },
      { id: "eqB", empresaId: "e1", unidadeId: "un1", tipo: "SPLIT", marca: "Daikin", modelo: "FTX", numeroSerie: null, patrimonio: null, nome: null, capacidade: "9000", setor: "1º andar", localizacao: "Sala 101", tipoEquipamento: { nome: "Split Hi-Wall" } },
      { id: "eqC", empresaId: "e1", unidadeId: "un1", tipo: "CASSETE", marca: "Carrier", modelo: "X", numeroSerie: null, patrimonio: "AC-99", nome: "Cassete do auditório", capacidade: null, setor: null, localizacao: "Auditório", tipoEquipamento: { nome: "Cassete" } },
    ],
    formularioTemplate: [{ id: "f1", nome: "PMOC Split" }, { id: "f2", nome: "Serviço executado" }],
    formularioCampo: [
      { id: "cFiltro", formularioId: "f1", label: "Filtro limpo", tipo: "SIM_NAO", ordem: 1 },
      { id: "cTemp", formularioId: "f1", label: "Temperatura de insuflamento (°C)", tipo: "NUMERO", ordem: 2 },
      { id: "cFoto", formularioId: "f1", label: "Foto do filtro", tipo: "FOTO", ordem: 3 },
      { id: "cAss", formularioId: "f1", label: "Assinatura do técnico", tipo: "ASSINATURA", ordem: 4 },
      { id: "cVazio", formularioId: "f1", label: "Observação do equipamento", tipo: "TEXTO_CURTO", ordem: 5 },
      { id: "cObs", formularioId: "f2", label: "O que foi feito", tipo: "TEXTO_LONGO", ordem: 1 },
      { id: "cFotoG", formularioId: "f2", label: "Foto geral", tipo: "FOTO", ordem: 2 },
    ],
    ordemServico: [
      { id: "os1", empresaId: "e1", numero: "OS-2026-0042", clienteId: "c1", unidadeId: "un1", contratoId: "k1", equipamentoId: null, status: "CONCLUIDA",
        descricao: "Manutenção preventiva mensal", observacoes: "Cliente pediu retorno em 30 dias.", criadoEm: new Date("2026-10-01T12:00:00Z"),
        dataInicio: new Date("2026-10-02T12:00:00Z"), dataConclusao: new Date("2026-10-02T18:00:00Z"), previsaoConclusao: null },
      { id: "osB", empresaId: "e2", numero: "OS-B-1", clienteId: "cB", unidadeId: null, contratoId: null, equipamentoId: null, status: "ABERTA",
        descricao: "Da outra", observacoes: null, criadoEm: new Date("2026-10-01T12:00:00Z"), dataInicio: null, dataConclusao: null, previsaoConclusao: null },
    ],
    atividadeOs: [{ id: "a1", ordemServicoId: "os1", titulo: "Preventiva mensal", status: "CONCLUIDA", tipoOsId: "to1", tecnicoId: "t1", equipeId: "eq1", veiculoId: "v1",
      criadoEm: new Date("2026-10-02T12:00:00Z"), dataAgendada: new Date("2026-10-02T12:30:00Z"), duracaoMin: 95, observacao: "Limpeza de filtros e verificação elétrica.", resumo: "O que foi feito: Troca do capacitor\nFoto geral: Foto anexada" }],
    atividadeTecnico: [{ atividadeId: "a1", tecnicoId: "t2" }],
    atividadeEquipamento: [
      { id: "ae1", atividadeId: "a1", equipamentoId: "eqA", feito: true },
      { id: "ae2", atividadeId: "a1", equipamentoId: "eqB", feito: true },
      { id: "ae3", atividadeId: "a1", equipamentoId: "eqC", feito: false },
    ],
    respostaFormularioEquipamento: [
      { atividadeId: "a1", equipamentoId: "eqA", formularioId: "f1", campoId: "cTemp", resposta: "12", arquivoUrl: null },
      { atividadeId: "a1", equipamentoId: "eqA", formularioId: "f1", campoId: "cFiltro", resposta: "sim", arquivoUrl: null },
      { atividadeId: "a1", equipamentoId: "eqA", formularioId: "f1", campoId: "cFoto", resposta: null, arquivoUrl: IMG("FOTO_A") },
      { atividadeId: "a1", equipamentoId: "eqA", formularioId: "f1", campoId: "cAss", resposta: "João Silva", arquivoUrl: IMG("ASS") },
      { atividadeId: "a1", equipamentoId: "eqA", formularioId: "f1", campoId: "cVazio", resposta: "  ", arquivoUrl: null },
      { atividadeId: "a1", equipamentoId: "eqB", formularioId: "f1", campoId: "cFiltro", resposta: "nao", arquivoUrl: null },
      { atividadeId: "a1", equipamentoId: "eqB", formularioId: "f1", campoId: "cTemp", resposta: "14", arquivoUrl: null },
      { atividadeId: "a1", equipamentoId: "eqB", formularioId: "f1", campoId: "cFoto", resposta: null, arquivoUrl: IMG("FOTO_B") },
      { atividadeId: "a1", equipamentoId: "eqB", formularioId: "f1", campoId: "cAss", resposta: null, arquivoUrl: IMG("ASS") },
    ],
    atividadeResposta: [
      { atividadeId: "a1", formularioId: "f2", campoId: "cObs", resposta: "Troca do capacitor do Split da recepção.", arquivoUrl: null },
      { atividadeId: "a1", formularioId: "f2", campoId: "cFotoG", resposta: null, arquivoUrl: IMG("FOTO_GERAL") },
    ],
    relatorioOs: [
      { id: "r1", empresaId: "e1", ordemServicoId: "os1", escopo: "GERAL", numero: "REL-2026-0007", tokenPublico: "tok-1", observacao: null, assinaturaUrl: null, assinadoPor: null, assinadoEm: null, criadoEm: new Date() },
      { id: "rB", empresaId: "e2", ordemServicoId: "osB", escopo: "GERAL", numero: "REL-B", tokenPublico: "tok-B", observacao: null, assinaturaUrl: null, assinadoPor: null, assinadoEm: null, criadoEm: new Date() },
    ],
  };
}
beforeEach(() => { semear(); logar(); });

const T = (m: string) => (db.t as any)[m] as any[];
async function osCarregada(id = "os1", empresaId = "e1") {
  const { carregarOsParaRelatorio } = await import("@/lib/relatorio-os/dados");
  return (await carregarOsParaRelatorio(id, empresaId))!;
}
const comConfig = (mudancas: Partial<ConfigRelatorioOs>) => ({ ...CONFIG_RELATORIO_PADRAO, ...mudancas });
const salvarConfig = (cfg: ConfigRelatorioOs, empresaId = "e1") => {
  const c = T("configuracao").find((x) => x.empresaId === empresaId);
  if (c) c.relatorioOsConfig = cfg; else T("configuracao").push({ id: `cfg-${empresaId}`, empresaId, relatorioOsConfig: cfg });
};
const secoes = (h: string) => [...h.matchAll(/data-secao="([^"]+)"/g)].map((m) => m[1]);
const attrs = (h: string, a: string) => [...h.matchAll(new RegExp(`${a}="([^"]+)"`, "g"))].map((m) => m[1]);

// ═════════════════════════ Configuração (pura) ═════════════════════════
describe("configuração de impressão", () => {
  it("padrão: tudo ligado; cliente vê tudo menos 'não atendidos' e 'horários'", () => {
    expect(SECOES_RELATORIO.map((s) => s.id)).toEqual(["resultado", "clienteLocal", "equipe", "equipamentos", "fotos", "adicionais", "checklistGeral", "naoAtendidos", "tempos", "observacoes", "assinaturas"]);
    expect(SECOES_RELATORIO.every((s) => CONFIG_RELATORIO_PADRAO[s.id].ativo)).toBe(true);
    expect(SECOES_RELATORIO.filter((s) => !CONFIG_RELATORIO_PADRAO[s.id].cliente).map((s) => s.id)).toEqual(["naoAtendidos", "tempos"]);
    expect(mesclarConfigRelatorio(null)).toEqual(CONFIG_RELATORIO_PADRAO);
  });

  it("mescla o salvo com o padrão; ignora seção desconhecida, valor não booleano e JSON que não é objeto", () => {
    const c = mesclarConfigRelatorio({ fotos: { ativo: false }, tempos: { cliente: true }, resultado: { ativo: "não", cliente: 1 }, inventada: { ativo: false }, equipe: null });
    expect(c.fotos).toEqual({ ativo: false, cliente: true });
    expect(c.tempos).toEqual({ ativo: true, cliente: true });
    expect(c.resultado).toEqual({ ativo: true, cliente: true });
    expect(c.equipe).toEqual({ ativo: true, cliente: true });
    expect(c).not.toHaveProperty("inventada");
    expect(mesclarConfigRelatorio([{ fotos: { ativo: false } }])).toEqual(CONFIG_RELATORIO_PADRAO);
    expect(mesclarConfigRelatorio("x")).toEqual(CONFIG_RELATORIO_PADRAO);
    // não altera o padrão (cópia)
    c.equipe.ativo = false;
    expect(CONFIG_RELATORIO_PADRAO.equipe.ativo).toBe(true);
  });

  it("quem vê: desligada = ninguém; ligada + cliente = as duas versões; ligada + só interno = só a interna", () => {
    const c = comConfig({ fotos: { ativo: false, cliente: true }, tempos: { ativo: true, cliente: false }, equipe: { ativo: true, cliente: true } });
    expect([mostraSecao(c, "fotos", "cliente"), mostraSecao(c, "fotos", "interna")]).toEqual([false, false]);
    expect([mostraSecao(c, "tempos", "cliente"), mostraSecao(c, "tempos", "interna")]).toEqual([false, true]);
    expect([mostraSecao(c, "equipe", "cliente"), mostraSecao(c, "equipe", "interna")]).toEqual([true, true]);
  });

  it("corpo do PUT: todas as seções, só { ativo, cliente } booleanos", () => {
    expect(configRelatorioSchema.safeParse(CONFIG_RELATORIO_PADRAO).success).toBe(true);
    const { fotos: _f, ...semFotos } = CONFIG_RELATORIO_PADRAO;
    expect(configRelatorioSchema.safeParse(semFotos).success).toBe(false);
    expect(configRelatorioSchema.safeParse({ ...CONFIG_RELATORIO_PADRAO, empresaId: "e2" }).success).toBe(false);
    expect(configRelatorioSchema.safeParse({ ...CONFIG_RELATORIO_PADRAO, fotos: { ativo: true, cliente: true, extra: 1 } }).success).toBe(false);
    expect(configRelatorioSchema.safeParse({ ...CONFIG_RELATORIO_PADRAO, fotos: { ativo: "sim", cliente: true } }).success).toBe(false);
  });
});

// ═════════════════════════ Montagem ═════════════════════════
describe("montagem do relatório por equipamento", () => {
  it("um bloco por equipamento ATENDIDO: local em cima, equipamento + TAG, checklist e fotos só dele", async () => {
    const d = montarRelatorioOs(await osCarregada(), null);
    // ordem pelo local (setor): 1º andar antes do 2º
    expect(d.equipamentos.map((b) => b.id)).toEqual(["eqB", "eqA"]);
    const [b, a] = d.equipamentos;
    expect(a).toMatchObject({
      local: { principal: "Recepção", complemento: "2º andar", unidade: "Matriz" },
      titulo: "Split da recepção", descricao: "Split Hi-Wall — 12.000 BTU/h", fabricante: "LG S4-W12", tag: "AC-07", numeroSerie: "SN-A",
    });
    expect(b).toMatchObject({ titulo: "Split Hi-Wall — 9.000 BTU/h", tag: null, numeroSerie: null, local: { principal: "Sala 101", complemento: "1º andar" } });
    // checklist na ordem dos campos; foto/assinatura/resposta em branco fora
    expect(a.checklist).toEqual([{ formulario: "PMOC Split", atividade: "Preventiva mensal", itens: [
      { label: "Filtro limpo", tipo: "SIM_NAO", valor: "Sim" },
      { label: "Temperatura de insuflamento (°C)", tipo: "NUMERO", valor: "12" },
    ] }]);
    expect(b.checklist[0].itens.map((i) => i.valor)).toEqual(["Não", "14"]);
    expect(a.fotos).toEqual([{ url: IMG("FOTO_A"), legenda: "Foto do filtro" }]);
    expect(b.fotos).toEqual([{ url: IMG("FOTO_B"), legenda: "Foto do filtro" }]);
  });

  it("não atendidos à parte; formulário geral (sem equipamento) com as suas fotos", async () => {
    const d = montarRelatorioOs(await osCarregada(), null);
    expect(d.naoAtendidos).toEqual([{ id: "eqC", titulo: "Cassete do auditório", local: "Auditório" }]);
    expect(d.geral.checklist).toEqual([{ formulario: "Serviço executado", atividade: "Preventiva mensal", itens: [{ label: "O que foi feito", tipo: "TEXTO_LONGO", valor: "Troca do capacitor do Split da recepção." }] }]);
    expect(d.geral.fotos).toEqual([{ url: IMG("FOTO_GERAL"), legenda: "Foto geral" }]);
  });

  it("resultado, cabeçalho, cliente/local, equipe e veículo", async () => {
    const d = montarRelatorioOs(await osCarregada(), { numero: "REL-1", observacao: "Sem pendências.", assinaturaUrl: null, assinadoPor: null, assinadoEm: null });
    expect(d.resultado).toEqual({
      texto: "Concluída · 2 de 3 equipamentos atendidos · 1 de 1 atividade concluída. Limpeza de filtros e verificação elétrica.",
      atendidos: 2, totalEquipamentos: 3, atividades: 1, concluidas: 1,
    });
    expect([d.numeroOs, d.numeroRelatorio, d.tipos, d.situacao, d.solicitacao]).toEqual(["OS-2026-0042", "REL-1", ["Preventiva"], "Concluída", "Manutenção preventiva mensal"]);
    expect(d.local).toEqual({ nome: "Matriz", endereco: "Av. Paulista, 1000 — Bela Vista — São Paulo/SP — CEP 01310-100" });
    expect(d.equipe).toEqual([{ atividade: "Preventiva mensal", tecnicos: "Equipe Alfa: João Silva (responsável), Maria Souza", veiculo: "ABC1D23 — Fiat Strada" }]);
    expect(d.observacoes).toEqual(["Cliente pediu retorno em 30 dias.", "Sem pendências."]);
    expect(d.envio).toEqual({ email: "fin@hosp.com", whatsapp: null });
    expect(d.tempos).toEqual([{ atividade: "Preventiva mensal", status: "CONCLUIDA", inicio: new Date("2026-10-02T12:30:00Z"), duracaoMin: 95 }]);
  });

  it("assinatura replicada nos equipamentos conta uma vez; aprovação do cliente entra com nome e data", async () => {
    const quando = new Date("2026-10-03T10:00:00Z");
    const d = montarRelatorioOs(await osCarregada(), { numero: "R", observacao: null, assinaturaUrl: IMG("CLI"), assinadoPor: "Dra. Carla", assinadoEm: quando });
    expect(d.assinaturas.coletadas).toEqual([
      { rotulo: "Assinatura do técnico", url: IMG("ASS"), nome: null, data: null },
      { rotulo: "Aprovação do cliente", url: IMG("CLI"), nome: "Dra. Carla", data: quando },
    ]);
    expect(d.assinaturas.responsavel).toEqual({ nome: "Eng. Paulo Lima", crea: "SP-12345" });
    expect(d.assinaturas.clienteNome).toBe("Hospital Santa Luzia");
  });

  it("OS antiga com equipamento principal (sem vínculo na atividade) vira bloco; sem nada = sem blocos", async () => {
    T("ordemServico")[0].equipamentoId = "eqC";
    T("atividadeEquipamento").length = 0;
    const d = montarRelatorioOs(await osCarregada(), null);
    expect(d.equipamentos.map((b) => b.id)).toEqual(["eqC"]);
    expect(d.naoAtendidos).toEqual([]);
    expect(d.resultado.texto.startsWith("Concluída · 1 de 1 equipamento atendido · ")).toBe(true);
    T("ordemServico")[0].equipamentoId = null;
    const v = montarRelatorioOs(await osCarregada(), null);
    expect([v.equipamentos, v.resultado.totalEquipamentos]).toEqual([[], 0]);
    expect(v.resultado.texto).toBe("Concluída · 1 de 1 atividade concluída. Limpeza de filtros e verificação elétrica.");
  });

  it("resultado usa o relato do técnico, nunca o despejo automático das respostas (resumo)", async () => {
    const d = montarRelatorioOs(await osCarregada(), null);
    expect(d.resultado.texto).not.toContain("Foto anexada");
    T("atividadeOs")[0].observacao = null;
    expect(montarRelatorioOs(await osCarregada(), null).resultado.texto).toBe("Concluída · 2 de 3 equipamentos atendidos · 1 de 1 atividade concluída");
  });

  it("equipe cujo nome já começa com 'Equipe' não repete a palavra", async () => {
    T("equipe")[0].nome = "Equipe Alfa";
    expect(montarRelatorioOs(await osCarregada(), null).equipe[0].tecnicos).toBe("Equipe Alfa: João Silva (responsável), Maria Souza");
    T("atividadeTecnico").length = 0; T("atividadeOs")[0].tecnicoId = null;
    expect(montarRelatorioOs(await osCarregada(), null).equipe[0].tecnicos).toBe("Equipe Alfa");
    T("equipe")[0].nome = "Equipamentos especiais"; // "Equipamentos…" não é "Equipe …"
    expect(montarRelatorioOs(await osCarregada(), null).equipe[0].tecnicos).toBe("Equipe Equipamentos especiais");
  });

  it("equipamento feito em QUALQUER atividade conta como atendido (a ordem das atividades não importa)", async () => {
    T("atividadeOs").push({ id: "a2", ordemServicoId: "os1", titulo: "Retorno", status: "AGENDADA", tipoOsId: null, tecnicoId: null, equipeId: null, veiculoId: null,
      criadoEm: new Date("2026-10-05T12:00:00Z"), dataAgendada: null, duracaoMin: null, observacao: null, resumo: null });
    T("atividadeEquipamento").push({ id: "ae4", atividadeId: "a2", equipamentoId: "eqA", feito: false }, { id: "ae5", atividadeId: "a2", equipamentoId: "eqC", feito: true });
    const d = montarRelatorioOs(await osCarregada(), null);
    expect(d.equipamentos.map((b) => b.id).sort()).toEqual(["eqA", "eqB", "eqC"]);
    expect(d.naoAtendidos).toEqual([]);
  });

  it("mesma observação na OS e no relatório sai uma vez", async () => {
    const d = montarRelatorioOs(await osCarregada(), { numero: "R", observacao: "Cliente pediu retorno em 30 dias.", assinaturaUrl: null, assinadoPor: null, assinadoEm: null });
    expect(d.observacoes).toEqual(["Cliente pediu retorno em 30 dias."]);
  });

  it("valores legíveis: Sim/Não, data, múltipla escolha", () => {
    expect(["sim", "SIM", "true", "1", "yes"].map((v) => valorResposta("SIM_NAO", v))).toEqual(["Sim", "Sim", "Sim", "Sim", "Sim"]);
    expect(["nao", "não", "false", ""].map((v) => valorResposta("SIM_NAO", v))).toEqual(["Não", "Não", "Não", "Não"]);
    expect(valorResposta("DATA", "2026-10-02")).toBe("02/10/2026");
    expect(valorResposta("DATA", "ontem")).toBe("ontem");
    expect(valorResposta("MULTIPLA_ESCOLHA", '["Limpeza","Carga de gás"]')).toBe("Limpeza, Carga de gás");
    expect(valorResposta("MULTIPLA_ESCOLHA", "[quebrado")).toBe("[quebrado");
    expect(valorResposta("TEXTO_CURTO", "  ok  ")).toBe("ok");
  });

  it("OS de outra empresa não carrega", async () => {
    const { carregarOsParaRelatorio } = await import("@/lib/relatorio-os/dados");
    expect(await carregarOsParaRelatorio("osB", "e1")).toBeNull();
    expect(await carregarOsParaRelatorio("os1", "e2")).toBeNull();
  });
});

// ═════════════════════════ API da configuração ═════════════════════════
describe("API /api/configuracoes/impressao-os", () => {
  const chamar = async (metodo: "GET" | "PUT", corpo?: unknown) => {
    const mod = await import("@/app/api/configuracoes/impressao-os/route");
    const req = new NextRequest("http://localhost/api/configuracoes/impressao-os", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const res: Response = metodo === "GET" ? await mod.GET() : await mod.PUT(req);
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const nova = comConfig({ fotos: { ativo: true, cliente: false }, tempos: { ativo: false, cliente: false } });

  it("GET devolve o padrão; PUT salva na empresa da sessão; outra empresa não é afetada", async () => {
    expect((await chamar("GET")).json).toEqual(CONFIG_RELATORIO_PADRAO);
    const r = await chamar("PUT", nova);
    expect([r.status, r.json]).toEqual([200, nova]);
    expect(T("configuracao")).toEqual([expect.objectContaining({ empresaId: "e1", relatorioOsConfig: nova })]);
    expect((await chamar("GET")).json).toEqual(nova);
    logar(permissoesTotais(), "e2");
    expect((await chamar("GET")).json).toEqual(CONFIG_RELATORIO_PADRAO);
    // regravar atualiza a mesma linha
    logar();
    await chamar("PUT", CONFIG_RELATORIO_PADRAO);
    expect(T("configuracao")).toHaveLength(1);
    expect(T("configuracao")[0].relatorioOsConfig).toEqual(CONFIG_RELATORIO_PADRAO);
  });

  it("PUT inválido = 400 (seção faltando, campo extra, empresaId no corpo); nada gravado", async () => {
    const { fotos: _f, ...semFotos } = CONFIG_RELATORIO_PADRAO;
    for (const corpo of [semFotos, { ...CONFIG_RELATORIO_PADRAO, empresaId: "e2" }, null, "x"]) {
      const r = await chamar("PUT", corpo);
      expect([r.status, r.json.erro]).toEqual([400, "Configuração inválida."]);
    }
    expect(db.escritas).toEqual([]);
  });

  it("permissão: sem sessão 401; ler = Configurações › visualizar; salvar = › gerenciar", async () => {
    sessao.atual = null;
    expect((await chamar("GET")).status).toBe(401);
    expect((await chamar("PUT", nova)).status).toBe(401);
    logar(so({ ordens: { visualizar: true } }));
    expect((await chamar("GET")).status).toBe(403);
    logar(so({ configuracoes: { visualizar: true, gerenciar: false } }));
    expect((await chamar("GET")).status).toBe(200);
    expect((await chamar("PUT", nova)).status).toBe(403);
    expect(db.escritas).toEqual([]);
    logar(so({ configuracoes: { visualizar: true, gerenciar: true } }));
    expect((await chamar("PUT", nova)).status).toBe(200);
    logar(permissoesVazias(), "e1", "ADMIN");
    expect((await chamar("PUT", CONFIG_RELATORIO_PADRAO)).status).toBe(200);
  });
});

// ═════════════════════════ Páginas: versão do cliente × interna ═════════════════════════
const publica = async (token: string) => {
  const { default: P } = await import("@/app/(publico)/relatorio/os/[token]/page");
  return renderToStaticMarkup(await P({ params: Promise.resolve({ token }) }));
};
const publicaImprimir = async (token: string) => {
  const { default: P } = await import("@/app/(publico)/relatorio/os/[token]/imprimir/page");
  return renderToStaticMarkup(await P({ params: Promise.resolve({ token }) }));
};
const interna = async (id: string, versao?: string) => {
  const { default: P } = await import("@/app/(impressao)/ordens/[id]/relatorio/page");
  return renderToStaticMarkup(await P({ params: Promise.resolve({ id }), searchParams: Promise.resolve(versao ? { versao } : {}) }));
};
const TODAS = ["cabecalho", "resultado", "clienteLocal", "equipe", "equipamentos", "checklistGeral", "naoAtendidos", "tempos", "observacoes", "assinaturas"];
const DO_CLIENTE = TODAS.filter((s) => s !== "naoAtendidos" && s !== "tempos");

describe("versões do relatório", () => {
  it("link público = versão do cliente: sem as seções 'só interno' e sem a marca interna", async () => {
    sessao.atual = null; // público: não precisa de login
    const h = await publica("tok-1");
    expect(secoes(h)).toEqual(DO_CLIENTE);
    expect(h).toContain('data-versao="cliente"');
    expect(h).not.toContain("data-marca-interna");
    expect(h).not.toContain("Cassete do auditório");
    expect(h).not.toContain("1h 35min");
    // blocos por equipamento com TAG, checklist e fotos de cada um
    expect(attrs(h, "data-equipamento")).toEqual(["eqB", "eqA"]);
    expect(h.match(/data-tag="true">TAG [^<]+</g)).toEqual(['data-tag="true">TAG AC-07<']); // só o eqA tem TAG
    const blocoA = h.slice(h.indexOf('data-equipamento="eqA"'));
    expect(blocoA).toContain(IMG("FOTO_A"));
    expect(blocoA).not.toContain(IMG("FOTO_B"));
    expect(h.split(IMG("ASS")).length - 1).toBe(1); // assinatura replicada sai uma vez
    expect(await publicaImprimir("tok-1")).toContain('data-versao="cliente"');
  });

  it("versão interna (logado): todas as seções ligadas + marca 'Versão interna'; ?versao=cliente = prévia do cliente", async () => {
    const h = await interna("os1");
    expect(secoes(h)).toEqual(TODAS);
    expect(h).toContain("data-marca-interna");
    expect(h).toContain("Cassete do auditório");
    expect(h).toContain("1h 35min");
    expect(attrs(h, "data-aba-versao")).toEqual(["interna", "cliente"]);
    const p = await interna("os1", "cliente");
    expect(secoes(p)).toEqual(DO_CLIENTE);
    expect(p).toContain('href="/relatorio/os/tok-1"');
    expect(p).not.toContain("data-marca-interna");
  });

  it("a configuração da empresa manda: só interno some do cliente; desligada some das duas", async () => {
    salvarConfig(comConfig({ fotos: { ativo: true, cliente: false }, equipe: { ativo: false, cliente: true }, tempos: { ativo: true, cliente: true } }));
    const cli = await publica("tok-1");
    expect(secoes(cli)).toEqual(["cabecalho", "resultado", "clienteLocal", "equipamentos", "checklistGeral", "tempos", "observacoes", "assinaturas"]);
    expect(cli).not.toContain(IMG("FOTO_A"));
    expect(cli).not.toContain(IMG("FOTO_GERAL"));
    expect(cli).toContain("Filtro limpo"); // checklist continua
    const int = await interna("os1");
    expect(int).toContain(IMG("FOTO_A"));
    expect(int).toContain(IMG("FOTO_GERAL"));
    expect(secoes(int)).not.toContain("equipe");
    expect(int).not.toContain("ABC1D23");
    // config de OUTRA empresa não afeta esta
    salvarConfig(comConfig({ resultado: { ativo: false, cliente: false } }), "e2");
    expect(secoes(await publica("tok-1"))).toContain("resultado");
  });

  it("só fotos ligadas (checklist desligado): o bloco mostra local, equipamento e fotos, sem checklist", async () => {
    salvarConfig(comConfig({ equipamentos: { ativo: false, cliente: true } }));
    const h = await publica("tok-1");
    expect(attrs(h, "data-equipamento")).toEqual(["eqB", "eqA"]);
    expect(h).toContain(IMG("FOTO_A"));
    expect(h).not.toContain("Filtro limpo");
    salvarConfig(comConfig({ equipamentos: { ativo: false, cliente: true }, fotos: { ativo: false, cliente: true } }));
    expect(attrs(await publica("tok-1"), "data-equipamento")).toEqual([]);
  });

  it("seção sem dado não aparece (OS sem observações, sem equipe, sem equipamentos)", async () => {
    T("ordemServico")[0].observacoes = null;
    T("atividadeOs")[0].tecnicoId = null; T("atividadeOs")[0].equipeId = null; T("atividadeOs")[0].veiculoId = null;
    T("atividadeTecnico").length = 0;
    T("atividadeEquipamento").length = 0;
    const h = await interna("os1");
    expect(secoes(h)).toEqual(["cabecalho", "resultado", "clienteLocal", "checklistGeral", "tempos", "assinaturas"]);
  });

  it("isolamento e permissão: token inexistente/OS de outra empresa = 404; sem login = login; sem Ordens = sem permissão", async () => {
    await expect(publica("nao-existe")).rejects.toThrow("NEXT_NOT_FOUND");
    // o link público usa a empresa DO RELATÓRIO (não a de quem estiver logado)
    const b = await publica("tok-B");
    expect(b).toContain("OS-B-1");
    expect(b).not.toContain("OS-2026-0042");
    await expect(interna("osB")).rejects.toThrow("NEXT_NOT_FOUND"); // logado na e1
    logar(permissoesTotais(), "e2");
    expect(secoes(await interna("osB"))).toContain("cabecalho");
    await expect(interna("os1")).rejects.toThrow("NEXT_NOT_FOUND");
    sessao.atual = null;
    await expect(interna("os1")).rejects.toThrow("NEXT_REDIRECT /login?callbackUrl=/ordens/os1/relatorio");
    logar(so({ clientes: { visualizar: true } }));
    await expect(interna("os1")).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
    logar(so({ ordens: { visualizar: true } }));
    expect(secoes(await interna("os1"))).toEqual(TODAS);
  });

  it("abrir o relatório não grava nada", async () => {
    await publica("tok-1"); await interna("os1");
    expect(db.escritas).toEqual([]);
  });
});

// ═════════════════════════ Tela de configuração ═════════════════════════
describe("tela Configurações › Impressão da OS", () => {
  const tela = async () => {
    const { default: P } = await import("@/app/(dashboard)/configuracoes/impressao-os/page");
    return renderToStaticMarkup(await P());
  };
  it("lista as seções com o estado salvo; quem só visualiza vê em modo leitura", async () => {
    salvarConfig(comConfig({ fotos: { ativo: false, cliente: true }, tempos: { ativo: true, cliente: true } }));
    const h = await tela();
    expect(attrs(h, "data-secao")).toEqual(SECOES_RELATORIO.map((s) => s.id));
    expect(h).toMatch(/aria-checked="false" aria-label="Incluir Fotos dos equipamentos"/);
    expect(h).toContain('data-conta="cliente">9<');
    expect(h).toContain('data-conta="interna">10<');
    expect(h).not.toContain("data-somente-leitura");
    logar(so({ configuracoes: { visualizar: true } }));
    const r = await tela();
    expect(r).toContain("data-somente-leitura");
    expect(r).not.toContain(">Salvar<");
  });

  it("menu: item na seção operacional, protegido por Configurações", async () => {
    const { SECOES_CONFIGURACOES, secoesVisiveis } = await import("@/lib/navegacao/configuracoes");
    const itens = (s: typeof SECOES_CONFIGURACOES) => s.flatMap((x) => x.subgrupos.flatMap((g) => g.itens.map((i) => i.href)));
    expect(itens(SECOES_CONFIGURACOES)).toContain("/configuracoes/impressao-os");
    expect(itens(secoesVisiveis(so({ ordens: { visualizar: true } }), "OPERADOR"))).not.toContain("/configuracoes/impressao-os");
    expect(itens(secoesVisiveis(so({ configuracoes: { visualizar: true } }), "OPERADOR"))).toContain("/configuracoes/impressao-os");
  });
});
