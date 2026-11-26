import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { CTA, PRINTS, contatoDeVendas } from "@/components/marketing/conteudo";
import { Notebook } from "@/components/marketing/print";

// Destino PROVISÓRIO do CTA da home de vendas ("Teste grátis por 7 dias"). O Frivo ainda não tem o
// cadastro automático da empresa; até ele existir, esta página encaminha o pedido de acesso para o
// contato de vendas (contatoDeVendas, em components/marketing/conteudo.ts): WhatsApp quando houver
// número configurado, e-mail sempre. Quando o cadastro entrar, troca-se LINK_TESTE_GRATIS (ou esta
// página vira o formulário).
export const metadata: Metadata = {
  title: "Teste grátis por 7 dias",
  description: "Teste o Frivo por 7 dias, sem cartão de crédito.",
  robots: { index: false, follow: false },
};

// Como na home de vendas: o visitante pode ampliar (o app trava o zoom no layout raiz, por ser PWA)
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true };

const passos = (comWhatsapp: boolean) => [
  { titulo: "Peça o acesso", texto: `${comWhatsapp ? "Pelo WhatsApp ou por e-mail" : "Por e-mail"}, com o nome da sua empresa.` },
  { titulo: "Receba o login", texto: "Liberamos o Frivo para a sua empresa e ajudamos a importar clientes e equipe." },
  { titulo: "Use por 7 dias", texto: "Abra OS, cadastre equipamentos e chame a equipe." },
];

const MENSAGEM = "Quero testar o Frivo por 7 dias. Empresa: ";

export default function TesteGratisPage() {
  const contato = contatoDeVendas();
  const linkWhatsapp = contato.linkWhatsapp ? `${contato.linkWhatsapp}?text=${encodeURIComponent(MENSAGEM)}` : null;
  const linkEmail = `${contato.linkEmail}?subject=${encodeURIComponent("Teste grátis do Frivo")}&body=${encodeURIComponent(MENSAGEM)}`;
  const botao = "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg px-6 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2 sm:w-auto";

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[1fr_1.1fr] lg:gap-14" data-teste-gratis-provisorio>
      <div>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">{CTA.principal}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-muted sm:text-lg">{CTA.apoio}</p>

        <ol className="mt-8 space-y-4" data-passos-teste>
          {passos(!!linkWhatsapp).map((p, i) => (
            <li key={p.titulo} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-acento font-display text-base font-bold tabular-nums text-white">{i + 1}</span>
              <div>
                <p className="font-display text-base font-semibold text-ink">{p.titulo}</p>
                <p className="mt-0.5 text-[15px] leading-relaxed text-ink-muted">{p.texto}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {linkWhatsapp && (
            <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer" data-pedir-acesso="whatsapp" className={`${botao} bg-acento text-white hover:bg-acento-hover`}>
              <MessageCircle className="h-5 w-5" aria-hidden /> Pedir acesso pelo WhatsApp
            </a>
          )}
          <a
            href={linkEmail}
            data-pedir-acesso="email"
            className={linkWhatsapp ? `${botao} border border-surface-border bg-white text-ink hover:bg-surface-page` : `${botao} bg-acento text-white hover:bg-acento-hover`}
          >
            <Mail className="h-5 w-5" aria-hidden /> Pedir acesso por e-mail
          </a>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Ou escreva para <a href={contato.linkEmail} className="font-medium text-acento underline-offset-2 hover:underline">{contato.email}</a>.
        </p>

        <p className="mt-8">
          <Link href="/" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-acento">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar para o início
          </Link>
        </p>
      </div>

      <Notebook print={PRINTS.dashboard} sizes="(min-width: 1024px) 540px, 92vw" className="hidden px-[3%] sm:block" />
    </div>
  );
}
