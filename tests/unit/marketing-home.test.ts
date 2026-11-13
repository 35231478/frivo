/**
 * Home de vendas ("/"): a página renderizada de verdade (react-dom/server) e o middleware real.
 * Prova: estrutura do briefing na ordem, um CTA primário repetido com um destino só, os prints no
 * bloco certo (imagem real ou espaço reservado nomeado; 03 e 07 em destaque), a seção da origem
 * com o espaço da foto, nenhuma prova social inventada, SEO básico e o acesso (anônimo vê a home; o resto do sistema segue fechado).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

const SEGREDO = "segredo-de-teste-marketing-home-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";

import HomeDeVendas, { metadata } from "@/app/(publico)/(marketing)/page";
import {
  CTA, CTA_FINAL, DOR, FAQ, HERO, LINK_TESTE_GRATIS, MODULOS, ORIGEM, PRINTS, PROVA_SOCIAL, PUBLICADA,
} from "@/components/marketing/conteudo";
import { localizarPrint } from "@/components/marketing/print";

const html = renderToStaticMarkup(createElement(HomeDeVendas));
const todos = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
const texto = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("home de vendas: página", () => {
  it("seções na ordem do briefing, com um h1 só", () => {
    expect(todos(/data-secao="([^"]+)"/g)).toEqual(["hero", "dor", "modulos", "por-que", "por-que-existe", "como-funciona", "prova-social", "planos", "faq", "cta-final"]);
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

  it("prints: os 10 enviados na numeração combinada, mais os que faltam; cada lugar mostra a imagem real ou o espaço reservado nomeado", () => {
    const lista = Object.values(PRINTS);
    expect(lista.map((p) => `${p.n} ${p.arquivo}`)).toEqual([
      "1 01-dashboard", "2 02-calendario-os", "3 03-orcamento-aprovado", "4 04-orcamentos", "5 05-contratos",
      "6 06-estoque", "7 07-mapa-tecnicos", "8 08-equipes", "9 09-colaboradores", "10 10-financeiro",
      "11 11-app-tecnico", "12 12-pmoc", "13 13-aceite", "14 14-equipamento-qr",
    ]);
    expect(new Set(todos(/data-print="([^"]+)"/g))).toEqual(new Set(lista.map((p) => p.arquivo)));
    for (const p of lista) {
      if (localizarPrint(p.arquivo)) {
        expect(html, p.arquivo).toContain(`alt="${p.alt}"`);
        expect(texto, p.arquivo).not.toContain(`${p.arquivo}.webp`);
      } else {
        expect(texto, p.arquivo).toContain(`Print ${p.n} ${p.tela}`);
        expect(texto).toContain(`${p.arquivo}.webp`);
      }
    }
    // o LEIA-ME da pasta lista os mesmos nomes
    const leiaMe = readFileSync("public/marketing/prints/LEIA-ME.md", "utf8");
    for (const p of lista) expect(leiaMe, p.arquivo).toContain(`\`${p.arquivo}\``);
  });

  it("as telas reais já entregues entram como imagem otimizada (sem espaço reservado)", () => {
    for (const arquivo of ["06-estoque", "07-mapa-tecnicos", "08-equipes", "09-colaboradores", "10-financeiro"]) {
      expect(localizarPrint(arquivo), arquivo).toBe(`/marketing/prints/${arquivo}.webp`);
      const marca = new RegExp(`<div[^>]*data-print="${arquivo}"[^>]*>`).exec(html)![0];
      expect(marca, arquivo).not.toContain("data-print-pendente");
    }
    expect(html).toMatch(/<img[^>]*alt="Mapa com a posição do técnico em campo e a OS em execução"[^>]*srcSet="[^"]*%2Fmarketing%2Fprints%2F07-mapa-tecnicos\.webp/);
  });

  it("cada tela no bloco do seu assunto; orçamento aprovado (03) e mapa (07) com o print em destaque", () => {
    const bloco = (id: string) => { const i = html.indexOf(`data-modulo="${id}"`); const f = html.indexOf("</article>", i); return html.slice(html.lastIndexOf("<article", i), f); };
    const prints = (id: string) => [...bloco(id).matchAll(/data-print="([^"]+)"/g)].map((m) => m[1]);
    expect(prints("ordens-de-servico")).toEqual(["02-calendario-os", "11-app-tecnico"]);
    expect(prints("pmoc")).toEqual(["12-pmoc"]);
    expect(prints("aceite")).toEqual(["13-aceite"]);
    expect(prints("desempenho")).toEqual(["08-equipes", "09-colaboradores"]);
    expect(prints("equipamentos")).toEqual(["14-equipamento-qr"]);
    expect(prints("estoque")).toEqual(["06-estoque"]);
    expect(prints("financeiro")).toEqual(["03-orcamento-aprovado", "04-orcamentos", "05-contratos", "10-financeiro"]);
    expect(prints("mapa")).toEqual(["07-mapa-tecnicos"]);
    // hero: dashboard no notebook
    expect([...html.slice(html.indexOf('data-secao="hero"'), html.indexOf('data-secao="dor"')).matchAll(/data-print="([^"]+)"/g)].map((m) => m[1])).toEqual(["01-dashboard", "11-app-tecnico"]);
    // destaque: só os blocos do 03 e do 07 têm a coluna larga do print
    expect(MODULOS.filter((m) => m.printEmDestaque).map((m) => m.print.arquivo)).toEqual(["03-orcamento-aprovado", "07-mapa-tecnicos"]);
    expect(html.match(/data-print-em-destaque/g)).toHaveLength(2);
    expect(bloco("financeiro")).toContain("lg:grid-cols-[1fr_1.35fr]");
    expect(bloco("mapa")).toContain("lg:grid-cols-[1.35fr_1fr]");
    // as telas extras do financeiro vêm em miniaturas com legenda
    expect([...bloco("financeiro").matchAll(/data-miniatura="([^"]+)"/g)].map((m) => m[1])).toEqual(["04-orcamentos", "05-contratos", "10-financeiro"]);
  });

  it("o arquivo com o nome certo na pasta troca o espaço reservado pela imagem", () => {
    const pasta = mkdtempSync(path.join(tmpdir(), "prints-"));
    expect(localizarPrint("01-dashboard", pasta)).toBeNull();
    writeFileSync(path.join(pasta, "01-dashboard.png"), "");
    expect(localizarPrint("01-dashboard", pasta)).toBe("/marketing/prints/01-dashboard.png");
    writeFileSync(path.join(pasta, "01-dashboard.webp"), "");
    expect(localizarPrint("01-dashboard", pasta)).toBe("/marketing/prints/01-dashboard.webp");
    expect(localizarPrint("02-calendario-os", pasta)).toBeNull();
  });

  it("prova social: vazia e marcada como espaço reservado (nada inventado)", () => {
    expect(PROVA_SOCIAL).toEqual({ depoimentos: [], numeros: [], logos: [] });
    expect(html).toContain("data-prova-social-pendente");
    expect(todos(/data-reservado="([^"]+)"/g).sort()).toEqual(["depoimento", ...Array(5).fill("logo"), ...Array(3).fill("numero")]);
    const secao = html.slice(html.indexOf('data-secao="prova-social"'), html.indexOf('data-secao="planos"'));
    expect(secao).not.toContain("<blockquote");
    // nenhum número de cliente na página: "+ de 500 empresas", "98% de satisfação"…
    expect(texto).not.toMatch(/\d+\s*(?:%|mil\b|\+)|\+\s*de\s*\d|\d+\s+(?:empresas|clientes|técnicos|usuários)/i);
  });

  it("por que o Frivo existe: entre 'Por que Frivo' e 'Como funciona', com o texto, o depoimento do fundador e o espaço da foto", () => {
    const secao = html.slice(html.indexOf('data-secao="por-que-existe"'), html.indexOf('data-secao="como-funciona"'));
    const t = secao.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(secao).toMatch(/<h2[^>]*>Feito por climatização\. Para climatização\.<\/h2>/);
    expect(ORIGEM.paragrafos).toHaveLength(3);
    for (const p of ORIGEM.paragrafos) expect(t).toContain(p);
    expect(t).toContain("Termofrio Engenharia e Clima");
    // depoimento em destaque, com autor e papel
    expect(secao).toMatch(/<figure[^>]*data-depoimento-fundador[^>]*>[\s\S]*<blockquote/);
    expect(t).toContain(`“${ORIGEM.depoimento.texto}”`);
    expect(t).toContain("Edione Bonfim , fundador · Termofrio Engenharia e Clima");
    // foto real: espaço reservado nomeado, trocado pelo arquivo como os prints
    expect(secao).toMatch(/data-foto="foto-equipe"[^>]*data-foto-pendente/);
    expect(t).toContain("foto-equipe.jpg");
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

  it("rodapé: links do briefing e o contato (WhatsApp abre a conversa, e-mail abre o programa de e-mail)", () => {
    const rodape = html.slice(html.indexOf("<footer"));
    for (const href of ["#planos", "/faq", "/privacidade", "#contato"]) expect(rodape).toContain(`href="${href}"`);
    expect(rodape).toMatch(/<a href="https:\/\/wa\.me\/5562999999999"[^>]*data-contato="whatsapp"[^>]*>.*?WhatsApp[^<]*\(62\) 99999-9999<\/a>/);
    expect(rodape).toMatch(/<a href="mailto:contato@termofrioengenharia\.com\.br"[^>]*>.*?contato@termofrioengenharia\.com\.br<\/a>/);
    expect(rodape).not.toMatch(/\[número\]|\[e-mail\]/);
    expect(rodape).toMatch(/© \d{4} Frivo/);
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
