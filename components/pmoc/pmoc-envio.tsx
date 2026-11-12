"use client";

import { useState } from "react";
import { Copy, Download, Mail, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { abaPendente } from "@/components/orcamento/envio-proposta";
import type { CanalEnvio } from "@/lib/pmoc-avisos";

export interface DestinoEnvio { contato: string | null; whatsapp: string | null; email: string | null }
interface RespostaEnvio { erro?: string; publicUrl?: string; whatsappUrl?: string; mailtoUrl?: string; emailEnviado?: boolean; erroEmail?: string | null; para?: string | null }

/** "Baixar documento": o PDF do plano, gerado no servidor na hora */
export function PmocBaixarDocumento({ pmocId }: { pmocId: string }) {
  return (
    <a href={`/api/pmocs/${pmocId}/documento`} data-baixar-documento
      className="inline-flex items-center gap-1.5 text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-ink hover:bg-surface-alt font-medium">
      <Download className="w-4 h-4" /> Baixar documento
    </a>
  );
}

/**
 * "Enviar ao cliente": o link público do documento por WhatsApp (wa.me), por e-mail ou copiado.
 * `bloqueio` é o motivo de não poder enviar agora (plano em rascunho ou inativo). Cada envio fica no
 * histórico do plano; `aoEnviar` avisa a tela para reler o histórico.
 */
export function PmocEnviar({ pmocId, bloqueio, destino, aoEnviar }: { pmocId: string; bloqueio: string | null; destino?: DestinoEnvio; aoEnviar?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState<CanalEnvio | null>(null);
  const [erro, setErro] = useState("");

  async function pedir(canal: CanalEnvio): Promise<RespostaEnvio | null> {
    setErro(""); setEnviando(canal);
    try {
      const res = await fetch(`/api/pmocs/${pmocId}/enviar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal }) });
      const d: RespostaEnvio = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível enviar."); return null; }
      aoEnviar?.();
      return d;
    } catch { setErro("Erro de conexão."); return null; } finally { setEnviando(null); }
  }

  async function whatsapp() {
    const aba = abaPendente(); // abre já no clique: depois de esperar o servidor, o navegador bloquearia
    const d = await pedir("WHATSAPP");
    if (!d?.whatsappUrl) { aba.fechar(); return; }
    aba.ir(d.whatsappUrl);
    toast(d.para ? `Conversa aberta com ${d.para}.` : "WhatsApp aberto: escolha o contato do cliente.", d.para ? "sucesso" : "info");
    setAberto(false);
  }
  async function email() {
    const d = await pedir("EMAIL");
    if (!d) return;
    if (d.emailEnviado) { toast(`E-mail enviado para ${d.para}.`); setAberto(false); return; }
    if (d.erroEmail) { setErro(d.erroEmail); return; }
    if (d.mailtoUrl) window.location.href = d.mailtoUrl;
    toast("E-mail da empresa não configurado: o programa de e-mail foi aberto com a mensagem.", "info");
    setAberto(false);
  }
  async function link() {
    const d = await pedir("LINK");
    if (!d?.publicUrl) return;
    try { await navigator.clipboard.writeText(d.publicUrl); toast("Link copiado."); setAberto(false); }
    catch { setErro(`Copie o link: ${d.publicUrl}`); }
  }

  return (
    <>
      <button type="button" onClick={() => { setErro(""); setAberto(true); }} data-enviar-cliente
        className="inline-flex items-center gap-1.5 text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-ink hover:bg-surface-alt font-medium">
        <Send className="w-4 h-4" /> Enviar ao cliente
      </button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Enviar ao cliente">
        <div className="space-y-4" data-modal-enviar>
          {bloqueio ? <p className="text-sm text-ink" data-envio-bloqueado>{bloqueio}</p> : (
            <>
              <p className="text-sm text-ink-muted">O cliente recebe um link para abrir o documento em PDF. Cada envio fica no histórico do plano.</p>
              {destino && (
                <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-destino-envio>
                  <dt className="text-ink-muted">WhatsApp</dt>
                  <dd className="text-ink break-words">{destino.whatsapp ? [destino.whatsapp, destino.contato].filter(Boolean).join(" · ") : "Sem número no cadastro: o contato é escolhido na conversa."}</dd>
                  <dt className="text-ink-muted">E-mail</dt>
                  <dd className="text-ink break-words">{destino.email ?? "Sem e-mail no cadastro do cliente."}</dd>
                </dl>
              )}
              <div className="grid gap-2">
                <Button type="button" variant="secondary" loading={enviando === "WHATSAPP"} disabled={!!enviando} onClick={whatsapp} data-canal="WHATSAPP"><MessageCircle className="w-4 h-4" /> Enviar por WhatsApp</Button>
                <Button type="button" variant="secondary" loading={enviando === "EMAIL"} disabled={!!enviando} onClick={email} data-canal="EMAIL"><Mail className="w-4 h-4" /> Enviar por e-mail</Button>
                <Button type="button" variant="secondary" loading={enviando === "LINK"} disabled={!!enviando} onClick={link} data-canal="LINK"><Copy className="w-4 h-4" /> Copiar link</Button>
              </div>
            </>
          )}
          {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2 break-words" data-erro-envio>{erro}</p>}
          <div className="flex justify-end pt-2 border-t border-surface-border">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Fechar</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
