/**
 * LEVA J — Colaborador, no PostgreSQL real (dados fictícios):
 *  - as rotas do colaborador gravam a jornada em faixas e refazem os campos antigos dela; o cliente antigo (sem
 *    faixas) grava os campos antigos e as faixas saem; a faixa sobreposta é recusada (400);
 *  - "Usa o app de campo" + "RT" chegam ao banco como tipo/tipoEquipe coerentes; as competências só da empresa;
 *  - o texto da jornada nos documentos do colaborador (o mesmo do contrato);
 *  - Configurações › Impressão grava "Mostrar especialidades do técnico" (padrão ligado, sem apagar as seções);
 *  - o relatório da OS (interno e do link do cliente) põe as especialidades junto ao nome — e tira quando desligado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-j-colaborador-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { CONFIG_RELATORIO_PADRAO } from "@/lib/relatorio-os/config";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva_j_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const h = vi.hoisted(() => ({ sessao: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sessao) }));

async function rota(caminho: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  return { status: res.status, texto, json: (() => { try { return JSON.parse(texto); } catch { return null; } })() };
}

const SEG_QUI = { dias: ["SEG", "TER", "QUA", "QUI"], entrada: "07:30", saida: "17:30", intervaloInicio: "12:00", intervaloFim: "13:00" };
const SEX = { dias: ["SEX"], entrada: "07:30", saida: "16:30", intervaloInicio: "12:00", intervaloFim: "13:00" };
const BASE = { nome: "Carlos Oliveira", cpf: "529.982.247-25", telefone: "(11) 3333-4444" };

describe.skipIf(!URL_PG)("Leva J — colaborador (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["api/tecnicos", "api/tecnicos/[id]", "api/configuracoes/impressao-os"].map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    for (const e of ["e1", "e2"]) await prisma.empresa.create({ data: { id: e, nome: `Clima ${e} (fictícia)`, cnpj: `12.345.678/000${e === "e1" ? 1 : 2}-90`, email: `${e}@x.test` } });
    await prisma.usuario.create({ data: { id: "uAdmin", empresaId: "e1", nome: "Admin", email: "admin@clima.exemplo", senha: "x", role: "ADMIN" } });
    h.sessao = { user: { id: "uAdmin", name: "Admin", email: "admin@clima.exemplo", empresaId: "e1", empresaNome: "x", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } };
    await prisma.tipoOs.create({ data: { id: "toVrf", empresaId: "e1", nome: "Instalação de VRF", cor: "#00a" } });
    await prisma.tipoOs.create({ data: { id: "toAlheio", empresaId: "e2", nome: "De outra empresa", cor: "#a00" } });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  let id = "";
  it("cadastrar com faixas: grava as faixas e refaz os campos antigos (os dias de todas, o horário da 1ª); a função coerente", async () => {
    const r = await rota("api/tecnicos", "POST", {
      ...BASE, jornadaFaixas: [SEG_QUI, SEX], jornadaEntrada: "01:00", jornadaDias: ["DOM"],
      tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "ADMINISTRATIVO", crea: "5012345-D/SP", competenciaIds: ["toVrf"], especialidades: ["VRF", "Chiller"],
    });
    expect(r.status, r.texto).toBe(201);
    id = r.json.id;
    const t = await prisma.tecnico.findUnique({ where: { id }, include: { competencias: { select: { id: true } } } });
    expect(t.jornadaFaixas).toEqual([SEG_QUI, SEX]);
    expect(t).toMatchObject({ jornadaDias: ["SEG", "TER", "QUA", "QUI", "SEX"], jornadaEntrada: "07:30", jornadaSaida: "17:30", tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "ADMINISTRATIVO" });
    expect(t.competencias).toEqual([{ id: "toVrf" }]);
  });

  it("o texto da jornada nos documentos do colaborador (o mesmo do contrato)", async () => {
    const { dadosAutomaticos } = await import("@/lib/documentos/documentos-server");
    const { valores } = await dadosAutomaticos(id, "e1");
    expect(valores.jornada).toBe("segunda a quinta, 07:30 às 17:30, com intervalo de 12:00 às 13:00; sexta, 07:30 às 16:30, com intervalo de 12:00 às 13:00 — 44h semanais");
  });

  it("faixa sobreposta: 400 com a faixa e o dia; nada muda no banco", async () => {
    const r = await rota("api/tecnicos/[id]", "PUT", { ...BASE, jornadaFaixas: [SEG_QUI, { ...SEX, dias: ["QUI", "SEX"] }] }, { id });
    expect(r.status).toBe(400);
    expect(r.texto).toContain("Faixa 2: Qui já está na faixa 1.");
    expect((await prisma.tecnico.findUnique({ where: { id } })).jornadaFaixas).toEqual([SEG_QUI, SEX]);
  });

  it("o cliente antigo (sem faixas) grava os campos antigos e a faixa velha sai (não passa por cima do horário novo)", async () => {
    const r = await rota("api/tecnicos/[id]", "PUT", { ...BASE, jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["TER", "SEG"] }, { id });
    expect(r.status, r.texto).toBe(200);
    const t = await prisma.tecnico.findUnique({ where: { id } });
    expect(t).toMatchObject({ jornadaFaixas: null, jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEG", "TER"] });
    const { dadosAutomaticos } = await import("@/lib/documentos/documentos-server");
    expect((await dadosAutomaticos(id, "e1")).valores.jornada).toBe("segunda e terça, 08:00 às 18:00 — 20h semanais");
  });

  it("a ficha sem jornada (todas as faixas removidas) grava vazio", async () => {
    const r = await rota("api/tecnicos/[id]", "PUT", { ...BASE, jornadaFaixas: [] }, { id });
    expect(r.status, r.texto).toBe(200);
    expect(await prisma.tecnico.findUnique({ where: { id }, select: { jornadaFaixas: true, jornadaDias: true, jornadaEntrada: true } }))
      .toEqual({ jornadaFaixas: null, jornadaDias: [], jornadaEntrada: null });
  });

  it("competência de outra empresa é recusada", async () => {
    const r = await rota("api/tecnicos/[id]", "PUT", { ...BASE, competenciaIds: ["toAlheio"] }, { id });
    expect(r.status).toBe(400);
  });

  describe("especialidades no relatório e a chave da empresa", () => {
    beforeAll(async () => {
      await prisma.tecnico.create({ data: { id: "tMaria", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "1", especialidades: [] } });
      await prisma.tecnico.update({ where: { id }, data: { especialidades: ["VRF", "Chiller"] } });
      await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "44.555.666/0001-77" } });
      await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-777", clienteId: "c1", criadoPorId: "uAdmin", descricao: "Preventiva", status: "CONCLUIDA" } });
      await prisma.atividadeOs.create({ data: { id: "at1", empresaId: "e1", ordemServicoId: "os1", titulo: "Chiller", status: "CONCLUIDA", tecnicoId: id,
        tecnicosEquipe: { create: [{ tecnicoId: id }, { tecnicoId: "tMaria" }] } } });
      await prisma.relatorioOs.create({ data: { id: "rel1", empresaId: "e1", ordemServicoId: "os1", escopo: "GERAL", numero: "REL-1", mesReferencia: 11, anoReferencia: 2026, tokenPublico: "tok-ficticio" } });
    });

    it("sem configuração gravada, o padrão é ligado: o relatório interno e o do cliente com 'especialista em'", async () => {
      const { relatorioInterno, relatorioPorToken, mostrarEspecialidades } = await import("@/lib/relatorio-os/dados");
      expect(await mostrarEspecialidades("e1")).toBe(true);
      expect((await relatorioInterno("os1", "e1"))!.dados.equipe[0].tecnicos).toBe("Carlos Oliveira (responsável) — especialista em VRF e Chiller; Maria Souza");
      expect((await relatorioPorToken("tok-ficticio"))!.dados.equipe[0].tecnicos).toBe("Carlos Oliveira (responsável) — especialista em VRF e Chiller; Maria Souza");
    });

    it("Configurações › Impressão: desligar grava a chave sem mexer nas seções; o relatório volta a só o nome", async () => {
      const cfg = { ...CONFIG_RELATORIO_PADRAO, fotos: { ativo: false, cliente: false } };
      const r = await rota("api/configuracoes/impressao-os", "PUT", { ...cfg, mostrarEspecialidadesTecnico: false });
      expect(r.status, r.texto).toBe(200);
      expect(r.json.mostrarEspecialidadesTecnico).toBe(false);
      const c = await prisma.configuracao.findUnique({ where: { empresaId: "e1" } });
      expect(c.mostrarEspecialidadesTecnico).toBe(false);
      expect(c.relatorioOsConfig.fotos).toEqual({ ativo: false, cliente: false });
      const { relatorioInterno, relatorioPorToken } = await import("@/lib/relatorio-os/dados");
      expect((await relatorioInterno("os1", "e1"))!.dados.equipe[0].tecnicos).toBe("Carlos Oliveira (responsável), Maria Souza");
      expect((await relatorioPorToken("tok-ficticio"))!.dados.equipe[0].tecnicos).toBe("Carlos Oliveira (responsável), Maria Souza");
    });

    it("salvar as seções sem a chave (tela antiga) não religa nem desliga; valor que não é sim/não é recusado", async () => {
      const chave = async () => (await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).mostrarEspecialidadesTecnico;
      expect((await rota("api/configuracoes/impressao-os", "PUT", CONFIG_RELATORIO_PADRAO)).status).toBe(200);
      expect(await chave()).toBe(false);
      expect((await rota("api/configuracoes/impressao-os", "PUT", { ...CONFIG_RELATORIO_PADRAO, mostrarEspecialidadesTecnico: "sim" })).status).toBe(400);
      expect((await rota("api/configuracoes/impressao-os", "PUT", { ...CONFIG_RELATORIO_PADRAO, mostrarEspecialidadesTecnico: true })).status).toBe(200);
      expect(await chave()).toBe(true);
      // ligada, a tela antiga (sem a chave) também não desliga
      expect((await rota("api/configuracoes/impressao-os", "PUT", CONFIG_RELATORIO_PADRAO)).status).toBe(200);
      expect(await chave()).toBe(true);
    });
  });
});
