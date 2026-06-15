"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { PERMISSOES_PORTAL, whatsappLink } from "@/lib/utils";
import { KeyRound, Mail, MessageCircle, Check, AlertCircle, ShieldOff, Eye, EyeOff, RefreshCw } from "lucide-react";

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
  senhaProvisoriaInicial?: string | null;
  acessoConcedidoEmInicial?: string | Date | null;
  permissoesIniciais?: Record<string, boolean> | null;
  onChange?: (info: AcessoChange) => void;
}

export function PortalAcessoContato({
  clienteId, contatoId, contatoNome, emailInicial, whatsappInicial,
  temAcesso: temAcessoInicial, senhaProvisoriaInicial, acessoConcedidoEmInicial, permissoesIniciais, onChange,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState(emailInicial ?? "");
  const [senha, setSenha] = useState("");
  const [temAcesso, setTemAcesso] = useState(temAcessoInicial);
  const [senhaProvisoria, setSenhaProvisoria] = useState<string | null>(senhaProvisoriaInicial ?? null);
  const [revelar, setRevelar] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>(permissoesIniciais ?? {});
  const [salvando, setSalvando] = useState(false);
  const [acao, setAcao] = useState<"salvar" | "redefinir" | "revogar" | null>(null);
  const [fb, setFb] = useState<{ t: "ok" | "erro"; m: string } | null>(null);

  const linkPortal = typeof window !== "undefined" ? `${window.location.origin}/portal/login` : "/portal/login";

  function notificar(info: Partial<AcessoChange>) {
    onChange?.({ temAcesso, senhaProvisoria, acessoConcedidoEm: null, ...info });
  }

  async function salvar() {
    setFb(null);
    if (!email) { setFb({ t: "erro", m: "Informe o e-mail de acesso." }); return; }
    if (!temAcesso && senha.length < 4) { setFb({ t: "erro", m: "Defina uma senha (mín. 4 caracteres)." }); return; }
    setSalvando(true); setAcao("salvar");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha: senha || undefined, ativo: true, permissoes: perms }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setFb({ t: "erro", m: e.erro ?? "Erro ao salvar." }); return; }
      const data = await res.json().catch(() => ({}));
      setTemAcesso(true); setSenha("");
      if (data.senhaProvisoria) setSenhaProvisoria(data.senhaProvisoria);
      setFb({ t: "ok", m: "Acesso concedido!" });
      onChange?.({ temAcesso: true, senhaProvisoria: data.senhaProvisoria ?? senhaProvisoria, acessoConcedidoEm: data.acessoConcedidoEm ?? null });
    } catch { setFb({ t: "erro", m: "Erro de conexão." }); } finally { setSalvando(false); setAcao(null); }
  }

  async function redefinir() {
    setFb(null); setSalvando(true); setAcao("redefinir");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, { method: "POST" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setFb({ t: "erro", m: e.erro ?? "Erro ao redefinir." }); return; }
      const data = await res.json();
      setTemAcesso(true); setSenhaProvisoria(data.senhaProvisoria ?? null); setRevelar(true);
      setFb({ t: "ok", m: "Nova senha provisória gerada!" });
      onChange?.({ temAcesso: true, senhaProvisoria: data.senhaProvisoria ?? null, acessoConcedidoEm: data.acessoConcedidoEm ?? null });
    } catch { setFb({ t: "erro", m: "Erro de conexão." }); } finally { setSalvando(false); setAcao(null); }
  }

  async function revogar() {
    if (!confirm("Revogar o acesso ao portal deste contato?")) return;
    setSalvando(true); setAcao("revogar");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, { method: "DELETE" });
      if (res.ok) {
        setTemAcesso(false); setRevelar(false);
        setFb({ t: "ok", m: "Acesso revogado." });
        onChange?.({ temAcesso: false, senhaProvisoria, acessoConcedidoEm: null });
      }
    } finally { setSalvando(false); setAcao(null); }
  }

  const msgConvite =
    `Olá ${contatoNome}, seu acesso ao portal do cliente está pronto.\n` +
    `Acesse: ${linkPortal}\nE-mail: ${email}${senhaProvisoria ? `\nSenha: ${senhaProvisoria}` : ""}`;
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
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-ink-muted hover:text-ink">fechar</button>
      </div>

      {fb && (
        <div className={fb.t === "ok" ? "bg-success-50 border border-success-200 text-success-700 text-xs rounded px-2 py-1.5 flex items-center gap-1.5" : "bg-red-50 border border-red-200 text-red-700 text-xs rounded px-2 py-1.5 flex items-center gap-1.5"}>
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-ink">{revelar ? (senhaProvisoria || "—") : "••••••••"}</span>
              <button type="button" onClick={() => setRevelar((v) => !v)} className="text-ink-muted hover:text-ink" title={revelar ? "Ocultar" : "Revelar"}>
                {revelar ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulário de e-mail/senha */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-semibold text-ink">E-mail de acesso</label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email@cliente.com" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-ink">{temAcesso ? "Nova senha (opcional)" : "Senha temporária"}</label>
          <Input value={senha} onChange={(e) => setSenha(e.target.value)} type="text" placeholder={temAcesso ? "deixe em branco para manter" : "mín. 4 caracteres"} />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink mb-1">Permissões</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 divide-y divide-gray-100 sm:divide-y-0">
          {PERMISSOES_PORTAL.map((p) => (
            <ToggleSwitch key={p.chave} label={p.label} checked={!!perms[p.chave]} onChange={(v) => setPerms((s) => ({ ...s, [p.chave]: v }))} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" loading={salvando && acao === "salvar"} onClick={salvar} className="text-xs h-8"><Check className="w-3.5 h-3.5" /> Salvar acesso</Button>
        {temAcesso && (
          <>
            <Button type="button" variant="secondary" loading={salvando && acao === "redefinir"} onClick={redefinir} className="text-xs h-8"><RefreshCw className="w-3.5 h-3.5" /> Redefinir senha</Button>
            <a href={mailto} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"><Mail className="w-3.5 h-3.5" /> Convite e-mail</a>
            <a href={wpp} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-success-700 hover:text-success-800"><MessageCircle className="w-3.5 h-3.5" /> Convite WhatsApp</a>
            <button type="button" onClick={revogar} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 ml-auto"><ShieldOff className="w-3.5 h-3.5" /> Revogar acesso</button>
          </>
        )}
      </div>
    </div>
  );
}
