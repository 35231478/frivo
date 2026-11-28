"use client";

import { confirmar } from "@/components/ui/avisos";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { PERMISSOES_PORTAL, whatsappLink } from "@/lib/utils";
import { mensagemDoAcesso } from "@/lib/portal/senha-provisoria";
import { KeyRound, Mail, MessageCircle, Check, AlertCircle, ShieldOff, Copy, RefreshCw } from "lucide-react";

export interface AcessoChange {
  temAcesso: boolean;
  senhaProvisoria: string | null;
  acessoConcedidoEm: string | null;
}

interface Props {
  clienteId: string;
  contatoId: string;
  contatoNome: string;
  emailInicial?: string | null;
  whatsappInicial?: string | null;
  temAcesso: boolean;
  acessoConcedidoEmInicial?: string | Date | null;
  permissoesIniciais?: Record<string, boolean> | null;
  onChange?: (info: AcessoChange) => void;
}

export function PortalAcessoContato({
  clienteId, contatoId, contatoNome, emailInicial, whatsappInicial,
  temAcesso: temAcessoInicial, acessoConcedidoEmInicial, permissoesIniciais, onChange,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState(emailInicial ?? "");
  const [temAcesso, setTemAcesso] = useState(temAcessoInicial);
  // A senha provisória é GERADA pelo sistema e só existe aqui logo depois de gerada: o servidor guarda
  // apenas o hash. Fechou o quadro ou recarregou a tela, ela some (gera-se outra, se precisar).
  const [senhaProvisoria, setSenhaProvisoria] = useState<string | null>(null);
  const [copiou, setCopiou] = useState(false);
  // UX-5 (C1): acesso NOVO já nasce vendo o essencial — inclusive as FATURAS (o portal
  // existe para o boleto se entregar sozinho). O gestor desmarca o que não quiser.
  const PERMISSOES_PADRAO_CONCESSAO: Record<string, boolean> = {
    verOS: true, abrirChamados: true, verDocumentos: true, verEquipamentos: true,
    verFinanceiro: true, verBoletos: true, verValores: true,
  };
  const [perms, setPerms] = useState<Record<string, boolean>>(
    permissoesIniciais ?? (temAcessoInicial ? {} : PERMISSOES_PADRAO_CONCESSAO),
  );
  const [salvando, setSalvando] = useState(false);
  const [acao, setAcao] = useState<"salvar" | "gerar" | "revogar" | null>(null);
  const [fb, setFb] = useState<{ t: "ok" | "erro"; m: string } | null>(null);

  const linkPortal = typeof window !== "undefined" ? `${window.location.origin}/portal/login` : "/portal/login";

  function notificar(info: Partial<AcessoChange>) {
    onChange?.({ temAcesso, senhaProvisoria, acessoConcedidoEm: null, ...info });
  }

  async function salvar() {
    setFb(null);
    if (!email) { setFb({ t: "erro", m: "Informe o e-mail de acesso." }); return; }
    setSalvando(true); setAcao("salvar");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ativo: true, permissoes: perms }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setFb({ t: "erro", m: e.erro ?? "Erro ao salvar." }); return; }
      const data = await res.json().catch(() => ({}));
      setTemAcesso(true);
      if (data.senhaProvisoria) { setSenhaProvisoria(data.senhaProvisoria); setCopiou(false); }
      setFb({ t: "ok", m: data.senhaProvisoria ? "Acesso liberado. Repasse a senha provisória abaixo." : "Acesso atualizado." });
      onChange?.({ temAcesso: true, senhaProvisoria: data.senhaProvisoria ?? null, acessoConcedidoEm: data.acessoConcedidoEm ?? null });
    } catch { setFb({ t: "erro", m: "Erro de conexão." }); } finally { setSalvando(false); setAcao(null); }
  }

  async function gerarNova() {
    if (!(await confirmar({ mensagem: "Gerar uma nova senha provisória? A senha atual deixa de valer e o contato cria uma nova no próximo acesso.", confirmarTexto: "Gerar nova senha" }))) return;
    setFb(null); setSalvando(true); setAcao("gerar");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, { method: "POST" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setFb({ t: "erro", m: e.erro ?? "Erro ao gerar a senha." }); return; }
      const data = await res.json();
      setTemAcesso(true); setSenhaProvisoria(data.senhaProvisoria ?? null); setCopiou(false);
      setFb({ t: "ok", m: "Nova senha provisória gerada. Repasse ao contato." });
      onChange?.({ temAcesso: true, senhaProvisoria: data.senhaProvisoria ?? null, acessoConcedidoEm: data.acessoConcedidoEm ?? null });
    } catch { setFb({ t: "erro", m: "Erro de conexão." }); } finally { setSalvando(false); setAcao(null); }
  }

  async function copiar() {
    if (!senhaProvisoria) return;
    try { await navigator.clipboard.writeText(senhaProvisoria); setCopiou(true); } catch { setFb({ t: "erro", m: "Não foi possível copiar. Selecione a senha e copie." }); }
  }

  async function revogar() {
    if (!(await confirmar({ mensagem: "Revogar o acesso ao portal deste contato?", perigo: true, confirmarTexto: "Revogar acesso" }))) return;
    setSalvando(true); setAcao("revogar");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, { method: "DELETE" });
      if (res.ok) {
        setTemAcesso(false); setSenhaProvisoria(null);
        setFb({ t: "ok", m: "Acesso revogado." });
        onChange?.({ temAcesso: false, senhaProvisoria: null, acessoConcedidoEm: null });
      } else {
        const e = await res.json().catch(() => ({}));
        setFb({ t: "erro", m: e.erro ?? "Não foi possível revogar o acesso." });
      }
    } catch { setFb({ t: "erro", m: "Erro de conexão." }); } finally { setSalvando(false); setAcao(null); }
  }

  const msgConvite = mensagemDoAcesso({ contatoNome, link: linkPortal, email, senha: senhaProvisoria });
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Acesso ao Portal do Cliente")}&body=${encodeURIComponent(msgConvite)}`;
  const wpp = whatsappInicial ? whatsappLink(whatsappInicial, msgConvite) : `https://wa.me/?text=${encodeURIComponent(msgConvite)}`;

  if (!aberto) {
    return (
      <Button type="button" variant="secondary" onClick={() => setAberto(true)} className="text-xs h-7 px-2.5">
        <KeyRound className="w-3 h-3" /> {temAcesso ? "Gerenciar acesso ao portal" : "Dar acesso ao portal"}
      </Button>
    );
  }

  return (
    <div className="mt-2 border border-primary-200 bg-primary-50/30 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-primary-700 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" /> Acesso ao portal
          {temAcesso && <span className="text-[10px] bg-success-50 text-success-700 px-1.5 py-0.5 rounded">Acesso ativo</span>}
        </p>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-ink-muted hover:text-ink min-h-[44px] min-w-[44px] -my-3 px-2" data-fechar-acesso>Fechar</button>
      </div>

      {fb && (
        <div className={fb.t === "ok" ? "bg-success-50 border border-success-200 text-success-700 text-xs rounded px-2 py-1.5 flex items-center gap-1.5" : "bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-xs rounded px-2 py-1.5 flex items-center gap-1.5"}>
          {fb.t === "ok" ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {fb.m}
        </div>
      )}

      {/* Credenciais (quando já tem acesso) */}
      {temAcesso && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white border border-surface-border rounded-lg p-2.5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-ink-muted">E-mail de login</p>
            <p className="text-sm text-ink truncate flex items-center gap-1"><Mail className="w-3 h-3 text-ink-subtle" /> {email}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-ink-muted">Senha provisória</p>
            {senhaProvisoria ? (
              <div data-senha-provisoria>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-ink select-all" data-senha-gerada>{senhaProvisoria}</span>
                  <button type="button" onClick={copiar} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800 min-h-[32px] px-1" data-copiar-senha>
                    {copiou ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copiou ? "Copiada" : "Copiar"}
                  </button>
                </div>
                <p className="text-[11px] text-atencao-texto">Aparece só agora. O contato cria a própria senha no 1º acesso.</p>
              </div>
            ) : (
              <p className="text-xs text-ink-muted" data-senha-nao-exibida>Não fica guardada. Para enviar uma senha ao contato, gere uma nova.</p>
            )}
          </div>
        </div>
      )}

      {/* E-mail de acesso (a senha é gerada pelo sistema ao liberar) */}
      <div>
        <label className="text-[11px] font-semibold text-ink">E-mail de acesso</label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@cliente.com" />
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink mb-1">Permissões</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 divide-y divide-surface-linha sm:divide-y-0">
          {PERMISSOES_PORTAL.map((p) => (
            <ToggleSwitch key={p.chave} label={p.label} checked={!!perms[p.chave]} onChange={(v) => setPerms((s) => ({ ...s, [p.chave]: v }))} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" loading={salvando && acao === "salvar"} onClick={salvar} className="text-xs h-8" data-salvar-acesso><Check className="w-3.5 h-3.5" /> {temAcesso ? "Salvar acesso" : "Liberar acesso"}</Button>
        {temAcesso && (
          <>
            <Button type="button" variant="secondary" loading={salvando && acao === "gerar"} onClick={gerarNova} className="text-xs h-8" data-gerar-senha><RefreshCw className="w-3.5 h-3.5" /> Gerar nova senha provisória</Button>
            <a href={mailto} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700" data-convite-email><Mail className="w-3.5 h-3.5" /> Convite e-mail</a>
            <a href={wpp} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-success-700 hover:text-success-800" data-convite-whatsapp><MessageCircle className="w-3.5 h-3.5" /> Convite WhatsApp</a>
            <button type="button" onClick={revogar} className="inline-flex items-center gap-1 text-xs font-medium text-atrasado hover:text-atrasado-texto ml-auto"><ShieldOff className="w-3.5 h-3.5" /> Revogar acesso</button>
          </>
        )}
      </div>
    </div>
  );
}
