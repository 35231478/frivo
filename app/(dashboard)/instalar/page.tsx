import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Smartphone, Share, MoreVertical, PlusSquare } from "lucide-react";

export const metadata: Metadata = { title: "Instalar o app" };

export default function InstalarPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="Instalar o Frivo no celular" description="Use o Frivo como um app, direto na tela inicial" backHref="/dashboard" />

      <div className="card-padded flex items-center gap-4">
        <div className="p-3 bg-primary-50 rounded-xl shrink-0">
          <Smartphone className="w-6 h-6 text-primary-600" />
        </div>
        <p className="text-sm text-ink-muted">
          Instalando o Frivo, ele abre em tela cheia (sem a barra do navegador), carrega mais rápido e
          funciona offline para as telas já visitadas.
        </p>
      </div>

      {/* Android */}
      <div className="card-padded space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-success-600" />
          <h2 className="section-title">Android (Google Chrome)</h2>
        </div>
        <ol className="space-y-3">
          <PassoItem n={1} icone={<MoreVertical className="w-4 h-4" />}>
            Toque nos <strong>3 pontos</strong> no canto superior direito do Chrome.
          </PassoItem>
          <PassoItem n={2} icone={<PlusSquare className="w-4 h-4" />}>
            Selecione <strong>“Adicionar à tela inicial”</strong> (ou “Instalar app”).
          </PassoItem>
          <PassoItem n={3}>
            Confirme em <strong>“Adicionar”</strong>. O ícone do Frivo aparecerá na sua tela inicial.
          </PassoItem>
        </ol>
      </div>

      {/* iOS */}
      <div className="card-padded space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-ink" />
          <h2 className="section-title">iPhone / iPad (Safari)</h2>
        </div>
        <ol className="space-y-3">
          <PassoItem n={1} icone={<Share className="w-4 h-4" />}>
            Toque no ícone de <strong>Compartilhar</strong> (quadrado com seta para cima), na barra inferior.
          </PassoItem>
          <PassoItem n={2} icone={<PlusSquare className="w-4 h-4" />}>
            Role e toque em <strong>“Adicionar à Tela de Início”</strong>.
          </PassoItem>
          <PassoItem n={3}>
            Toque em <strong>“Adicionar”</strong> no canto superior direito.
          </PassoItem>
        </ol>
        <p className="text-xs text-ink-subtle">No iPhone, a instalação só funciona pelo navegador Safari.</p>
      </div>
    </div>
  );
}

function PassoItem({ n, icone, children }: { n: number; icone?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
      <span className="text-sm text-ink flex items-center gap-1.5 flex-wrap">
        {icone && <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-surface-alt text-ink-muted">{icone}</span>}
        <span>{children}</span>
      </span>
    </li>
  );
}
