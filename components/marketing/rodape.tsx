import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { CONTATO, LINK_EMAIL, LINK_WHATSAPP, RODAPE_LINKS } from "./conteudo";

/** Rodapé da home de vendas. O contato vem de CONTATO (./conteudo): WhatsApp abre a conversa, e-mail abre o programa de e-mail. */
export function Rodape() {
  const ano = new Date().getFullYear();
  return (
    <footer className="border-t border-surface-border bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <FrivoLogo size="md" variant="dark" showSubtitle={false} />
            <p className="mt-3 max-w-xs text-sm text-ink-muted">Sistema de gestão para climatização e refrigeração.</p>
          </div>

          <nav aria-label="Rodapé" className="flex flex-col">
            {RODAPE_LINKS.map((l) =>
              l.href.startsWith("#") ? (
                <a key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center text-sm text-ink hover:text-acento">{l.rotulo}</a>
              ) : (
                <Link key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center text-sm text-ink hover:text-acento">{l.rotulo}</Link>
              ),
            )}
          </nav>

          <div id="contato" className="flex scroll-mt-24 flex-col">
            <span className="label-uppercase mb-1">Contato</span>
            <a href={LINK_WHATSAPP} target="_blank" rel="noopener noreferrer" data-contato="whatsapp" className="inline-flex min-h-[44px] items-center gap-2 text-sm text-ink hover:text-acento">
              <MessageCircle className="h-4 w-4 text-ink-subtle" aria-hidden /> WhatsApp {CONTATO.whatsapp}
            </a>
            <a href={LINK_EMAIL} data-contato="email" className="inline-flex min-h-[44px] items-center gap-2 break-all text-sm text-ink hover:text-acento">
              <Mail className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden /> {CONTATO.email}
            </a>
          </div>
        </div>

        <p className="mt-8 border-t border-surface-border pt-6 text-xs text-ink-muted">© {ano} Frivo</p>
      </div>
    </footer>
  );
}
