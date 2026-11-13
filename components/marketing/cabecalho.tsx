import Link from "next/link";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { BotaoTeste } from "./botao-teste";
import { CTA, LINK_ENTRAR, MENU } from "./conteudo";

/** Cabeçalho fixo da home de vendas: logo, âncoras (no computador), Entrar e o CTA sempre à mão. */
export function Cabecalho() {
  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Frivo — início" className="inline-flex min-h-[44px] items-center rounded-lg">
          <FrivoLogo size="md" variant="dark" showSubtitle={false} />
        </Link>

        <nav aria-label="Seções" className="hidden items-center gap-1 md:flex">
          {MENU.map((m) => (
            <a key={m.href} href={m.href} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:text-acento">
              {m.rotulo}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          <Link href={LINK_ENTRAR} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-ink-muted hover:text-acento">
            Entrar
          </Link>
          <BotaoTeste local="cabecalho" tamanho="medio" rotulo={CTA.curto} className="sm:hidden" />
          <BotaoTeste local="cabecalho" tamanho="medio" className="hidden sm:inline-flex" />
        </div>
      </div>
    </header>
  );
}
