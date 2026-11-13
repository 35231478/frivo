import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarClock, Check, FileX2, Layers, type LucideIcon, Quote, Receipt, Signature, Snowflake, Target, Zap,
} from "lucide-react";
import { Cabecalho } from "@/components/marketing/cabecalho";
import { Rodape } from "@/components/marketing/rodape";
import { BotaoTeste } from "@/components/marketing/botao-teste";
import { Celular, Janela, Notebook } from "@/components/marketing/print";
import { FaqLista } from "@/components/publico/faq-lista";
import {
  COMO_FUNCIONA, CTA, CTA_FINAL, DOR, FAQ, HERO, MODULOS, type Modulo, PLANOS, POR_QUE, PRINTS, PROVA_SOCIAL, PUBLICADA, SEO, URL_SITE,
} from "@/components/marketing/conteudo";
import { cn } from "@/lib/utils";

// Home de vendas do Frivo (rota "/"). Página ESTÁTICA: quem está logado nem chega aqui (o middleware
// leva ao painel), então não há sessão nem banco no caminho — é HTML pronto, servido do cache.
// O conteúdo (textos, prints, links) fica em components/marketing/conteudo.ts.
export const dynamic = "force-static";

export const metadata: Metadata = {
  metadataBase: new URL(URL_SITE),
  title: { absolute: SEO.titulo },
  description: SEO.descricao,
  alternates: { canonical: "/" },
  robots: { index: PUBLICADA, follow: PUBLICADA },
  openGraph: { type: "website", locale: "pt_BR", siteName: "Frivo", url: "/", title: SEO.titulo, description: SEO.descricao },
  twitter: { card: "summary_large_image", title: SEO.titulo, description: SEO.descricao },
};

const ICONES: Record<string, LucideIcon> = {
  os: FileX2, pmoc: CalendarClock, aceite: Signature, equipe: Target, financeiro: Receipt,
  especializado: Snowflake, rapido: Zap, completo: Layers,
};

const CAIXA = "mx-auto max-w-6xl px-4 sm:px-6";
const TITULO_SECAO = "font-display text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl";
// Metade da largura no computador, a largura toda no celular
const SIZES_METADE = "(min-width: 1024px) 560px, 100vw";

export default function HomeDeVendas() {
  return (
    <div className="bg-white">
      <Cabecalho />
      <main>
        <Hero />
        <Dor />
        <Modulos />
        <PorQue />
        <ComoFunciona />
        <ProvaSocial />
        <Planos />
        <Faq />
        <CtaFinal />
      </main>
      <Rodape />
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b border-surface-border" data-secao="hero">
      <div className={cn(CAIXA, "grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[1fr_1.15fr] lg:gap-12 lg:py-20")}>
        <div>
          <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl sm:leading-[1.08]">
            {HERO.titulo}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">{HERO.subtitulo}</p>
          <div className="mt-8">
            <BotaoTeste local="hero" className="w-full sm:w-auto" />
            <p className="mt-3 text-sm text-ink-muted">{CTA.apoio}</p>
          </div>
        </div>

        <div className="relative px-[4%] pb-[6%]">
          <Notebook print={PRINTS.dashboard} sizes="(min-width: 1024px) 600px, 92vw" prioridade />
          <Celular print={PRINTS.appTecnico} sizes="(min-width: 1024px) 140px, 22vw" prioridade compacto className="absolute bottom-0 right-0 w-[23%]" />
        </div>
      </div>
    </section>
  );
}

function Dor() {
  return (
    <section className="bg-surface-page" data-secao="dor">
      <div className={cn(CAIXA, "py-14 sm:py-20")}>
        <h2 className={cn(TITULO_SECAO, "max-w-3xl")}>{DOR.titulo}</h2>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {DOR.itens.map((item) => {
            const Icone = ICONES[item.icone];
            return (
              <li key={item.icone} className="flex items-start gap-3 rounded-card border border-surface-border bg-white p-4 lg:flex-col">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-atencao-claro text-atencao-texto">
                  <Icone className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[15px] font-medium leading-snug text-ink">{item.texto}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 font-display text-lg font-semibold text-ink sm:text-xl">{DOR.fecho}</p>
      </div>
    </section>
  );
}

function Modulos() {
  return (
    <section id="recursos" className="scroll-mt-16" data-secao="modulos">
      <div className={cn(CAIXA, "py-6 sm:py-10")}>
        {MODULOS.map((m, i) => <BlocoModulo key={m.id} modulo={m} invertido={i % 2 === 1} />)}
      </div>
    </section>
  );
}

/** Um recurso: texto de um lado, print do outro; `invertido` alterna os lados (zigue-zague). */
function BlocoModulo({ modulo, invertido }: { modulo: Modulo; invertido: boolean }) {
  const { print, printCelular } = modulo;
  return (
    <article
      id={modulo.id}
      data-modulo={modulo.id}
      className={cn(
        "my-8 grid scroll-mt-24 items-center gap-8 sm:my-12 lg:grid-cols-2 lg:gap-14",
        modulo.destaque && "rounded-card border border-primary-100 bg-acento-claro p-5 sm:p-8 lg:p-10",
      )}
    >
      <div className={cn(invertido && "lg:order-2")}>
        <p className="text-sm font-semibold text-acento">{modulo.rotulo}</p>
        <h3 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight text-ink sm:text-[1.75rem]">{modulo.titulo}</h3>
        <p className="mt-3 text-base leading-relaxed text-ink-muted">{modulo.texto}</p>
        {modulo.destaque && <BotaoTeste local={`modulo-${modulo.id}`} className="mt-6 w-full sm:w-auto" />}
      </div>

      {print.formato === "celular" ? (
        <div className="flex justify-center rounded-card bg-surface-page px-6 py-8">
          <Celular print={print} sizes="230px" className="w-[52%] max-w-[230px]" />
        </div>
      ) : (
        <div className={cn("relative", printCelular && "pb-[5%] pr-[5%]")}>
          <Janela print={print} sizes={SIZES_METADE} />
          {printCelular && <Celular print={printCelular} sizes="(min-width: 1024px) 130px, 24vw" compacto className="absolute bottom-0 right-0 w-[24%]" />}
        </div>
      )}
    </article>
  );
}

function PorQue() {
  return (
    <section className="bg-surface-page" data-secao="por-que">
      <div className={cn(CAIXA, "py-14 sm:py-20")}>
        <h2 className={cn(TITULO_SECAO, "mx-auto max-w-2xl text-center")}>{POR_QUE.titulo}</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {POR_QUE.colunas.map((c) => {
            const Icone = ICONES[c.icone];
            return (
              <div key={c.icone} className="rounded-card border border-surface-border bg-white p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-acento-claro text-acento">
                  <Icone className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-ink">{c.titulo}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{c.texto}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ComoFunciona() {
  return (
    <section id="como-funciona" className="scroll-mt-16" data-secao="como-funciona">
      <div className={cn(CAIXA, "py-14 sm:py-20")}>
        <h2 className={cn(TITULO_SECAO, "text-center")}>{COMO_FUNCIONA.titulo}</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {COMO_FUNCIONA.passos.map((p, i) => (
            <li key={p.titulo} className="flex gap-4 md:flex-col md:items-center md:text-center">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-acento font-display text-lg font-bold tabular-nums text-white">
                {i + 1}
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">{p.titulo}</h3>
                {p.texto && <p className="mt-1 text-[15px] text-ink-muted">{p.texto}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <BotaoTeste local="como-funciona" className="w-full sm:w-auto" />
        </div>
      </div>
    </section>
  );
}

/**
 * Prova social. Só entra dado REAL (PROVA_SOCIAL, em conteudo.ts): enquanto as listas estão vazias, a
 * seção mostra os espaços reservados — nada de número ou depoimento inventado.
 */
function ProvaSocial() {
  const { depoimentos, numeros, logos } = PROVA_SOCIAL;
  const vazia = depoimentos.length + numeros.length + logos.length === 0;
  const reservado = "flex items-center justify-center rounded-card border border-dashed border-surface-border bg-white text-center text-sm text-ink-muted";
  return (
    <section className="bg-surface-page" data-secao="prova-social" {...(vazia ? { "data-prova-social-pendente": true } : {})}>
      <div className={cn(CAIXA, "py-14 sm:py-20")}>
        {vazia ? (
          <>
            <p className="label-uppercase text-center">Espaço reservado · prova social</p>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className={cn(reservado, "min-h-[160px] p-6")} data-reservado="depoimento">Depoimento de cliente</div>
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((n) => <div key={n} className={cn(reservado, "min-h-[96px] p-3")} data-reservado="numero">Número real {n}</div>)}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-5">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className={cn(reservado, "h-14 text-xs", n > 3 && "hidden sm:flex")} data-reservado="logo">Logo {n}</div>
              ))}
            </div>
          </>
        ) : (
          <>
            {numeros.length > 0 && (
              <dl className="grid gap-4 text-center sm:grid-cols-3">
                {numeros.map((n) => (
                  <div key={n.rotulo} className="rounded-card border border-surface-border bg-white p-6">
                    <dd className="font-display text-3xl font-bold tabular-nums text-ink">{n.valor}</dd>
                    <dt className="mt-1 text-sm text-ink-muted">{n.rotulo}</dt>
                  </div>
                ))}
              </dl>
            )}
            {depoimentos.length > 0 && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {depoimentos.map((d) => (
                  <figure key={d.nome} className="rounded-card border border-surface-border bg-white p-6">
                    <Quote className="h-5 w-5 text-acento" aria-hidden />
                    <blockquote className="mt-3 text-base leading-relaxed text-ink">{d.texto}</blockquote>
                    <figcaption className="mt-4 text-sm text-ink-muted"><span className="font-semibold text-ink">{d.nome}</span> · {d.empresa}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {logos.length > 0 && (
              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
                {logos.map((l) => (
                  <li key={l.nome}><Image src={l.src} alt={l.nome} width={120} height={40} className="h-8 w-auto object-contain" /></li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Planos() {
  return (
    <section id="planos" className="scroll-mt-16" data-secao="planos">
      <div className={cn(CAIXA, "py-14 sm:py-20")}>
        <div className="mx-auto max-w-2xl rounded-card border border-surface-border bg-white p-6 text-center shadow-card sm:p-10">
          <h2 className={TITULO_SECAO}>{PLANOS.titulo}</h2>
          <ul className="mx-auto mt-6 flex max-w-sm flex-col gap-3 text-left">
            {PLANOS.itens.map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-ink">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden /> {item}
              </li>
            ))}
          </ul>
          <BotaoTeste local="planos" rotulo={CTA.planos} className="mt-8 w-full sm:w-auto" />
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 bg-surface-page" data-secao="faq">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 className={cn(TITULO_SECAO, "text-center")}>Perguntas frequentes</h2>
        <div className="mt-8">
          <FaqLista itens={FAQ.map((f) => ({ pergunta: f.pergunta, resposta: <p>{f.resposta}</p> }))} />
        </div>
        <p className="mt-5 text-center text-sm">
          <Link href="/faq" className="inline-flex min-h-[44px] items-center font-medium text-acento underline-offset-2 hover:underline">
            Ver todas as perguntas
          </Link>
        </p>
      </div>
    </section>
  );
}

function CtaFinal() {
  return (
    <section className="bg-primary-800" data-secao="cta-final">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">{CTA_FINAL.titulo}</h2>
        <p className="mt-4 text-base text-primary-100 sm:text-lg">{CTA_FINAL.subtitulo}</p>
        <BotaoTeste local="cta-final" inverso className="mt-8 w-full sm:w-auto" />
      </div>
    </section>
  );
}
