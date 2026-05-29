"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { PERMISSOES_PORTAL, whatsappLink } from "@/lib/utils";
import { KeyRound, Mail, MessageCircle, Check, AlertCircle, ShieldOff } from "lucide-react";

interface Props {
  clienteId: string;
  contatoId: string;
  contatoNome: string;
  emailInicial?: string | null;
  whatsappInicial?: string | null;
  temAcesso: boolean;
  permissoesIniciais?: Record<string, boolean> | null;
}

export function PortalAcessoContato({ clienteId, contatoId, contatoNome, emailInicial, whatsappInicial, temAcesso: temAcessoInicial, permissoesIniciais }: Props) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState(emailInicial ?? "");
  const [senha, setSenha] = useState("");
  const [temAcesso, setTemAcesso] = useState(temAcessoInicial);
  const [perms, setPerms] = useState<Record<string, boolean>>(permissoesIniciais ?? {});
  const [salvando, setSalvando] = useState(false);
  const [fb, setFb] = useState<{ t: "ok" | "erro"; m: string } | null>(null);

  const linkPortal = typeof window !== "undefined" ? `${window.location.origin}/portal/login` : "/portal/login";

  async function salvar() {
    setFb(null);
    if (!email) { setFb({ t: "erro", m: "Informe o e-mail de acesso." }); return; }
    if (!temAcesso && senha.length < 4) { setFb({ t: "erro", m: "Defina uma senha (mín. 4 caracteres)." }); return; }
    setSalvando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha: senha || undefined, ativo: true, permissoes: perms }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setFb({ t: "erro", m: e.erro ?? "Erro ao salvar." }); return; }
      setTemAcesso(true); setSenha("");
      setFb({ t: "ok", m: "Acesso salvo." });
    } catch { setFb({ t: "erro", m: "Erro de conexão." }); } finally { setSalvando(false); }
  }

  async function revogar() {
    if (!confirm("Revogar o acesso ao portal deste contato?")) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contatos/${contatoId}/acesso-portal`, { method: "DELETE" });
      if (res.ok) { setTemAcesso(false); setFb({ t: "ok", m: "Acesso revogado." }); }
    } finally { setSalvando(false); }
  }

  const msgConvite =
    `Olá ${contatoNome}, seu acesso ao portal do cliente está pronto.\n` +
    `Acesse: ${linkPortal}\nE-mail: ${email}${senha ? `\nSenha: ${senha}` : ""}`;
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
        <p className="text-xs font-bold text-primary-700 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Acesso ao portal {temAcesso && <span className="text-[10px] bg-success-50 text-success-700 px-1.5 py-0.5 rounded">ativo</span>}</p>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-ink-muted hover:text-ink">fechar</button>
      </div>
      {fb && (
        <div className={fb.t === "ok" ? "bg-success-50 border border-success-200 text-success-700 text-xs rounded px-2 py-1.5 flex items-center gap-1.5" : "bg-red-50 border border-red-200 text-red-700 text-xs rounded px-2 py-1.5 flex items-center gap-1.5"}>
          {fb.t === "ok" ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {fb.m}
        </div>
      )}
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
        <Button type="button" loading={salvando} onClick={salvar} className="text-xs h-8"><Check className="w-3.5 h-3.5" /> Salvar acesso</Button>
        {temAcesso && (
          <>
            <a href={mailto} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"><Mail className="w-3.5 h-3.5" /> Convite e-mail</a>
            <a href={wpp} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-success-700 hover:text-success-800"><MessageCircle className="w-3.5 h-3.5" /> Convite WhatsApp</a>
            <button type="button" onClick={revogar} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 ml-auto"><ShieldOff className="w-3.5 h-3.5" /> Revogar</button>
          </>
        )}
      </div>
    </div>
  );
}
