/**
 * Loja de Módulos — leva EQUIPAMENTOS + QR CODES, com o Prisma real num PostgreSQL real e as
 * rotas de verdade:
 *  - o gate nas rotas dos dois módulos (403 com o módulo, nem o administrador master passa) e a
 *    empresa vizinha seguindo normal;
 *  - a CASCATA QR Codes ↔ Equipamentos pela tela: desligar Equipamentos arrasta QR Codes na mesma
 *    transação (com aviso antes), ligar QR Codes sem Equipamentos é recusado dizendo o que falta;
 *  - a dependência PMOC → Equipamentos: registrada no catálogo, mas o PMOC (sem gate) não é
 *    arrastado nem anunciado — e nenhuma linha dele é gravada;
 *  - a DEGRADAÇÃO GRACIOSA onde o núcleo encosta: a lista de equipamentos devolve VAZIO (não 403),
 *    concluir a atividade da OS não trava por falta de equipamento, e o cadastro em campo recusa
 *    com o motivo em vez de estourar;
 *  - desligar NUNCA apaga: equipamentos, vínculos e QRs gerados ficam, e religar devolve tudo;
 *  - o sino (núcleo) responde igual: não há contagem de Equipamentos nem de QR Codes para calar.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/modulos-equip-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_mod_equip_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O sino agenda trabalho para DEPOIS de responder (`after`), que só existe dentro do ciclo de um
// pedido de verdade. Fora dele, o resto da rota é o mesmo — e é o que este teste olha.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));
const logar = (o: { id?: string; empresaId?: string; role?: string; permissoes?: Permissoes } = {}) => {
  const id = o.id ?? "uAdmin";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId: o.empresaId ?? "e1", role: o.role ?? "ADMIN", permissoes: o.permissoes ?? permissoesTotais(), tecnicoId: null } };
};

vi.setConfig({ testTimeout: 90_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${busca}`, {
    method: metodo, headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await (mod as any)[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Loja de Módulos — Equipamentos + QR Codes (PostgreSQL real)", () => {
  let prisma: any;
  let mod: typeof import("@/lib/modulos/servidor");
  let dados: typeof import("@/lib/execucao/dados");
  let campo: typeof import("@/lib/execucao/cadastro-campo");
  let massa: typeof import("@/lib/acoes-massa/regras");
  let seq = 0;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    mod = await import("@/lib/modulos/servidor");
    dados = await import("@/lib/execucao/dados");
    campo = await import("@/lib/execucao/cadastro-campo");
    massa = await import("@/lib/acoes-massa/regras");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uAdmin", empresaId: "e1", nome: "Gabi Gestora", email: "g@x.com", senha: "x", role: "ADMIN" },
      { id: "uOp", empresaId: "e1", nome: "Caio Operador", email: "c@x.com", senha: "x", role: "OPERADOR" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" } });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Bloco A", principal: true } });
    await prisma.equipamento.create({ data: {
      id: "eq1", empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Carrier", modelo: "42XQ", numeroSerie: "SN-001", setor: "UTI",
    } });
    logar();
  }, 180_000);

  afterEach(async () => {
    logar();
    await prisma.empresaModulo.deleteMany({});
    mod.esquecerModulos();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const desligar = (modulo: string) => mod.definirModulo("e1", modulo, false, "uAdmin");
  const ligar = (modulo: string) => mod.definirModulo("e1", modulo, true, "uAdmin");

  /** OS + atividade de verdade, para olhar a conclusão e o vínculo. */
  async function criarOs(o: { comVinculo?: boolean } = {}) {
    const n = ++seq;
    const os = await prisma.ordemServico.create({ data: {
      id: `os${n}`, empresaId: "e1", numero: `OS-${1000 + n}`, clienteId: "c1", unidadeId: "u1",
      criadoPorId: "uAdmin", descricao: "Manutenção preventiva", status: "EM_ANDAMENTO",
    } });
    const atv = await prisma.atividadeOs.create({ data: {
      id: `atv${n}`, empresaId: "e1", ordemServicoId: os.id, titulo: "Visita", status: "EM_ANDAMENTO",
    } });
    if (o.comVinculo) await prisma.atividadeEquipamento.create({ data: { atividadeId: atv.id, equipamentoId: "eq1", feito: true, feitoEm: new Date() } });
    return { osId: os.id, atividadeId: atv.id };
  }

  const equipamentoNovo = (id: string) => ({
    unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Springer", modelo: "Midea", numeroSerie: id,
  });

  /* ═════════ o gate nas rotas dos dois módulos ═════════ */

  describe("A API de Equipamentos recusa o módulo desligado", () => {
    it("ligado: criar equipamento responde 201", async () => {
      const r = await chamar("equipamentos", "POST", equipamentoNovo("SN-ON"));
      expect(r.status).toBe(201);
    });

    it("desligado: criar é 403 com o módulo e a mensagem que a tela precisa", async () => {
      await desligar("equipamentos");
      const r = await chamar("equipamentos", "POST", equipamentoNovo("SN-OFF"));
      expect(r.status).toBe(403);
      expect(r.json.modulo).toBe("equipamentos");
      expect(r.json.erro).toContain("Equipamentos");
      expect(r.json.erro).toContain("Configurações");
    });

    it("desligado: a LEITURA devolve lista vazia, não 403 (a OS e o orçamento chamam esta rota)", async () => {
      const antes = await chamar("equipamentos", "GET");
      expect(antes.status).toBe(200);
      expect(antes.json.length).toBeGreaterThan(0);

      await desligar("equipamentos");
      const depois = await chamar("equipamentos", "GET");
      expect(depois.status).toBe(200);
      expect(depois.json).toEqual([]);
    });

    it("a empresa vizinha não sente nada", async () => {
      await desligar("equipamentos");
      logar({ id: "uB", empresaId: "e2" });
      expect((await chamar("equipamentos", "POST", { ...equipamentoNovo("SN-E2"), unidadeId: "u1" })).status).not.toBe(403);
    });

    it("sem permissão continua 403 de PERMISSÃO (o RBAC é a primeira porta)", async () => {
      logar({ id: "uOp", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }) });
      const r = await chamar("equipamentos", "POST", equipamentoNovo("SN-SEM"));
      expect(r.status).toBe(403);
      expect(r.json.modulo).toBeUndefined();
    });
  });

  describe("A API de QR Codes recusa o módulo desligado", () => {
    it("ligado: gerar lote de QR responde 201", async () => {
      const r = await chamar("qrcodes", "POST", { quantidade: 2 });
      expect(r.status).toBe(201);
      expect(r.json).toHaveLength(2);
    });

    it("desligado: gerar lote é 403 com o módulo", async () => {
      await desligar("qrcodes");
      const r = await chamar("qrcodes", "POST", { quantidade: 1 });
      expect(r).toMatchObject({ status: 403, json: { modulo: "qrcodes" } });
    });

    it("gerar o QR DA FICHA do equipamento também cai — a rota confere Equipamentos, o que ela cria é QR", async () => {
      // com os dois ligados, funciona
      const ok = await chamar("equipamentos/[id]/qrcode", "POST", {}, { id: "eq1" });
      expect(ok.status).toBe(201);
      await prisma.qrcode.deleteMany({ where: { equipamentoId: "eq1" } });

      // só o QR Codes desligado (Equipamentos segue ligado): recusa dizendo QR Codes
      await desligar("qrcodes");
      const r = await chamar("equipamentos/[id]/qrcode", "POST", {}, { id: "eq1" });
      expect(r).toMatchObject({ status: 403, json: { modulo: "qrcodes" } });
    });

    it("a ação em massa 'Gerar QR' recusa o item com o motivo, em vez de gerar etiqueta de módulo desligado", async () => {
      await desligar("qrcodes");
      const ctx = { empresaId: "e1", usuarioId: "uAdmin", usuarioNome: "Gabi" };
      const r = await massa.gerarQrEquipamento("eq1", ctx as any);
      expect(r.ok).toBe(false);
      expect((r as any).motivo).toContain("QR Codes");
      expect(await prisma.qrcode.count({ where: { equipamentoId: "eq1" } })).toBe(0);
    });
  });

  /* ═════════ a cascata, pela tela ═════════ */

  describe("Cascata QR Codes ↔ Equipamentos pela tela de Configurações", () => {
    const ver = () => chamar("configuracoes/modulos", "GET");
    const definir = (modulo: string, ativo: boolean) => chamar("configuracoes/modulos", "PUT", { modulo, ativo });
    const previa = (modulo: string, ativo: boolean) => chamar("configuracoes/modulos", "POST", { modulo, ativo });

    it("a tela passa a oferecer os cinco, na ordem do catálogo", async () => {
      const r = await ver();
      expect(r.status).toBe(200);
      expect(r.json.modulos.map((m: any) => m.id)).toEqual(["veiculos", "compras", "equipamentos", "qrcodes", "estoque"]);
      expect(r.json.modulos.every((m: any) => m.ativo)).toBe(true);
    });

    it("a prévia avisa, ANTES de desligar, que QR Codes cai junto — e não fala do PMOC", async () => {
      const p = await previa("equipamentos", false);
      expect(p.json.arrastados).toEqual(["qrcodes"]);
      expect(p.json.aviso).toContain("QR Codes depende deste módulo");
      expect(p.json.aviso).toContain("Nada é apagado");
      expect(p.json.aviso).not.toContain("PMOC");
      // e nada foi desligado só por perguntar
      expect(await prisma.empresaModulo.count()).toBe(0);
    });

    it("desligar Equipamentos arrasta QR Codes — as duas linhas, com auditoria, e nenhuma do PMOC", async () => {
      const r = await definir("equipamentos", false);
      expect(r.status).toBe(200);
      expect(r.json.arrastados).toEqual(["qrcodes"]);
      const estado = Object.fromEntries(r.json.modulos.map((m: any) => [m.id, m.ativo]));
      expect(estado).toMatchObject({ equipamentos: false, qrcodes: false, estoque: true, veiculos: true });
      const linhas = await prisma.empresaModulo.findMany({ orderBy: { modulo: "asc" }, select: { modulo: true, ativo: true, alteradoPorId: true } });
      expect(linhas).toMatchObject([
        { modulo: "equipamentos", ativo: false, alteradoPorId: "uAdmin" },
        { modulo: "qrcodes", ativo: false, alteradoPorId: "uAdmin" },
      ]);
      // o PMOC depende de Equipamentos no catálogo, mas não tem gate: nada foi gravado para ele
      expect(linhas.map((l: any) => l.modulo)).not.toContain("pmoc");
    });

    it("ligar QR Codes com Equipamentos desligado é recusado (409) dizendo o que falta", async () => {
      await definir("equipamentos", false);
      const r = await definir("qrcodes", true);
      expect(r.status).toBe(409);
      expect(r.json.erro).toContain("Equipamentos");
      // continua desligado: recusa não liga pela metade
      expect(await prisma.empresaModulo.findUnique({ where: { empresaId_modulo: { empresaId: "e1", modulo: "qrcodes" } } })).toMatchObject({ ativo: false });
    });

    it("na ordem certa os dois voltam: Equipamentos primeiro, QR Codes depois", async () => {
      await definir("equipamentos", false);
      expect((await definir("equipamentos", true)).status).toBe(200);
      const r = await definir("qrcodes", true);
      expect(r.status).toBe(200);
      const estado = Object.fromEntries(r.json.modulos.map((m: any) => [m.id, m.ativo]));
      expect(estado).toMatchObject({ equipamentos: true, qrcodes: true });
    });

    it("desligar só o QR Codes não mexe em Equipamentos (a dependência é de mão única)", async () => {
      const r = await definir("qrcodes", false);
      expect(r.json.arrastados).toEqual([]);
      const estado = Object.fromEntries(r.json.modulos.map((m: any) => [m.id, m.ativo]));
      expect(estado).toMatchObject({ equipamentos: true, qrcodes: false });
    });
  });

  /* ═════════ degradação graciosa onde o núcleo encosta ═════════ */

  describe("O núcleo não quebra por causa do módulo desligado", () => {
    it("vincular equipamento NOVO à atividade é recusado com o motivo (403), não estoura", async () => {
      const { osId, atividadeId } = await criarOs();
      await desligar("equipamentos");
      const r = await chamar("ordens/[id]/atividades/[atividadeId]/equipamentos", "POST", { equipamentoIds: ["eq1"] }, { id: osId, atividadeId });
      expect(r.status).toBe(403);
      expect(r.json.erro).toContain("Equipamentos");
      expect(await prisma.atividadeEquipamento.count({ where: { atividadeId } })).toBe(0);
    });

    it("o equipamento JÁ vinculado continua aparecendo na OS antiga (razão é razão)", async () => {
      const { osId, atividadeId } = await criarOs({ comVinculo: true });
      await desligar("equipamentos");
      const r = await chamar("ordens/[id]/atividades/[atividadeId]/equipamentos", "GET", undefined, { id: osId, atividadeId });
      expect(r.status).toBe(200);
      expect(r.json).toHaveLength(1);
      expect(r.json[0].equipamento.id).toBe("eq1");
    });

    it("CONCLUIR a atividade não trava por falta de equipamento: a saída MODULO entra no lugar", async () => {
      const { osId, atividadeId } = await criarOs();
      const atividade = { tipoOs: null };
      const os = { origem: "MANUAL", semEquipamentoMotivo: null };

      // com o módulo ligado, a trava vale (é a regra de sempre)
      expect(await dados.dispensaDaAtividade("e1", osId, atividade, os)).toBeNull();
      const antes = await dados.carregarExecucao("e1", osId, atividadeId);
      expect(antes!.conclusao.ok).toBe(false);
      expect(antes!.conclusao.semEquipamento).toBe(true);

      // desligado, a atividade conclui sem equipamento — e a tela diz por quê
      await desligar("equipamentos");
      const dispensa = await dados.dispensaDaAtividade("e1", osId, atividade, os);
      expect(dispensa).toMatchObject({ motivo: "MODULO" });
      expect(dispensa!.texto).toContain("Equipamentos");
      const depois = await dados.carregarExecucao("e1", osId, atividadeId);
      expect(depois!.conclusao.ok).toBe(true);
      expect(depois!.conclusao.semEquipamento).toBe(false);
      expect(depois!.conclusao.dispensa!.motivo).toBe("MODULO");
    });

    it("a saída MODULO vem ANTES das outras, mas não apaga a exigência de quem está atendido", async () => {
      // com um equipamento atendido e o checklist por responder, a trava do checklist continua
      const { osId, atividadeId } = await criarOs({ comVinculo: true });
      await prisma.tipoEquipamentoCustom.create({ data: { id: "tp1", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
      await prisma.equipamento.update({ where: { id: "eq1" }, data: { tipoEquipamentoId: "tp1" } });
      await prisma.checklistTipoItem.create({ data: { id: "it1", empresaId: "e1", tipoEquipamentoId: "tp1", texto: "Medir pressão", ordem: 1 } });
      await desligar("equipamentos");
      const exec = await dados.carregarExecucao("e1", osId, atividadeId);
      expect(exec!.conclusao.ok).toBe(false);
      expect(exec!.conclusao.pendencias).toHaveLength(1);
      // limpa o que esta prova criou (as outras olham o equipamento sem tipo)
      await prisma.checklistTipoItem.deleteMany({});
      await prisma.equipamento.update({ where: { id: "eq1" }, data: { tipoEquipamentoId: null } });
      await prisma.tipoEquipamentoCustom.deleteMany({});
    });

    it("o app do técnico nem oferece o cadastro em campo com Equipamentos desligado", async () => {
      const os = { clienteId: "c1", unidadeId: "u1" };
      expect(await campo.cadastroParaRetrato("e1", true, os, [])).not.toBeNull();
      await desligar("equipamentos");
      expect(await campo.cadastroParaRetrato("e1", true, os, [])).toBeNull();
    });

    it("o sino responde igual: não há contagem de Equipamentos nem de QR Codes para calar", async () => {
      const antes = await chamar("alertas", "GET");
      expect(antes.status).toBe(200);
      await desligar("equipamentos");
      const depois = await chamar("alertas", "GET");
      expect(depois.status).toBe(200);
      expect(depois.json).toEqual(antes.json);
    });
  });

  /* ═════════ desligar nunca apaga ═════════ */

  describe("Desligar nunca apaga — religar devolve tudo", () => {
    it("equipamento, vínculo e QR gerado ficam no banco, e voltam à tela ao religar", async () => {
      const { atividadeId } = await criarOs({ comVinculo: true });
      await chamar("equipamentos/[id]/qrcode", "POST", {}, { id: "eq1" });
      const qrAntes = await prisma.qrcode.findFirst({ where: { equipamentoId: "eq1" }, select: { codigo: true } });
      expect(qrAntes).not.toBeNull();

      await desligar("equipamentos"); // arrasta QR Codes
      expect(await prisma.equipamento.count({ where: { empresaId: "e1" } })).toBeGreaterThan(0);
      expect(await prisma.atividadeEquipamento.count({ where: { atividadeId } })).toBe(1);
      expect(await prisma.qrcode.findFirst({ where: { equipamentoId: "eq1" }, select: { codigo: true } })).toMatchObject(qrAntes);

      await ligar("equipamentos");
      await ligar("qrcodes");
      const r = await chamar("equipamentos", "GET");
      expect(r.status).toBe(200);
      expect(r.json.some((e: any) => e.id === "eq1")).toBe(true);
      await prisma.qrcode.deleteMany({ where: { empresaId: "e1" } });
    });

    it("religar não cria linha nova: a mesma linha troca para ativo, com quem mexeu e quando", async () => {
      await desligar("equipamentos");
      await ligar("equipamentos");
      const linhas = await prisma.empresaModulo.findMany({ where: { modulo: "equipamentos" } });
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ ativo: true, alteradoPorId: "uAdmin" });
      expect(linhas[0].alteradoEm).toBeInstanceOf(Date);
    });
  });
});
