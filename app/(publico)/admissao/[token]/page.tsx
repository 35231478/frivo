import type { Metadata } from "next";
import { AlertCircle, UserPlus } from "lucide-react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { ErroAdmissao, abrirAdmissao } from "@/lib/admissao/admissao-server";
import { MSG_LINK_INVALIDO } from "@/lib/admissao/admissao";
import { AdmissaoPublicaCliente } from "@/components/admissao/admissao-publica";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admissão", robots: { index: false, follow: false } };

/**
 * O LINK da admissão digital: sem login, quem tem o token preenche a própria ficha, manda os
 * documentos e assina o contrato. A página carrega só o que é daquela pessoa (o servidor decide) e
 * o resto é a tela em etapas, feita para o celular.
 *
 * Link que não serve (não existe, venceu, foi cancelado) não mostra tela de erro técnica: diz o que
 * aconteceu e manda falar com quem enviou.
 */
export default async function AdmissaoPublicaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let dados;
  let recusa: string | null = null;
  try {
    dados = await abrirAdmissao(token);
  } catch (e) {
    recusa = e instanceof ErroAdmissao ? e.message : MSG_LINK_INVALIDO;
  }

  return (
    <div className="min-h-screen flex flex-col" data-pagina-admissao={dados ? dados.situacao : "RECUSADO"}>
      <header className="bg-white border-b border-surface-border py-4 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <FrivoLogo size="sm" showSubtitle={false} variant="dark" />
          {dados && (
            <span className="text-xs text-ink-muted truncate" data-admissao-empresa>{dados.empresa}</span>
          )}
        </div>
      </header>

      <main className="flex-1 py-5 px-3 sm:px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {recusa || !dados ? (
            <section className="bg-white rounded-card shadow-card p-6 text-center space-y-3" data-admissao-recusado>
              <div className="mx-auto w-12 h-12 rounded-full bg-atencao-claro flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-atencao-texto" aria-hidden />
              </div>
              <h1 className="font-display text-xl font-bold text-ink">Link indisponível</h1>
              <p className="text-sm text-ink-muted">{recusa ?? MSG_LINK_INVALIDO}</p>
            </section>
          ) : (
            <>
              <section className="bg-white rounded-card shadow-card p-5 space-y-1" data-admissao-cabecalho>
                <p className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" aria-hidden /> Admissão · {dados.empresa}
                </p>
                <h1 className="font-display text-2xl font-bold text-ink" data-admissao-nome>{dados.colaborador.nome}</h1>
                <p className="text-sm text-ink-muted">
                  {[dados.colaborador.cargo, dados.colaborador.cpfMascarado].filter(Boolean).join(" · ")}
                </p>
              </section>
              <AdmissaoPublicaCliente token={token} inicial={dados} />
            </>
          )}
        </div>
      </main>

      <footer className="py-4 px-4 text-center text-xs text-ink-subtle">
        Os seus dados são usados somente para esta admissão.
      </footer>
    </div>
  );
}
