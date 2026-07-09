"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PortalAcessoContato } from "@/components/forms/portal-acesso-contato";
import { Loader2, UserCircle, Mail, ArrowRight, Headset } from "lucide-react";

interface Contato {
  id: string;
  nome: string;
  email?: string | null;
  whatsapp?: string | null;
  senha?: string | null;
  senhaProvisoria?: string | null;
  acessoConcedidoEm?: string | null;
  permissoes?: Record<string, boolean> | null;
}

/**
 * Aba Portal: lista todos os contatos do cliente e, para cada um, permite conceder,
 * revelar, redefinir e revogar o acesso ao portal (reutiliza PortalAcessoContato).
 */
export function PortalContatos({ clienteId, ativo, onGerenciar }: { clienteId: string; ativo: boolean; onGerenciar: () => void }) {
  const [contatos, setContatos] = useState<Contato[] | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    setContatos(null);
    fetch(`/api/clientes/${clienteId}/contatos`)
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setContatos(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelado) setContatos([]); });
    return () => { cancelado = true; };
  }, [clienteId, ativo]);

  function onAcessoChange(id: string, info: { temAcesso: boolean; senhaProvisoria: string | null; acessoConcedidoEm: string | null }) {
    setContatos((prev) => (prev ?? []).map((c) => c.id === id
      ? {
          ...c,
          senha: info.temAcesso ? (c.senha ?? "set") : null,
          senhaProvisoria: info.senhaProvisoria ?? c.senhaProvisoria,
          acessoConcedidoEm: info.acessoConcedidoEm ?? c.acessoConcedidoEm,
        }
      : c));
  }

  if (contatos === null) {
    return <div className="flex items-center gap-2 text-sm text-ink-muted py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando contatos…</div>;
  }

  if (contatos.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-surface-border rounded-xl">
        <Headset className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
        <p className="text-sm text-ink-muted">Nenhum contato cadastrado para conceder acesso.</p>
        <button type="button" onClick={onGerenciar} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 mt-1">
          Cadastrar contatos <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted mb-1">
        Conceda ou gerencie o acesso de cada contato ao portal do cliente. A senha provisória fica visível para você repassar ao contato.
      </p>
      {contatos.map((c) => {
        const temAcesso = !!c.senha;
        return (
          <div key={c.id} className="border border-surface-border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink flex items-center gap-1.5"><UserCircle className="w-4 h-4 text-primary-600" /> {c.nome}</p>
                <p className="text-xs text-ink-muted flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email || "sem e-mail"}</p>
              </div>
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", temAcesso ? "bg-success-50 text-success-700" : "bg-slate-100 text-slate-500")}>
                {temAcesso ? "Acesso ativo" : "Sem acesso"}
              </span>
            </div>
            <PortalAcessoContato
              clienteId={clienteId}
              contatoId={c.id}
              contatoNome={c.nome}
              emailInicial={c.email}
              whatsappInicial={c.whatsapp}
              temAcesso={temAcesso}
              senhaProvisoriaInicial={c.senhaProvisoria}
              acessoConcedidoEmInicial={c.acessoConcedidoEm}
              permissoesIniciais={c.permissoes ?? null}
              onChange={(info) => onAcessoChange(c.id, info)}
            />
          </div>
        );
      })}
    </div>
  );
}
