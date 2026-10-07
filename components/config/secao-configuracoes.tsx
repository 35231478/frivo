import Link from "next/link";
import { ChevronRight, Settings } from "lucide-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { secoesVisiveis, type SecaoConfigId } from "@/lib/navegacao/configuracoes";

/**
 * Tela de uma seção de Configurações (operacionais, financeiras ou conta): abas com as 3 seções
 * e os subgrupos da seção em cartões, cada item com uma linha explicando para que serve.
 * Mostra só o que o perfil pode ver (mesma regra do menu lateral).
 */
export async function SecaoConfiguracoes({ id }: { id: SecaoConfigId }) {
  const session = await auth();
  const secoes = secoesVisiveis(session?.user?.permissoes, session?.user?.role);
  const secao = secoes.find((s) => s.id === id);

  return (
    <div className="space-y-6 max-w-6xl" data-secao-config={id}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><Settings className="w-5 h-5 text-primary-600" /></div>
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">Ajustes do sistema organizados por assunto</p>
        </div>
      </div>

      {/* Abas: as 3 seções (só as que o perfil pode ver) */}
      {secoes.length > 1 && (
        <nav className={cn("grid gap-2", secoes.length === 3 ? "grid-cols-3" : "grid-cols-2")} aria-label="Seções de configurações">
          {secoes.map((s) => {
            const ativa = s.id === id;
            return (
              <Link key={s.id} href={s.href} aria-current={ativa ? "page" : undefined}
                className={cn(
                  "flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-xl border px-2 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors text-center",
                  ativa ? "bg-primary-500 border-primary-500 text-white shadow-sm" : "bg-white border-surface-border text-ink-muted hover:text-ink hover:border-primary-200",
                )}>
                <s.icone className="w-5 h-5 sm:w-4 sm:h-4 shrink-0" />
                <span className="sm:hidden">{s.curto}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {!secao ? (
        <div className="bg-white rounded-xl border border-dashed border-surface-border p-10 text-center text-sm text-ink-muted">
          Seu perfil de acesso não libera nenhum item desta seção.
        </div>
      ) : (
        <section className="space-y-6" aria-labelledby="titulo-secao">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-sidebar text-white shrink-0"><secao.icone className="w-5 h-5" /></div>
            <div className="min-w-0">
              <h2 id="titulo-secao" className="text-lg font-semibold text-ink">{secao.label}</h2>
              <p className="text-sm text-ink-muted">{secao.descricao}</p>
            </div>
          </div>

          {secao.subgrupos.map((g) => (
            <div key={g.titulo} className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted" data-subgrupo>{g.titulo}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.itens.map((i) => (
                  <Link key={i.href} href={i.href}
                    className="group flex items-center gap-3 rounded-xl border border-surface-border bg-white p-3.5 sm:p-4 shadow-card hover:border-primary-300 hover:shadow-card-hover transition-all min-w-0">
                    <span className="p-2 rounded-lg bg-primary-50 text-primary-600 shrink-0"><i.icone className="w-5 h-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink group-hover:text-primary-700">{i.label}</span>
                      <span className="block text-xs text-ink-muted leading-snug">{i.dica}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 group-hover:text-primary-500" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
