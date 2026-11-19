// @vitest-environment happy-dom
/**
 * ANOTAÇÕES INTERNAS — as regras que sustentam a ferramenta, sem banco e sem rede:
 *  - a TRAVA DO DONO: só SUPER_ADMIN abre; ADMIN (que é o administrador do CLIENTE) não;
 *  - a CHAVE DA TELA: ids viram ":id" (a lista agrupa por tela, não por registro) e a aba/gaveta
 *    entra na identidade, porque "OS › Materiais" e "OS › Atividades" são telas diferentes;
 *  - a ANCORAGEM em quatro camadas e, principalmente, o REENCONTRO com as três precisões —
 *    é o que faz a anotação NUNCA virar órfã quando a tela muda;
 *  - o EXPORTAR em Markdown (e a decisão de o print não ir no texto).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ehDonoDoFrivo, PAPEL_DONO } from "@/lib/anotacoes/dono";
import {
  ANCORA_VAZIA, PARAMS_DA_TELA, ROTULO_STATUS, STATUS_ANOTACAO, ehSegmentoDeId, ehStatusAnotacao,
  exportarMarkdown, resolveStatus, telaDaRota, type Ancora,
} from "@/lib/anotacoes/regras";
import { ancorarElemento, chaveDoElemento, pontoDoPin, reencontrar, seletorDaChave } from "@/lib/anotacoes/ancora";

const montar = (html: string) => {
  document.body.innerHTML = html;
  return document;
};

/* ═════════ a trava do dono ═════════ */

describe("Só o dono do Frivo abre a ferramenta", () => {
  it("SUPER_ADMIN abre; ADMIN, GERENTE, OPERADOR e TECNICO não", () => {
    expect(ehDonoDoFrivo({ role: "SUPER_ADMIN" })).toBe(true);
    // ADMIN é o administrador do CLIENTE: se ele abrisse, todo cliente do Frivo teria a ferramenta
    for (const role of ["ADMIN", "GERENTE", "OPERADOR", "TECNICO"]) {
      expect(ehDonoDoFrivo({ role }), role).toBe(false);
    }
  });

  it("entrada torta nunca vira acesso: sem sessão, sem papel, papel vazio", () => {
    expect(ehDonoDoFrivo(null)).toBe(false);
    expect(ehDonoDoFrivo(undefined)).toBe(false);
    expect(ehDonoDoFrivo({})).toBe(false);
    expect(ehDonoDoFrivo({ role: null })).toBe(false);
    expect(ehDonoDoFrivo({ role: "" })).toBe(false);
    expect(ehDonoDoFrivo({ role: "super_admin" })).toBe(false); // nem variação de caixa
  });

  it("o papel está num lugar só (quem quiser trocar a chave mexe em um arquivo)", () => {
    expect(PAPEL_DONO).toBe("SUPER_ADMIN");
  });
});

describe("As TRÊS CAMADAS da trava estão no lugar (trava de origem)", () => {
  const ler = (arq: string) => readFileSync(path.join(path.resolve(__dirname, "../.."), arq), "utf8");

  it("1ª camada — o layout do painel só monta a ferramenta para o dono", () => {
    const layout = ler("app/(dashboard)/layout.tsx");
    expect(layout).toContain("ehDonoDoFrivo(session.user) && <AnotacoesCarregador");
  });

  it("2ª camada — a casca carrega o peso sob demanda, sem SSR (o chunk não vai para o cliente)", () => {
    // sem os comentários: o cabeçalho do arquivo CITA "ssr: false" ao explicar a trava, e uma
    // asserção no texto cru passaria mesmo com a opção removida do código (foi o que a mutação pegou)
    const casca = ler("components/anotacoes/carregador.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(casca).toMatch(/dynamic\(\(\) => import\("@\/components\/anotacoes\/ferramenta"\)/);
    expect(casca).toContain("ssr: false");
    // e a ferramenta NÃO pode ser importada de forma estática em lugar nenhum da casca
    expect(casca).not.toMatch(/^import \{[^}]*AnotacoesFerramenta/m);
  });

  it("3ª camada — a API e a página se guardam no servidor", () => {
    const guarda = ler("lib/anotacoes/guarda.ts");
    expect(guarda).toContain("ehDonoDoFrivo(session.user)");
    expect(guarda).toContain("403");
    for (const rota of ["app/api/anotacoes/route.ts", "app/api/anotacoes/[id]/route.ts", "app/api/anotacoes/[id]/print/route.ts"]) {
      expect(ler(rota), rota).toContain("guardaDoDono()");
    }
    const pagina = ler("app/(dashboard)/anotacoes/page.tsx");
    expect(pagina).toContain("ehDonoDoFrivo(session.user)");
    expect(pagina).toContain('redirect("/sem-permissao")');
  });

  it("a captura de imagem fica atrás de import() — nem o dono paga por ela antes de anotar", () => {
    const ferramenta = ler("components/anotacoes/ferramenta.tsx");
    expect(ferramenta).toContain('await import("@/lib/anotacoes/print-cliente")');
    expect(ferramenta).not.toMatch(/^import .*print-cliente/m);
    // e a biblioteca de captura só é citada no arquivo que o import() alcança
    expect(ferramenta).not.toContain("modern-screenshot");
    expect(ler("lib/anotacoes/print-cliente.ts")).toContain("modern-screenshot");
  });

  it("a página das anotações NÃO entra no menu nem nos cartões de Configurações", () => {
    expect(ler("components/layout/sidebar.tsx")).not.toContain("/anotacoes");
    expect(ler("lib/navegacao/configuracoes.ts")).not.toContain("anotacoes");
  });
});

/* ═════════ a chave da tela ═════════ */

describe("A chave da TELA agrupa por tela, não por registro", () => {
  it("segmento que é id vira ':id' — cuid, uuid, número e token comprido", () => {
    expect(ehSegmentoDeId("cmwbwrppt00037dmturdlfhp7")).toBe(true);
    expect(ehSegmentoDeId("3f1c7e2a-9b1d-4c7e-8a2b-7c9d1e3f5a7b")).toBe(true);
    expect(ehSegmentoDeId("4521")).toBe(true);
    expect(ehSegmentoDeId("ordens")).toBe(false);
    expect(ehSegmentoDeId("notas-fiscais")).toBe(false);
    expect(ehSegmentoDeId("")).toBe(false);
    // o que protege as rotas de verdade: segmento comprido SEM dígito nunca é tomado por id
    expect(ehSegmentoDeId("documentacao-equipe")).toBe(false);
    expect(ehSegmentoDeId("checklists-veiculo")).toBe(false);
  });

  it("duas OS diferentes caem na MESMA tela", () => {
    expect(telaDaRota("/ordens/cmwbwrppt00037dmturdlfhp7")).toBe("/ordens/:id");
    expect(telaDaRota("/ordens/cmzzzzzzz00037dmturdlfhp7")).toBe("/ordens/:id");
    expect(telaDaRota("/equipamentos/4521/editar")).toBe("/equipamentos/:id/editar");
  });

  it("a aba e a gaveta ENTRAM na identidade; os filtros ficam fora", () => {
    expect(telaDaRota("/ordens/cmwbwrppt00037dmturdlfhp7", "aba=materiais")).toBe("/ordens/:id?aba=materiais");
    expect(telaDaRota("/ordens/clw9x2k7q0001abcd4fgh", "aba=atividades")).toBe("/ordens/:id?aba=atividades");
    expect(telaDaRota("/configuracoes", "aba=conta&secao=modulos")).toBe("/configuracoes?aba=conta&secao=modulos");
    // busca, página e ordem não mudam a TELA, só o conteúdo dela
    expect(telaDaRota("/equipamentos", "q=split&pagina=3&ordem=nome")).toBe("/equipamentos");
    expect(PARAMS_DA_TELA).toEqual(["aba", "secao"]);
  });

  it("não quebra com entrada torta (raiz, barra sobrando, query junto do caminho)", () => {
    expect(telaDaRota("/")).toBe("/");
    expect(telaDaRota("/clientes/")).toBe("/clientes");
    expect(telaDaRota("/clientes?x=1")).toBe("/clientes");
  });
});

/* ═════════ a ancoragem ═════════ */

describe("A âncora sai do marco semântico mais próximo do clique", () => {
  it("o data-* com valor curto vira atributo+valor; o valor que é id de registro vira só o nome", () => {
    const doc = montar(`
      <div data-secao="materiais"></div>
      <div data-equipamento-vinculado="cmwbwrppt00037dmturdlfhp7"></div>
      <div data-os-separacao></div>
      <div id="conteudo-scroll"></div>
      <div class="sem-marco"></div>
    `);
    expect(chaveDoElemento(doc.querySelector("[data-secao]")!)).toBe("data-secao=materiais");
    // o id de hoje é outro amanhã: o atributo em si continua dizendo o que aquilo é
    expect(chaveDoElemento(doc.querySelector("[data-equipamento-vinculado]")!)).toBe("data-equipamento-vinculado");
    expect(chaveDoElemento(doc.querySelector("[data-os-separacao]")!)).toBe("data-os-separacao");
    expect(chaveDoElemento(doc.querySelector("#conteudo-scroll")!)).toBe("#conteudo-scroll");
    expect(chaveDoElemento(doc.querySelector(".sem-marco")!)).toBeNull();
  });

  it("estado de UI do framework não é marco (data-state, data-side…)", () => {
    const doc = montar(`<div data-state="open" data-side="bottom"></div>`);
    expect(chaveDoElemento(doc.querySelector("[data-state]")!)).toBeNull();
  });

  it("o seletor escapa o valor e nunca usa classe do Tailwind", () => {
    expect(seletorDaChave("data-secao=materiais")).toBe('[data-secao="materiais"]');
    expect(seletorDaChave("data-os-separacao")).toBe("[data-os-separacao]");
    expect(seletorDaChave("#conteudo-scroll")).toBe('[id="conteudo-scroll"]');
  });

  it("sobe do elemento clicado até o marco, guarda o caminho relativo e a identidade", () => {
    const doc = montar(`
      <section data-secao="materiais">
        <ul><li><span>Gás R410A</span></li><li><button type="button" aria-label="Separar">Separar</button></li></ul>
      </section>
    `);
    const botao = doc.querySelector("button")!;
    const a = ancorarElemento(botao, 10, 20);
    expect(a.ancora).toBe("data-secao=materiais");
    expect(a.ancoraIndice).toBe(0);
    expect(a.caminho).toBe("ul>li:nth-of-type(2)>button");
    expect(a.rotulo).toBe("Separar");
    expect(a.papel).toContain("button");
    expect(a.papel).toContain("aria=Separar");
  });

  it("o índice desempata os irmãos de mesma chave (data-cartao aparece muitas vezes)", () => {
    const doc = montar(`
      <div data-cartao="x"><span>Primeiro</span></div>
      <div data-cartao="x"><span>Segundo</span></div>
      <div data-cartao="x"><span>Terceiro</span></div>
    `);
    const terceiro = doc.querySelectorAll("[data-cartao] span")[2];
    const a = ancorarElemento(terceiro, 0, 0);
    expect(a.ancora).toBe("data-cartao=x");
    expect(a.ancoraIndice).toBe(2);
  });

  it("elemento sem marco nenhum por cima ainda guarda a identidade (não devolve nada vazio)", () => {
    const doc = montar(`<div><p>Texto solto</p></div>`);
    const a = ancorarElemento(doc.querySelector("p")!, 5, 5);
    expect(a.ancora).toBeNull();
    expect(a.rotulo).toBe("Texto solto");
    expect(a.papel).toBe("p");
  });

  it("texto comprido é cortado (a identidade é uma pista, não o conteúdo)", () => {
    const longo = "a".repeat(200);
    const doc = montar(`<div><p>${longo}</p></div>`);
    const a = ancorarElemento(doc.querySelector("p")!, 0, 0);
    expect(a.rotulo!.length).toBeLessThanOrEqual(80);
    expect(a.rotulo!.endsWith("…")).toBe(true);
  });
});

/* ═════════ o reencontro: as três precisões ═════════ */

describe("O REENCONTRO: a anotação muda de estado, nunca desaparece", () => {
  const guardada = (over: Partial<Ancora> = {}): Ancora => ({
    ...ANCORA_VAZIA,
    ancora: "data-secao=materiais",
    ancoraIndice: 0,
    caminho: "ul>li:nth-of-type(2)>button",
    rotulo: "Separar",
    papel: "button",
    fx: 0.5, fy: 0.5,
    ...over,
  });

  const telaIgual = `
    <section data-secao="materiais">
      <ul><li><span>Gás</span></li><li><button type="button">Separar</button></li></ul>
    </section>`;

  it("EXATA: a tela é a mesma — acha a âncora, o índice e refina pelo caminho", () => {
    const doc = montar(telaIgual);
    const r = reencontrar(doc, guardada());
    expect(r.precisao).toBe("exata");
    expect(r.elemento!.tagName.toLowerCase()).toBe("button");
  });

  it("EXATA mesmo com o LAYOUT redesenhado por dentro (o caminho não bate, a âncora sim)", () => {
    // é o caso que mata seletor CSS gerado: envolveram tudo em divs novas e trocaram as classes
    const doc = montar(`
      <section data-secao="materiais" class="grid gap-4 rounded-2xl">
        <div class="flex"><div class="min-w-0"><button type="button" class="btn-primary">Separar</button></div></div>
      </section>`);
    const r = reencontrar(doc, guardada());
    expect(r.precisao).toBe("exata");
    // o caminho antigo não existe mais: ele pousa na âncora, que é o que importa
    expect(r.elemento!.getAttribute("data-secao")).toBe("materiais");
  });

  it("APROXIMADA: a âncora existe, mas o índice guardado não existe mais", () => {
    const doc = montar(`<section data-secao="materiais"><button type="button">Separar</button></section>`);
    const r = reencontrar(doc, guardada({ ancoraIndice: 4 }));
    expect(r.precisao).toBe("aproximada");
    expect(r.elemento).not.toBeNull();
  });

  it("APROXIMADA: a âncora sumiu, mas o elemento é reconhecido pelo texto e pelo papel", () => {
    const doc = montar(`<main><div><button type="button">Separar</button></div></main>`);
    const r = reencontrar(doc, guardada());
    expect(r.precisao).toBe("aproximada");
    expect(r.elemento!.textContent).toBe("Separar");
  });

  it("PERDIDA: nada bate — e aqui está o ponto: devolve 'perdida', não um lugar errado", () => {
    const doc = montar(`<main><p>Outra tela inteira</p></main>`);
    const r = reencontrar(doc, guardada());
    expect(r.precisao).toBe("perdida");
    expect(r.elemento).toBeNull();
    // sem pin na tela; a lista mostra a anotação marcada, abrindo o print — ela não se perde
  });

  it("anotação antiga, sem âncora nenhuma gravada, não estoura", () => {
    const doc = montar(`<main><p>Qualquer coisa</p></main>`);
    expect(reencontrar(doc, ANCORA_VAZIA).precisao).toBe("perdida");
  });

  it("o pin é posicionado pela FRAÇÃO guardada, não por pixel", () => {
    const doc = montar(`<div data-secao="materiais"></div>`);
    const el = doc.querySelector("[data-secao]")!;
    // retângulo fingido: é o que o navegador dá e o happy-dom não calcula
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 40 }) as DOMRect;
    const p = pontoDoPin(el, { ...ANCORA_VAZIA, fx: 0.25, fy: 0.5 });
    expect(p).toEqual({ left: 150, top: 70 });
    // o MESMO elemento, maior: o pin acompanha, em vez de ficar para trás
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 40 }) as DOMRect;
    expect(pontoDoPin(el, { ...ANCORA_VAZIA, fx: 0.25, fy: 0.5 })).toEqual({ left: 200, top: 70 });
  });
});

/* ═════════ status e exportar ═════════ */

describe("Status e exportar", () => {
  it("os três status, e nada além deles", () => {
    expect(STATUS_ANOTACAO).toEqual(["aberta", "feita", "descartada"]);
    for (const s of STATUS_ANOTACAO) expect(ehStatusAnotacao(s)).toBe(true);
    for (const s of ["", "resolvida", "ABERTA", null, 1]) expect(ehStatusAnotacao(s)).toBe(false);
    expect(ROTULO_STATUS.aberta).toBe("Aberta");
  });

  it("feita e descartada carimbam a data; voltar para aberta limpa o carimbo", () => {
    const agora = new Date("2027-01-25T12:00:00Z");
    expect(resolveStatus("feita", agora)).toBe(agora);
    expect(resolveStatus("descartada", agora)).toBe(agora);
    expect(resolveStatus("aberta", agora)).toBeNull();
  });

  it("o Markdown agrupa por tela, marca o que está feito e NÃO leva o print", () => {
    const md = exportarMarkdown([
      { tela: "/ordens/:id?aba=materiais", tituloTela: "OS-1001", rotulo: "Separar", texto: "Botão muito escondido", status: "aberta", criadoEm: "2027-01-20T12:00:00Z", rota: "/ordens/abc?aba=materiais" },
      { tela: "/ordens/:id?aba=materiais", tituloTela: "OS-1001", rotulo: null, texto: "Faltou o total", status: "feita", criadoEm: "2027-01-21T12:00:00Z", rota: "/ordens/abc?aba=materiais" },
      { tela: "/equipamentos", tituloTela: "Equipamentos", rotulo: "Sem QR", texto: "Atalho confuso", status: "aberta", criadoEm: "2027-01-22T12:00:00Z", rota: "/equipamentos" },
    ], new Date("2027-01-25T12:00:00Z"));

    expect(md).toContain("# Anotações internas");
    expect(md).toContain("3 anotação(ões)");
    // duas telas, duas seções, e a primeira junta as duas anotações dela
    expect(md).toContain("## OS-1001 — `/ordens/:id?aba=materiais`");
    expect(md).toContain("## Equipamentos — `/equipamentos`");
    expect(md).toContain("- [ ] **Separar** — Botão muito escondido");
    expect(md).toContain("- [x] Faltou o total");
    // o print congela dado de cliente: não vai no texto que circula
    expect(md).not.toContain("data:image");
    expect(md).not.toContain("print");
  });

  it("lista vazia tem resposta própria (não devolve cabeçalho solto)", () => {
    expect(exportarMarkdown([])).toContain("Nenhuma anotação");
  });

  it("quebra de linha no texto não quebra a lista do Markdown", () => {
    const md = exportarMarkdown([
      { tela: "/x", tituloTela: null, rotulo: null, texto: "linha um\nlinha dois", status: "aberta", criadoEm: "2027-01-20T12:00:00Z", rota: "/x" },
    ]);
    expect(md).toContain("- [ ] linha um linha dois");
  });
});
