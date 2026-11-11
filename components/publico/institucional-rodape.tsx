import Link from "next/link";
import { FrivoLogo } from "@/components/layout/frivo-logo";

// Rodapé das páginas públicas institucionais (Privacidade · FAQ · Termos).
// Contato fica como PLACEHOLDER até a empresa informar — preserve os colchetes.
const CONTATO_WHATSAPP = "[número]";
const CONTATO_EMAIL = "[e-mail]";

const paginas = [
  { href: "/privacidade", rotulo: "Privacidade" },
  { href: "/faq", rotulo: "FAQ" },
  { href: "/termos", rotulo: "Termos" },
];

export function InstitucionalRodape() {
  const ano = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-surface-border bg-white">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <FrivoLogo size="md" variant="dark" showSubtitle />
            <p className="mt-3 max-w-xs text-sm text-ink-muted">
              Sistema de gestão para climatização e refrigeração.
            </p>
          </div>

          <nav aria-label="Páginas" className="flex flex-col gap-1">
            <span className="label-uppercase mb-1">Páginas</span>
            {paginas.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="inline-flex min-h-[44px] items-center text-sm text-ink hover:text-acento"
              >
                {p.rotulo}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col gap-1">
            <span className="label-uppercase mb-1">Contato</span>
            <span className="inline-flex min-h-[44px] items-center text-sm text-ink-muted">
              WhatsApp {CONTATO_WHATSAPP}
            </span>
            <span className="inline-flex min-h-[44px] items-center text-sm text-ink-muted">
              E-mail {CONTATO_EMAIL}
            </span>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-surface-border pt-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© {ano} Frivo · by Termofrio</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {paginas.map((p) => (
              <Link key={p.href} href={p.href} className="hover:text-acento">
                {p.rotulo}
              </Link>
            ))}
          </span>
        </div>
      </div>
    </footer>
  );
}
