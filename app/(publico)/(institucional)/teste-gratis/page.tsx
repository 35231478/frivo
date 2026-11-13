import type { Metadata } from "next";
import Link from "next/link";
import { CONTATO } from "@/components/marketing/conteudo";

// Destino PROVISÓRIO do CTA da home de vendas ("Teste grátis por 7 dias"). O Frivo ainda não tem o
// cadastro automático da empresa; até ele existir, esta página encaminha para o contato (PLACEHOLDER
// em components/marketing/conteudo.ts). Quando o cadastro entrar, troca-se LINK_TESTE_GRATIS (ou esta
// página vira o formulário).
export const metadata: Metadata = {
  title: "Teste grátis por 7 dias",
  description: "Teste o Frivo por 7 dias, sem cartão de crédito.",
  robots: { index: false, follow: false },
};

export default function TesteGratisPage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-14 sm:py-20" data-teste-gratis-provisorio>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Teste grátis por 7 dias</h1>
      <p className="mt-3 text-base leading-relaxed text-ink-muted">
        Sem cartão de crédito. Fale com a gente e liberamos o acesso de teste para a sua empresa.
      </p>
      <dl className="mt-8 divide-y divide-surface-border rounded-card border border-surface-border bg-white" data-contato-pendente>
        <div className="flex min-h-[56px] items-center justify-between gap-4 px-5">
          <dt className="text-sm text-ink-muted">WhatsApp</dt>
          <dd className="font-medium text-ink">{CONTATO.whatsapp}</dd>
        </div>
        <div className="flex min-h-[56px] items-center justify-between gap-4 px-5">
          <dt className="text-sm text-ink-muted">E-mail</dt>
          <dd className="font-medium text-ink">{CONTATO.email}</dd>
        </div>
      </dl>
      <p className="mt-6 text-sm">
        <Link href="/" className="inline-flex min-h-[44px] items-center font-medium text-acento underline-offset-2 hover:underline">
          Voltar para o início
        </Link>
      </p>
    </div>
  );
}
