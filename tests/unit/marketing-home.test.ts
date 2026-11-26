/**
 * Home de vendas ("/"): a página renderizada de verdade (react-dom/server) e o middleware real.
 * Prova: estrutura do briefing na ordem, um CTA primário repetido com um destino só, cada print no bloco
 * certo e com o arquivo no tamanho certo (03, 07 e 15 em destaque), NENHUM espaço reservado à vista
 * (prova social e foto saem quando vazias; WhatsApp só com número configurado), SEO básico, a trava de
 * banco local dos scripts de demonstração e o acesso (anônimo vê a home; o resto do sistema segue fechado).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

const SEGREDO = "segredo-de-teste-marketing-home-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";
delete process.env.WHATSAPP_VENDAS;

import HomeDeVendas, { metadata, viewport } from "@/app/(publico)/(marketing)/page";
import TesteGratisPage, { viewport as viewportTeste } from "@/app/(publico)/(institucional)/teste-gratis/page";
import {
  CTA, CTA_FINAL, DOR, FAQ, HERO, LINK_TESTE_GRATIS, MODULOS, ORIGEM, PRINTS, PROVA_SOCIAL, PUBLICADA, contatoDeVendas,
} from "@/components/marketing/conteudo";
import { Janela, localizarPrint } from "@/components/marketing/print";
import { Rodape } from "@/components/marketing/rodape";
import { InstitucionalRodape } from "@/components/publico/institucional-rodape";
import { ehBancoLocal, exigirBancoLocal } from "@/scripts/vendas/banco-local";

const html = renderToStaticMarkup(createElement(HomeDeVendas));
const todos = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
const texto = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = (c: () => React.ReactNode) => renderToStaticMarkup(createElement(c));
afterEach(() => { vi.unstubAllEnvs(); });

describe("home de vendas: página", () => {
  it("seções na ordem do briefing, com um h1 só (sem a prova social enquanto não houver dado real)", () => {
    expect(todos(/data-secao="([^"]+)"/g)).toEqual(["hero", "dor", "modulos", "por-que", "por-que-existe", "como-funciona", "planos", "faq", "cta-final"]);
    expect(todos(/<h1[^>]*>([^<]+)</g)).toEqual([HERO.titulo]);
    expect(texto).toContain(DOR.titulo);
    expect(texto).toContain(CTA_FINAL.titulo);
  });

  it("os 8 módulos em zigue-zague, na ordem, com o PMOC em destaque", () => {
    expect(todos(/data-modulo="([^"]+)"/g)).toEqual(["ordens-de-servico", "pmoc", "aceite", "desempenho", "equipamentos", "estoque", "financeiro", "mapa"]);
    for (const m of MODULOS) expect(texto, m.id).toContain(m.titulo);
    expect(MODULOS.filter((m) => m.destaque).map((m) => m.id)).toEqual(["pmoc"]);
    // o texto troca de lado a cada bloco (2º, 4º, 6º e 8º)
    expect(html.match(/lg:order-2/g)).toHaveLength(4);
  });

  it("um CTA primário, repetido, sempre para o mesmo destino", () => {
    const ctas = [...html.matchAll(/<a[^>]*data-cta="teste-gratis"[^>]*>/g)].map((m) => m[0]);
    const locais = ctas.map((a) => /data-cta-local="([^"]+)"/.exec(a)![1]);
    expect(new Set(locais)).toEqual(new Set(["cabecalho", "hero", "modulo-pmoc", "como-funciona", "planos", "cta-final"]));
    for (const a of ctas) expect(a).toContain(`href="${LINK_TESTE_GRATIS}"`);
    expect(texto).toContain(CTA.principal);
    expect(texto).toContain(CTA.apoio);
    // o cabeçalho é fixo e leva o botão
    expect(html).toMatch(/<header class="sticky top-0[^"]*"/);
  });

  it("prints: todos os arquivos na pasta, no tamanho que o gerador grava, e na página com o texto alternativo", async () => {
    const lista = Object.values(PRINTS);
    expect(lista.map((p) => p.arquivo)).toEqual([
      "01-dashboard", "02-calendario-os", "03-orcamento-aprovado", "04-orcamentos", "05-contratos", "06-estoque-saldos", "07-mapa-equipe",
      "08-desempenho", "08-desempenho-tv", "09-equipes", "10-financeiro-painel", "11-app-tecnico", "12-pmoc", "13-aceite", "14-equipamento-qr",
      "14-qr-celular", "15-os-atividades",
    ]);
    for (const p of lista) {
      const src = localizarPrint(p.arquivo);
      expect(src, `${p.arquivo}: rode npm run prints:vendas`).toBe(`/marketing/prints/${p.arquivo}.webp`);
      const m = await sharp(path.join("public", src!)).metadata();
      expect([m.format, m.width, m.height], p.arquivo).toEqual(p.formato === "celular" ? ["webp", 780, 1646] : ["webp", 1600, 1000]);
      expect(html, p.arquivo).toContain(`alt="${p.alt}"`);
    }
    expect(new Set(todos(/data-print="([^"]+)"/g))).toEqual(new Set(lista.map((p) => p.arquivo)));
    // o LEIA-ME da pasta lista os mesmos nomes
    const leiaMe = readFileSync("public/marketing/prints/LEIA-ME.md", "utf8");
    for (const p of lista) expect(leiaMe, p.arquivo).toContain(`\`${p.arquivo}\``);
    // os prints antigos (telas da produção) saíram da pasta — e os de nome reaproveitável ganharam nome novo,
    // para nenhum cache de imagem otimizada servir a versão antiga no endereço de sempre
    for (const antigo of ["06-estoque", "07-mapa-tecnicos", "08-equipes", "09-colaboradores", "10-financeiro"]) expect(localizarPrint(antigo), antigo).toBeNull();
  });

  it("cada tela no bloco do seu assunto; OS com atividades (15), orçamento aprovado (03) e mapa (07) em destaque", () => {
    const bloco = (id: string) => { const i = html.indexOf(`data-modulo="${id}"`); const f = html.indexOf("</article>", i); return html.slice(html.lastIndexOf("<article", i), f); };
    const prints = (id: string) => [...bloco(id).matchAll(/data-print="([^"]+)"/g)].map((m) => m[1]);
    expect(prints("ordens-de-servico")).toEqual(["15-os-atividades", "11-app-tecnico", "02-calendario-os"]);
    expect(prints("pmoc")).toEqual(["12-pmoc"]);
    expect(prints("aceite")).toEqual(["13-aceite"]);
    expect(prints("desempenho")).toEqual(["08-desempenho", "08-desempenho-tv", "09-equipes"]);
    expect(prints("equipamentos")).toEqual(["14-equipamento-qr", "14-qr-celular"]);
    expect(prints("estoque")).toEqual(["06-estoque-saldos"]);
    expect(prints("financeiro")).toEqual(["03-orcamento-aprovado", "04-orcamentos", "05-contratos", "10-financeiro-painel"]);
    expect(prints("mapa")).toEqual(["07-mapa-equipe"]);
    // hero: dashboard no notebook e o app do técnico no celular
    expect([...html.slice(html.indexOf('data-secao="hero"'), html.indexOf('data-secao="dor"')).matchAll(/data-print="([^"]+)"/g)].map((m) => m[1])).toEqual(["01-dashboard", "11-app-tecnico"]);
    // destaque: a coluna do print fica mais larga
    expect(MODULOS.filter((m) => m.printEmDestaque).map((m) => m.print.arquivo)).toEqual(["15-os-atividades", "03-orcamento-aprovado", "07-mapa-equipe"]);
    expect(html.match(/data-print-em-destaque/g)).toHaveLength(3);
    expect(bloco("ordens-de-servico")).toContain("lg:grid-cols-[1fr_1.35fr]");
    expect(bloco("financeiro")).toContain("lg:grid-cols-[1fr_1.35fr]");
    expect(bloco("mapa")).toContain("lg:grid-cols-[1.35fr_1fr]");
    // miniaturas com legenda: 3 no financeiro, 2 no desempenho (grade de 2)
    expect([...bloco("financeiro").matchAll(/data-miniatura="([^"]+)"/g)].map((m) => m[1])).toEqual(["04-orcamentos", "05-contratos", "10-financeiro-painel"]);
    expect([...bloco("desempenho").matchAll(/data-miniatura="([^"]+)"/g)].map((m) => m[1])).toEqual(["08-desempenho-tv", "09-equipes"]);
    expect(bloco("desempenho")).toContain("grid-cols-2");
  });

  it("nenhum espaço reservado na página: nem print, nem foto, nem prova social, nem contato falso", () => {
    expect(html).not.toMatch(/data-print-pendente|data-foto-pendente|data-prova-social-pendente|data-reservado/);
    expect(texto).not.toMatch(/Espaço reservado|Print \d|\[número\]|\[e-mail\]|99999-9999|\.webp/);
  });

  it("print sem o arquivo na pasta não aparece (moldura vazia nunca vai ao ar)", () => {
    expect(renderToStaticMarkup(createElement(Janela, { print: { arquivo: "nao-existe", tela: "X", formato: "desktop", alt: "x" }, sizes: "100vw" }))).toBe("");
    const pasta = mkdtempSync(path.join(tmpdir(), "prints-"));
    expect(localizarPrint("01-dashboard", pasta)).toBeNull();
    writeFileSync(path.join(pasta, "01-dashboard.png"), "");
    expect(localizarPrint("01-dashboard", pasta)).toBe("/marketing/prints/01-dashboard.png");
    writeFileSync(path.join(pasta, "01-dashboard.webp"), "");
    expect(localizarPrint("01-dashboard", pasta)).toBe("/marketing/prints/01-dashboard.webp");
  });

  it("prova social: só dado real — vazia, a seção não aparece e nenhum número de cliente é inventado", () => {
    expect(PROVA_SOCIAL).toEqual({ depoimentos: [], numeros: [], logos: [] });
    expect(html).not.toContain('data-secao="prova-social"');
    // nenhum número de cliente na página: "+ de 500 empresas", "98% de satisfação"…
    expect(texto).not.toMatch(/\d+\s*(?:%|mil\b|\+)|\+\s*de\s*\d|\d+\s+(?:empresas|clientes|técnicos|usuários)/i);
    // sem prova social, Planos e FAQ alternam o fundo para nada ficar colado com o mesmo cinza
    expect(html).toMatch(/<section[^>]*id="como-funciona"[^>]*class="[^"]*bg-surface-page/);
    expect(html).not.toMatch(/<section[^>]*id="planos"[^>]*class="[^"]*bg-surface-page/);
    expect(html).toMatch(/<section[^>]*id="faq"[^>]*class="[^"]*bg-surface-page/);
  });

  it("por que o Frivo existe: entre 'Por que Frivo' e 'Como funciona', com o texto e o depoimento do fundador; sem foto, o texto ocupa a linha", () => {
    const secao = html.slice(html.indexOf('data-secao="por-que-existe"'), html.indexOf('data-secao="como-funciona"'));
    const t = secao.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(secao).toMatch(/<h2[^>]*>Feito por climatização\. Para climatização\.<\/h2>/);
    expect(ORIGEM.paragrafos).toHaveLength(3);
    for (const p of ORIGEM.paragrafos) expect(t).toContain(p);
    expect(t).toContain("Termofrio Engenharia e Clima");
    expect(secao).toMatch(/<figure[^>]*data-depoimento-fundador[^>]*>[\s\S]*<blockquote/);
    expect(t).toContain(`“${ORIGEM.depoimento.texto}”`);
    expect(t).toContain("Edione Bonfim , fundador · Termofrio Engenharia e Clima");
    // a foto real ainda não existe: nada de quadro vazio, e o texto não fica espremido numa coluna
    expect(localizarPrint(ORIGEM.foto.arquivo)).toBeNull();
    expect(secao).not.toContain("data-foto");
    expect(secao).not.toContain("lg:grid-cols-[1.1fr_0.9fr]");
    expect(readFileSync("public/marketing/prints/LEIA-ME.md", "utf8")).toContain("`foto-equipe`");
  });

  it("FAQ: as 6 perguntas do briefing, com resposta, e o caminho para a completa", () => {
    expect(FAQ.map((f) => f.pergunta)).toEqual([
      "O que é o Frivo?", "Pra quem é?", "Funciona offline no campo?", "Emite nota fiscal e boleto?", "Tem teste grátis?", "Meus dados estão seguros (LGPD)?",
    ]);
    expect(html.match(/<details/g)).toHaveLength(6);
    for (const f of FAQ) { expect(texto).toContain(f.pergunta); expect(texto).toContain(f.resposta); }
    expect(html).toContain('href="/faq"');
  });

  it("rodapé: links do briefing e o e-mail; WhatsApp só com número configurado", () => {
    const rodape = html.slice(html.indexOf("<footer"));
    for (const href of ["#planos", "/faq", "/privacidade", "#contato"]) expect(rodape).toContain(`href="${href}"`);
    expect(rodape).toMatch(/<a href="mailto:contato@termofrioengenharia\.com\.br"[^>]*>.*?contato@termofrioengenharia\.com\.br<\/a>/);
    expect(rodape).not.toContain("wa.me");
    expect(rodape).not.toContain("WhatsApp");
    expect(rodape).toMatch(/© \d{4} Frivo/);

    vi.stubEnv("WHATSAPP_VENDAS", "62912345678");
    const comNumero = render(Rodape);
    expect(comNumero).toMatch(/<a href="https:\/\/wa\.me\/5562912345678"[^>]*data-contato="whatsapp"[^>]*>.*?WhatsApp[^<]*\(62\) 91234-5678<\/a>/);
  });

  it("o número do WhatsApp vem da configuração e só vale se for um telefone", () => {
    const de = (v: string | undefined) => contatoDeVendas({ WHATSAPP_VENDAS: v });
    expect(de(undefined)).toMatchObject({ whatsapp: null, linkWhatsapp: null, email: "contato@termofrioengenharia.com.br", linkEmail: "mailto:contato@termofrioengenharia.com.br" });
    expect(de("")).toMatchObject({ whatsapp: null, linkWhatsapp: null });
    expect(de("123")).toMatchObject({ whatsapp: null, linkWhatsapp: null });
    expect(de("62912345678")).toMatchObject({ whatsapp: "(62) 91234-5678", linkWhatsapp: "https://wa.me/5562912345678" });
    expect(de("+55 (62) 91234-5678")).toMatchObject({ whatsapp: "(62) 91234-5678", linkWhatsapp: "https://wa.me/5562912345678" });
    expect(de("6233334444")).toMatchObject({ whatsapp: "(62) 3333-4444", linkWhatsapp: "https://wa.me/556233334444" });
  });

  it("SEO básico: título, descrição, canonical e Open Graph; fora dos buscadores até publicar", () => {
    const m = metadata as any;
    expect(m.title.absolute).toMatch(/Frivo/);
    expect(m.description.length).toBeGreaterThan(80);
    expect(m.description.length).toBeLessThanOrEqual(160);
    expect(m.alternates.canonical).toBe("/");
    expect(m.openGraph).toMatchObject({ type: "website", locale: "pt_BR", title: m.title.absolute, description: m.description });
    expect(m.twitter.card).toBe("summary_large_image");
    expect(PUBLICADA).toBe(false);
    expect(m.robots).toEqual({ index: false, follow: false });
    // a página de vendas deixa ampliar (o app trava o zoom no layout raiz, por ser PWA)
    expect(viewport).toMatchObject({ maximumScale: 5, userScalable: true });
  });
});

describe("teste grátis (destino provisório do CTA) e rodapé institucional", () => {
  it("sem WhatsApp configurado: o pedido de acesso é por e-mail, com assunto e mensagem prontos", () => {
    const p = render(TesteGratisPage);
    expect(p).toContain("data-teste-gratis-provisorio");
    expect(p.match(/data-passos-teste/g)).toHaveLength(1);
    expect(p).toContain("Por e-mail, com o nome da sua empresa.");
    expect(p).not.toContain("wa.me");
    expect(p).toMatch(/<a href="mailto:contato@termofrioengenharia\.com\.br\?subject=Teste%20gr%C3%A1tis%20do%20Frivo&amp;body=[^"]+"[^>]*data-pedir-acesso="email"[^>]*class="[^"]*bg-acento/);
    expect(p).toContain('data-print="01-dashboard"');
    expect(viewportTeste).toMatchObject({ maximumScale: 5, userScalable: true });
  });

  it("com WhatsApp configurado: ele vira o botão principal, com a mensagem pronta; o e-mail continua", () => {
    vi.stubEnv("WHATSAPP_VENDAS", "62912345678");
    const p = render(TesteGratisPage);
    expect(p).toMatch(/<a href="https:\/\/wa\.me\/5562912345678\?text=Quero%20testar%20o%20Frivo[^"]*"[^>]*data-pedir-acesso="whatsapp"[^>]*class="[^"]*bg-acento/);
    expect(p).toMatch(/data-pedir-acesso="email"[^>]*class="[^"]*bg-white/);
    expect(p).toContain("Pelo WhatsApp ou por e-mail, com o nome da sua empresa.");
  });

  it("o rodapé das páginas institucionais usa o mesmo contato (sem os colchetes de antes)", () => {
    const r = render(InstitucionalRodape);
    expect(r).not.toMatch(/\[número\]|\[e-mail\]/);
    expect(r).toContain('href="mailto:contato@termofrioengenharia.com.br"');
    expect(r).not.toContain("wa.me");
    vi.stubEnv("WHATSAPP_VENDAS", "62912345678");
    expect(render(InstitucionalRodape)).toContain('href="https://wa.me/5562912345678"');
  });
});

describe("empresa de demonstração: só banco local", () => {
  it("aceita localhost e socket local; recusa qualquer outro host (a produção, inclusive)", () => {
    for (const ok of ["postgresql://u@localhost:5432/frivo_prints", "postgresql://u@127.0.0.1/x", "postgresql://postgres@localhost:5433/frivo_prints?host=/var/run/postgresql", "postgresql://u@[::1]:5432/x"]) {
      expect(ehBancoLocal(ok), ok).toBe(true);
    }
    for (const nao of [undefined, "", "lixo", "postgresql://u:s@db.prod.exemplo:5432/frivo", "postgresql://u@ep-cool-name.us-east-2.aws.neon.tech/neondb", "postgresql://u@localhost.exemplo/x"]) {
      expect(ehBancoLocal(nao), String(nao)).toBe(false);
    }
    expect(() => exigirBancoLocal("postgresql://u@db.prod.exemplo/frivo")).toThrow(/banco local/);
    expect(() => exigirBancoLocal("postgresql://u@localhost/frivo_prints")).not.toThrow();
  });

  it("o gerador de prints (JavaScript puro) traz a mesma trava antes de tudo", () => {
    const fonte = readFileSync("scripts/vendas/gerar-prints.mjs", "utf8");
    expect(fonte).toMatch(/function exigirBancoLocal\(\)/);
    expect(fonte.indexOf("exigirBancoLocal();")).toBeLessThan(fonte.indexOf("vite-node"));
    expect(readFileSync("package.json", "utf8")).toContain('"prints:vendas": "node scripts/vendas/gerar-prints.mjs"');
  });
});

describe("home de vendas: acesso (middleware real)", () => {
  const abrir = async (caminho: string, cookie?: string) => {
    const { default: middleware } = await import("@/middleware");
    return (await (middleware as any)(new NextRequest(`http://localhost${caminho}`, cookie ? { headers: { cookie } } : undefined), {})) as Response;
  };
  const destino = async (caminho: string, cookie?: string) => (await abrir(caminho, cookie)).headers.get("location");

  it("anônimo abre a home, o destino do CTA, os prints e a imagem de compartilhamento", async () => {
    for (const c of ["/", "/teste-gratis", "/marketing/prints/01-dashboard.webp", "/opengraph-image", "/faq", "/privacidade"]) {
      expect(await destino(c), c).toBeNull();
    }
  });

  it('liberar "/" não libera o sistema', async () => {
    for (const c of ["/dashboard", "/ordens", "/clientes", "/api/ordens", "/marketing"]) {
      expect(await destino(c), c).toBe(`http://localhost/login?callbackUrl=${encodeURIComponent(c)}`);
    }
  });

  it("quem está logado vai da home direto para o painel", async () => {
    const nome = "authjs.session-token";
    const token = await encode({ secret: SEGREDO, salt: nome, token: { sub: "u1", id: "u1", role: "ADMIN", empresaId: "e1" } });
    const local = await destino("/", `${nome}=${token}`);
    expect(local).toBe("http://localhost/dashboard");
  });
});
