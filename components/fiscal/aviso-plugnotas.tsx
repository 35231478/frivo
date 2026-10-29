"use client";

import { useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Copy, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { confirmar, toast } from "@/components/ui/avisos";
import { formatarDataHora } from "@/lib/utils";
import { LABEL_AMBIENTE } from "@/lib/nfse/regras";
import type { SituacaoWebhook } from "@/lib/nfse/webhook-server";

/**
 * Aviso automático (webhook) do PlugNotas em Dados fiscais: liga/gira a URL da empresa e mostra se
 * o PlugNotas aceitou o cadastro e quando chegou o último aviso. A URL (com o segredo) aparece só
 * logo depois de gerada; girar invalida a anterior. Sem o aviso, o Frivo confere sozinho.
 */
export function AvisoPlugNotas({ webhook: w, onAtualizar }: { webhook: SituacaoWebhook; onAtualizar: (w: SituacaoWebhook) => void }) {
  const [gerando, setGerando] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    if (w.ativo && !(await confirmar({
      titulo: "Gerar nova URL?", confirmarTexto: "Gerar nova URL",
      mensagem: "A URL atual para de valer na hora. A nova é cadastrada no PlugNotas automaticamente (se ele aceitar).",
    }))) return;
    setGerando(true); setErro(null); setUrl(null);
    try {
      const r = await fetch("/api/fiscal/webhook", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível gerar a URL."); return; }
      setUrl(d.url);
      onAtualizar(d.webhook);
      if (d.registrado) toast("Aviso automático ligado no PlugNotas.");
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setGerando(false); }
  }

  async function copiar() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast("URL copiada."); } catch { toast("Não foi possível copiar. Selecione e copie a URL.", "erro"); }
  }

  const pendente = w.ativo && !w.registradoEm;
  return (
    <section className="rounded-card border border-surface-border p-4 space-y-3" data-aviso-plugnotas aria-labelledby="titulo-aviso-plugnotas">
      <div className="flex flex-wrap items-center gap-2">
        <BellRing className="w-4 h-4 text-acento" />
        <h3 id="titulo-aviso-plugnotas" className="text-sm font-semibold text-ink">Aviso automático do PlugNotas</h3>
        <StatusPill tom={!w.ativo ? "previsto" : pendente || w.desatualizado ? "atencao" : "ok"} data-situacao-webhook={!w.ativo ? "desligado" : pendente ? "pendente" : w.desatualizado ? "desatualizado" : "ligado"}>
          {!w.ativo ? "Desligado" : pendente ? "Cadastro pendente no PlugNotas" : w.desatualizado ? "Gere de novo (ambiente mudou)" : "Ligado"}
        </StatusPill>
        <Button variant="secondary" size="sm" className="sm:ml-auto" onClick={gerar} disabled={!w.podeGerar || gerando} loading={gerando} data-gerar-webhook>
          {w.ativo ? <><RefreshCw className="w-4 h-4" /> Gerar nova URL</> : <><BellRing className="w-4 h-4" /> Ligar aviso automático</>}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        Quando a prefeitura autoriza ou recusa uma nota, o PlugNotas avisa o Frivo na hora e a nota se atualiza sozinha.
        Sem o aviso, o Frivo confere as notas paradas de tempos em tempos.
      </p>
      {!w.podeGerar && (
        <p className="text-xs text-ink-muted flex items-start gap-1.5" data-webhook-sem-emitente>
          <Info className="w-3.5 h-3.5 mt-px shrink-0" /> Salve os dados fiscais abaixo (cadastro da empresa no PlugNotas) para ligar o aviso.
        </p>
      )}
      {w.ativo && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div><dt className="text-ink-muted">URL gerada em</dt>
            <dd className="text-ink" data-webhook-gerado>{w.geradoEm ? formatarDataHora(w.geradoEm) : "—"}{w.ambiente && ` · ${LABEL_AMBIENTE[w.ambiente]}`}</dd></div>
          <div><dt className="text-ink-muted">Último aviso recebido</dt>
            <dd className="text-ink" data-webhook-recebido>{w.recebidoEm ? formatarDataHora(w.recebidoEm) : "Nenhum ainda"}</dd></div>
        </dl>
      )}
      {w.ativo && w.registradoEm && !url && (
        <p className="text-xs text-ok-texto flex items-start gap-1.5" data-webhook-registrado>
          <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" /> Cadastrado no PlugNotas em {formatarDataHora(w.registradoEm)}. Por segurança, a URL não é mostrada de novo.
        </p>
      )}
      {pendente && w.erro && (
        <p className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2 flex items-start gap-1.5" data-webhook-erro>
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>O PlugNotas não aceitou o cadastro automático: {w.erro} A URL vale do nosso lado: cole-a no painel do PlugNotas (Webhook da empresa) ou tente gerar de novo.</span>
        </p>
      )}
      {url && (
        <div className="rounded-lg border border-atencao/20 bg-atencao-claro p-3 space-y-2" data-webhook-url>
          <p className="text-xs font-semibold text-atencao-texto">Esta URL leva o segredo da empresa e só aparece agora. Gerar outra invalida esta.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1.5 text-xs break-all select-all border border-surface-border">{url}</code>
            <Button variant="secondary" size="sm" onClick={copiar} data-copiar-webhook><Copy className="w-4 h-4" /> Copiar</Button>
          </div>
        </div>
      )}
      {erro && <p role="alert" className="text-xs font-medium text-atrasado" data-webhook-falha>{erro}</p>}
    </section>
  );
}
