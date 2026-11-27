"use client";

import { useState } from "react";
import { Building2, CheckCircle2, Plus, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { REQUISITOS_SENHA } from "@/lib/acesso/senha";
import { cn, formatarData } from "@/lib/utils";

export interface EmpresaDaLista {
  id: string; nome: string; nomeFantasia: string | null; cnpj: string; ativo: boolean; criadoEm: string; usuarios: number;
}

const VAZIO = { razaoSocial: "", nomeFantasia: "", cnpj: "", email: "", telefone: "", adminNome: "", adminEmail: "", adminSenha: "" };

/** Máscara do CNPJ enquanto digita: 00.000.000/0000-00 */
export function mascararCnpj(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * Área de Empresas do dono do Frivo: a lista mínima e "Nova empresa". A empresa nasce pronta para
 * usar (perfis, tipos de OS, configuração) e com o 1º administrador. A senha inicial é do super
 * admin: no 1º login o sistema só abre a tela de troca (lib/acesso/troca-obrigatoria).
 */
export function EmpresasAdmin({ inicial }: { inicial: EmpresaDaLista[] }) {
  const [empresas, setEmpresas] = useState(inicial);
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState(VAZIO);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [criada, setCriada] = useState<{ nome: string; adminEmail: string; perfis: number; tiposOs: number } | null>(null);
  const muda = (k: keyof typeof VAZIO) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((v) => ({ ...v, [k]: k === "cnpj" ? mascararCnpj(e.target.value) : e.target.value })); setErro("");
  };

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/admin/empresas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razaoSocial: f.razaoSocial, nomeFantasia: f.nomeFantasia || null, cnpj: f.cnpj, email: f.email, telefone: f.telefone || null,
          admin: { nome: f.adminNome, email: f.adminEmail, senha: f.adminSenha },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível criar a empresa."); return; }
      setCriada({ nome: f.nomeFantasia || f.razaoSocial, adminEmail: d.adminEmail, perfis: d.perfis, tiposOs: d.tiposOs });
      toast("Empresa criada.");
      setAberto(false); setF(VAZIO);
      const lista = await fetch("/api/admin/empresas").then((r) => r.json()).catch(() => null);
      if (lista?.empresas) setEmpresas(lista.empresas);
    } catch { setErro("Erro de conexão. Tente novamente."); } finally { setSalvando(false); }
  }

  return (
    <div className="max-w-5xl mx-auto" data-admin-empresas>
      <PageHeader title="Empresas" description="Área do administrador do Frivo: empresas cadastradas e criação de uma empresa nova" backHref="/dashboard"
        actions={<Button type="button" onClick={() => { setAberto(true); setErro(""); }} data-nova-empresa><Plus className="w-4 h-4" aria-hidden /> Nova empresa</Button>} />

      {criada && (
        <div className="mb-4 rounded-card border border-ok/30 bg-ok-claro px-4 py-3 text-sm text-ok-texto flex gap-2" role="status" data-empresa-criada>
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p><strong>{criada.nome}</strong> criada com {criada.perfis} perfis de acesso e {criada.tiposOs} tipos de OS.</p>
            <p className="mt-1">Entregue ao administrador o login <strong>{criada.adminEmail}</strong> e a senha inicial. No primeiro acesso, o sistema pede que ele crie a própria senha.</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-card border border-surface-border overflow-x-auto">
        {empresas.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted text-center">Nenhuma empresa cadastrada.</p>
        ) : (
          <table className="w-full text-sm" data-lista-empresas>
            <thead className="text-left text-xs text-ink-muted border-b border-surface-linha">
              <tr><th className="px-4 py-2.5 font-medium">Empresa</th><th className="px-4 py-2.5 font-medium">CNPJ</th><th className="px-4 py-2.5 font-medium">Usuários</th><th className="px-4 py-2.5 font-medium">Criada em</th></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} className="border-b border-surface-linha last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden />
                      <span className="font-medium text-ink">{e.nomeFantasia || e.nome}</span>
                      {!e.ativo && <span className="text-[10px] font-semibold bg-surface-alt text-ink-muted px-2 py-0.5 rounded-full">Inativa</span>}
                    </span>
                    {e.nomeFantasia && <span className="block text-xs text-ink-muted ml-6">{e.nome}</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted whitespace-nowrap">{e.cnpj}</td>
                  <td className="px-4 py-2.5 tabular-nums">{e.usuarios}</td>
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{formatarData(e.criadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal aberto={aberto} onFechar={() => { if (!salvando) setAberto(false); }} titulo="Nova empresa" tamanho="lg">
        <form onSubmit={salvar} className="space-y-5" data-form-nova-empresa>
          <p className="text-sm text-ink-muted">Nasce com os 5 perfis de acesso, os tipos de OS de climatização e a configuração padrão.</p>
          <fieldset className="space-y-3" disabled={salvando}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1">Empresa</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              <FormField label="Razão social" required><Input value={f.razaoSocial} onChange={muda("razaoSocial")} data-campo="razaoSocial" /></FormField>
              <FormField label="Nome fantasia"><Input value={f.nomeFantasia} onChange={muda("nomeFantasia")} data-campo="nomeFantasia" /></FormField>
              <FormField label="CNPJ" required><Input value={f.cnpj} onChange={muda("cnpj")} inputMode="numeric" placeholder="00.000.000/0000-00" data-campo="cnpj" /></FormField>
              <FormField label="E-mail da empresa" required><Input type="email" value={f.email} onChange={muda("email")} data-campo="email" /></FormField>
              <FormField label="Telefone"><Input value={f.telefone} onChange={muda("telefone")} inputMode="tel" data-campo="telefone" /></FormField>
            </div>
          </fieldset>
          <fieldset className="space-y-3" disabled={salvando}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1">Primeiro administrador</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              <FormField label="Nome" required><Input value={f.adminNome} onChange={muda("adminNome")} data-campo="adminNome" /></FormField>
              <FormField label="E-mail de login" required hint="Não pode ser login de outro usuário do Frivo."><Input type="email" value={f.adminEmail} onChange={muda("adminEmail")} autoComplete="off" data-campo="adminEmail" /></FormField>
            </div>
            <FormField label="Senha inicial" required hint="Entregue ao administrador. No primeiro acesso, ele é obrigado a trocar.">
              <Input type="password" value={f.adminSenha} onChange={muda("adminSenha")} autoComplete="new-password" data-campo="adminSenha" />
            </FormField>
            <div className="flex flex-wrap gap-x-4 gap-y-1 -mt-1">
              {REQUISITOS_SENHA.map((r) => {
                const ok = r.ok(f.adminSenha);
                return (
                  <span key={r.id} className={cn("text-xs inline-flex items-center gap-1", ok ? "text-ok-texto" : "text-ink-muted")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-ok" : "bg-surface-border")} /> {r.texto}
                  </span>
                );
              })}
            </div>
          </fieldset>
          {erro && (
            <div role="alert" className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-nova-empresa>
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)} disabled={salvando}>Cancelar</Button>
            <Button type="submit" loading={salvando} data-confirmar-nova-empresa>Criar empresa</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
