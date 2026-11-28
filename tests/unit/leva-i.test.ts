/**
 * Leva I (correções gerais) — as regras puras e as ligações de cada tela:
 *  1. menu flutuante (Colunas, ⋮): abre para baixo se couber, senão para cima; altura máxima = o espaço; nunca sai da tela;
 *  2. a escala de camadas: gaveta < modal < menus < anotações < confirmação < toast; nenhum modal "solto" em z-50;
 *  3. menu lateral: o clique fixa (por usuário); o mouse só expande o recolhido automático, nunca o fechado de propósito;
 *  4. sair sem salvar: quando um link sai da tela; não pergunta logo depois do envio;
 *  5. CEP: ViaCEP, BrasilAPI de reserva, prazo; o endereço aplicado do mesmo jeito em toda tela;
 *  6. a chave da nota copia ao clicar (sem botão "Copiar");
 *  7. /ordens: o período pela data agendada/de execução; "Sem agendamento";
 *  8. veículo: sem "editar no contexto"; o nome abre o cadastro em outra aba.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { posicaoFlutuante } from "@/lib/ui/flutuante";
import { CAMADA, valorCamada, type Camada } from "@/lib/ui/camadas";
import { chaveMenuLateral, estadoMenu, lerPreferenciaMenu, preferenciaDoClique } from "@/lib/layout/menu-lateral";
import { devePerguntar, JANELA_DO_ENVIO_MS, linkSaiDaTela } from "@/lib/ui/sair-sem-salvar";
import { buscarCep, consultarCep, enderecoDoCep, TEMPO_MAX_CEP_MS } from "@/lib/cep";
import { FILTRO_SEM_AGENDAMENTO, whereOrdens, whereSemAgendamento } from "@/lib/listas/filtros";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => fs.readFileSync(path.join(RAIZ, f), "utf8");

describe("1. menu flutuante", () => {
  const janela = { largura: 1440, altura: 900 };
  it("cabe embaixo: abre para baixo, alinhado à direita do botão, com a altura do espaço que sobra", () => {
    expect(posicaoFlutuante({ top: 100, bottom: 130, left: 1200, right: 1300 }, janela, 400)).toEqual({ top: 134, right: 140, maxHeight: 900 - 130 - 8 - 4 });
  });
  it("perto do rodapé (a tabela de 1 veículo): abre para CIMA, rolável, sem ser recortado", () => {
    const p = posicaoFlutuante({ top: 820, bottom: 850, left: 1200, right: 1300 }, janela, 400);
    expect(p).toEqual({ bottom: 900 - 820 + 4, right: 140, maxHeight: 820 - 8 - 4 });
    expect(p.top).toBeUndefined();
  });
  it("tela baixa: o lado com mais espaço, e nunca menos de 120 px; nunca sai pela direita", () => {
    expect(posicaoFlutuante({ top: 200, bottom: 230, left: 0, right: 1500 }, { largura: 1440, altura: 300 }, 400)).toMatchObject({ bottom: 104, right: 8, maxHeight: 188 });
  });
});

describe("2. camadas", () => {
  it("a ordem: gaveta < modal < lightbox < menus < anotações < confirmação < toast", () => {
    const ordem: Camada[] = ["gaveta", "modal", "lightbox", "flutuante", "anotacoesFundo", "anotacoesBotao", "anotacoesCaixa", "confirmacao", "toast"];
    const v = ordem.map(valorCamada);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    expect(new Set(v).size).toBe(v.length);
  });
  it("cada componente compartilhado usa a sua camada", () => {
    expect(ler("components/ui/drawer.tsx")).toContain("CAMADA.gaveta");
    expect(ler("components/ui/modal.tsx")).toContain("CAMADA.modal");
    expect(ler("components/ui/lightbox.tsx")).toContain("CAMADA.lightbox");
    expect(ler("components/ui/dica.tsx")).toContain("CAMADA.flutuante");
    expect(ler("components/ui/menu-acoes.tsx")).toContain("CAMADA.flutuante");
    expect(ler("components/listagem/tabela-pro.tsx")).toContain("CAMADA.flutuante");
    const avisos = ler("components/ui/avisos.tsx");
    expect(avisos).toContain("CAMADA.toast");
    expect(avisos).toContain("CAMADA.confirmacao");
    // o botão de anotações (literal por causa do Tailwind) acima da gaveta e do modal, abaixo da confirmação
    const anot = ler("components/anotacoes/ferramenta.tsx");
    expect(anot).toContain(`"fixed ${CAMADA.anotacoesBotao} hidden lg:inline-flex items-center gap-2`);
    expect(anot).not.toMatch(/z-\[4[5-9]\]/);
  });
  it("nenhum modal \"solto\" em z-50 (ficaria atrás da gaveta) fora do app do técnico e da IA", () => {
    const soltos: string[] = [];
    const varrer = (dir: string) => {
      for (const n of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
        const p = path.join(dir, n.name);
        if (n.isDirectory()) { if (!/components\/tecnico$/.test(p)) varrer(p); continue; }
        if (!p.endsWith(".tsx") || p.endsWith("frivo-ia.tsx")) continue;
        if (/fixed inset-0 z-50\b/.test(fs.readFileSync(path.join(RAIZ, p), "utf8"))) soltos.push(p);
      }
    };
    varrer("components"); varrer("app");
    expect(soltos).toEqual([]);
  });
});

describe("3. menu lateral", () => {
  it("o clique fixa: aberto fica aberto; fechado fica fechado — e o mouse NÃO abre o fechado de propósito", () => {
    expect(estadoMenu({ preferencia: "aberto", largura: 1024, hover: false })).toEqual({ recolhido: false, expandidoPorHover: false });
    expect(estadoMenu({ preferencia: "fechado", largura: 1920, hover: true })).toEqual({ recolhido: true, expandidoPorHover: false });
  });
  it("sem escolha: tela larga abre; notebook recolhe, e o mouse expande por cima (temporário)", () => {
    expect(estadoMenu({ preferencia: null, largura: 1440, hover: false })).toEqual({ recolhido: false, expandidoPorHover: false });
    expect(estadoMenu({ preferencia: null, largura: 1180, hover: false })).toEqual({ recolhido: true, expandidoPorHover: false });
    expect(estadoMenu({ preferencia: null, largura: 1180, hover: true })).toEqual({ recolhido: true, expandidoPorHover: true });
  });
  it("o clique: recolhido (mesmo aberto pelo mouse) fixa aberto; aberto fixa fechado", () => {
    expect(preferenciaDoClique({ recolhido: true, expandidoPorHover: true })).toBe("aberto");
    expect(preferenciaDoClique({ recolhido: true, expandidoPorHover: false })).toBe("aberto");
    expect(preferenciaDoClique({ recolhido: false, expandidoPorHover: false })).toBe("fechado");
  });
  it("lembrado por usuário; a escolha antiga (do navegador) vale até a pessoa escolher de novo", () => {
    expect(chaveMenuLateral("u1")).not.toBe(chaveMenuLateral("u2"));
    expect(lerPreferenciaMenu("fechado")).toBe("fechado");
    expect(lerPreferenciaMenu(null, "1")).toBe("fechado");
    expect(lerPreferenciaMenu(null, "0")).toBe("aberto");
    expect(lerPreferenciaMenu("lixo", null)).toBeNull();
    const s = ler("components/layout/sidebar.tsx");
    expect(s).toContain("localStorage.setItem(chaveMenuLateral(usuario.id), nova)");
    expect(s).toContain("onMouseEnter={variant === \"desktop\" ? () => setHover(true) : undefined}");
  });
});

describe("4. sair sem salvar", () => {
  const base = { alvo: null, download: false, modificador: false, botao: 0, origem: "https://app.test", atual: "https://app.test/clientes/novo" };
  it("só o link interno, na mesma aba, para outro endereço, sai da tela", () => {
    expect(linkSaiDaTela({ ...base, href: "/clientes" })).toBe(true);
    expect(linkSaiDaTela({ ...base, href: "https://app.test/dashboard?x=1" })).toBe(true);
    for (const [k, v] of [["href", "#secao"], ["href", "mailto:a@b.test"], ["href", "https://outro.test/x"], ["href", "/clientes/novo"]] as const) {
      expect(linkSaiDaTela({ ...base, [k]: v }), v).toBe(false);
    }
    expect(linkSaiDaTela({ ...base, href: "/clientes", alvo: "_blank" })).toBe(false);
    expect(linkSaiDaTela({ ...base, href: "/clientes", modificador: true })).toBe(false);
    expect(linkSaiDaTela({ ...base, href: "/x", download: true })).toBe(false);
  });
  it("pergunta só com alterações, e não logo depois do envio (o salvar a caminho)", () => {
    expect(devePerguntar({ sujo: false, enviadoEm: null, agora: 1 })).toBe(false);
    expect(devePerguntar({ sujo: true, enviadoEm: null, agora: 1 })).toBe(true);
    expect(devePerguntar({ sujo: true, enviadoEm: 1000, agora: 1000 + JANELA_DO_ENVIO_MS - 1 })).toBe(false);
    expect(devePerguntar({ sujo: true, enviadoEm: 1000, agora: 1000 + JANELA_DO_ENVIO_MS })).toBe(true);
  });
  it("as telas de edição usam o aviso (páginas de novo/editar, nova OS, perfil, dados da empresa)", () => {
    for (const p of ["app/(dashboard)/clientes/novo/page.tsx", "app/(dashboard)/clientes/[id]/editar/page.tsx", "app/(dashboard)/orcamentos/novo/page.tsx",
      "app/(dashboard)/veiculos/[id]/editar/page.tsx", "app/(dashboard)/financeiro/medicoes/nova/page.tsx", "app/(dashboard)/colaboradores/novo/page.tsx"]) {
      expect(ler(p), p).toContain("<ProtegerSaida>");
    }
    expect(ler("app/(dashboard)/ordens/nova/page.tsx")).toContain("useAvisoSairSemSalvar(raizRef)");
    expect(ler("components/perfil/perfil-client.tsx")).toContain("useAvisoSairSemSalvar(raizRef)");
    expect(ler("components/forms/configuracoes-client.tsx")).toContain("marcarFormularioSalvo()");
  });
});

describe("5. CEP global", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const viacep = { cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP", complemento: "" };
  const brasilapi = { cep: "01310100", street: "Avenida Paulista", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

  it("ViaCEP responde: o endereço", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(viacep)));
    expect(await consultarCep("01310-100")).toEqual({ ok: true, endereco: { logradouro: "Avenida Paulista", bairro: "Bela Vista", cidade: "São Paulo", estado: "SP", complemento: "" } });
  });
  it("ViaCEP fora do ar: a BrasilAPI de reserva", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { urls.push(u); if (u.includes("viacep")) throw new Error("rede"); return resposta(brasilapi); }));
    expect(await consultarCep("01310100")).toMatchObject({ ok: true, endereco: { logradouro: "Avenida Paulista", cidade: "São Paulo", estado: "SP" } });
    expect(urls.map((u) => new URL(u).host)).toEqual(["viacep.com.br", "brasilapi.com.br"]);
  });
  it("CEP que não existe × consulta fora do ar: a tela diz o certo; CEP incompleto nem consulta", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.includes("viacep") ? resposta({ erro: true }) : resposta({ message: "não encontrado" }, 404))));
    expect(await consultarCep("99999999")).toEqual({ ok: false, motivo: "nao-encontrado" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede"); }));
    expect(await consultarCep("01310100")).toEqual({ ok: false, motivo: "indisponivel" });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await consultarCep("0131")).toEqual({ ok: false, motivo: "invalido" });
    expect(f).not.toHaveBeenCalled();
  });
  it("não trava: a consulta que não responde é abandonada no prazo e a reserva é tentada", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((u: string, init?: RequestInit) => (u.includes("viacep")
      ? new Promise((_, falha) => init?.signal?.addEventListener("abort", () => falha(new Error("abortado"))))
      : Promise.resolve(resposta(brasilapi)))));
    const p = consultarCep("01310100");
    await vi.advanceTimersByTimeAsync(TEMPO_MAX_CEP_MS + 10);
    expect(await p).toMatchObject({ ok: true });
  });
  it("o endereço aplicado: logradouro, bairro, cidade e UF da consulta; o que ela não traz fica; número e complemento são da pessoa", () => {
    const atual = { endereco: "Rua Velha", bairro: "Centro", cidade: "Campinas", estado: "SP", numero: "10" };
    expect(enderecoDoCep(atual, { logradouro: "Av. Nova", bairro: "", cidade: "Santos", estado: "SP", complemento: "" }, { logradouro: "endereco", bairro: "bairro", cidade: "cidade", estado: "estado" }))
      .toEqual({ endereco: "Av. Nova", bairro: "Centro", cidade: "Santos", estado: "SP" });
  });
  it("os formulários com CEP usam o mesmo campo (sem a lupa de antes)", () => {
    for (const f of ["components/forms/unidades-manager.tsx", "components/forms/unidades-local.tsx", "components/forms/colaborador-form.tsx", "components/forms/configuracoes-client.tsx", "components/admissao/campos-admissao.tsx"]) {
      const s = ler(f);
      expect(s, f).toContain("<CampoCep");
      expect(s, f).not.toContain("clique na lupa");
    }
    expect(ler("components/ui/select-cadastro-rapido.tsx")).toContain("consultarCep(cepBruto)");
    expect(ler("components/cadastro-rapido/definicoes.ts")).not.toMatch(/nome: "cep", label: "CEP", placeholder/);
  });
  it("um jeito só de buscar CEP: a consulta mora só em lib/cep; o buscarCep de sempre (admissão, ficha do colaborador) passa pela mesma consulta, com a reserva e o prazo", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const arquivos = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? arquivos(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
    // lib/nfse/municipio consulta o código IBGE do município (outro dado, para a NFS-e), não o endereço
    const fora = ["app", "components", "lib"].flatMap((d) => arquivos(d)).filter((f) => f !== path.join("lib", "cep.ts") && f !== path.join("lib", "nfse", "municipio.ts"))
      .filter((f) => /viacep\.com\.br|brasilapi\.com\.br\/api\/cep/.test(fs.readFileSync(f, "utf8")));
    expect(fora).toEqual([]);
    expect(ler("components/ui/campo-cep.tsx")).toContain('from "@/lib/cep"');
    // a assinatura de sempre: endereço ou null; com o ViaCEP fora, vem da reserva
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { if (u.includes("viacep")) throw new Error("rede"); return resposta(brasilapi); }));
    expect(await buscarCep("01310-100")).toMatchObject({ logradouro: expect.any(String), cidade: expect.any(String) });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede"); }));
    expect(await buscarCep("01310-100")).toBeNull();
  });
});

describe("6. a chave da nota copia ao clicar", () => {
  it("lista, gaveta e página da nota: a chave é o botão; sem o \"Copiar\" à parte", () => {
    for (const f of ["components/compras/notas-lista.tsx", "components/compras/gaveta-nota.tsx", "app/(dashboard)/estoque/notas/[id]/page.tsx"]) {
      const s = ler(f);
      expect(s, f).toContain("<ChaveCopiavel");
      expect(s, f).not.toMatch(/CopiarCodigo texto=\{[a-z.]*chave/i);
    }
  });
});

describe("7. /ordens: o período pela data agendada / de execução", () => {
  const agora = new Date("2026-11-15T15:00:00Z");
  it("o mês olha a atividade agendada, iniciada ou concluída e a previsão — não a abertura", () => {
    const w = JSON.stringify(whereOrdens("e1", { mes: "2026-11" }, agora));
    expect(w).toContain("dataAgendada");
    expect(w).toContain("iniciadaEm");
    expect(w).toContain("concluidaEm");
    expect(w).toContain("previsaoConclusao");
    expect(w).not.toContain("criadoEm");
    expect(w).not.toContain("prazoExecucao");
  });
  it("\"Sem agendamento\": as OS sem data nenhuma, sem o período (ele não as alcança)", () => {
    const w = whereOrdens("e1", { agenda: FILTRO_SEM_AGENDAMENTO, mes: "2026-11" }, agora);
    expect(JSON.stringify(w)).toContain(JSON.stringify(whereSemAgendamento()));
    // o período não entra (nenhum intervalo de datas no filtro)
    expect(JSON.stringify(w)).not.toMatch(/"gte"|"lt"/);
  });
});

describe("8. veículo: sem \"editar no contexto\"", () => {
  it("responsável e equipe: o nome vira link para o cadastro, em outra aba", () => {
    const s = ler("components/forms/veiculo-form.tsx");
    expect(s).not.toContain("edicao={");
    expect(s).toContain('<LinkDoCadastro href={`/colaboradores/${form.responsavelId}/editar`}');
    expect(s).toContain('<LinkDoCadastro href={`/equipes/${form.equipeId}/editar`}');
    expect(s).toContain('target="_blank" rel="noopener"');
  });
});
