"use client";

import { useState } from "react";
import { Building2, CheckCircle2, Plus, AlertCircle, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { confirmar, toast } from "@/components/ui/avisos";
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
export function EmpresasAdmin({ inicial, empresaDoDono }: { inicial: EmpresaDaLista[]; empresaDoDono?: string }) {
  const [empresas, setEmpresas] = useState(inicial);
  const [mudando, setMudando] = useState<string | null>(null);
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

  /** Inativar (ninguém da empresa entra; nada é apagado) ou reativar */
  async function alterarSituacao(e: EmpresaDaLista) {
    const nome = e.nomeFantasia || e.nome;
    const ok = await confirmar(e.ativo
      ? { mensagem: `Inativar ${nome}? Ninguém da empresa consegue entrar até ser reativada. Nenhum dado é apagado.`, perigo: true, confirmarTexto: "Inativar empresa" }
      : { mensagem: `Reativar ${nome}? Os usuários ativos dela voltam a entrar.`, confirmarTexto: "Reativar empresa" });
    if (!ok) return;
    setMudando(e.id);
    try {
      const res = await fetch(`/api/admin/empresas/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: !e.ativo }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.erro ?? "Não foi possível alterar a empresa.", "erro"); return; }
      setEmpresas((lista) => lista.map((x) => (x.id === e.id ? { ...x, ativo: d.ativo } : x)));
      toast(d.ativo ? "Empresa reativada." : "Empresa inativada.");
    } catch { toast("Erro de conexão. Tente novamente.", "erro"); } finally { setMudando(null); }
  }

  return (
    <div className="max-w-5xl mx-auto" data-admin-empresas>
      <PageHeader title="Empresas" description="Área do administrador do Frivo: empresas cadastradas e criação de uma empresa nova" backHref="/dashboard"
        actions={<Button type="button" onClick={() => { setAberto(true); setErro(""); }} data-nova-empresa><Plus className="w-4 h-4" aria-hidden /> Nova empresa</Button>} />

      {criada && (
        <div className="mb-4 rounded-card border border-ok/30 bg-ok-claro px-4 py-3 text-sm text-ok-texto flex gap-2" role="status" data-empresa-criada>
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p><strong>{criada.nome}</strong> criada com {criada.perfis} perfis de acesso e {criada.tiposOs} tipos de OS.</p>
            <p className="mt-1">Entregue ao administrador o login <strong>{criada.adminEmail}</strong> e a senha inicial. No primeiro acesso, o sistema pede que ele crie a própria senha.</p>
          </div>
          <button type="button" onClick={() => setCriada(null)} className="shrink-0 -my-2 -mr-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-ok-texto hover:opacity-80" aria-label="Fechar aviso" data-fechar-aviso>
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="bg-white rounded-card border border-surface-border md:overflow-x-auto">
        {empresas.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted text-center">Nenhuma empresa cadastrada.</p>
        ) : (
          <>
          <table className="w-full text-sm hidden md:table" data-lista-empresas>
            <thead className="text-left text-xs text-ink-muted border-b border-surface-linha">
              <tr><th className="px-4 py-2.5 font-medium">Empresa</th><th className="px-4 py-2.5 font-medium">CNPJ</th><th className="px-4 py-2.5 font-medium">Usuários</th><th className="px-4 py-2.5 font-medium">Criada em</th><th className="px-4 py-2.5"><span className="sr-only">Ações</span></th></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} className="border-b border-surface-linha last:border-0" data-empresa={e.id}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden />
                      <span className="font-medium text-ink">{e.nomeFantasia || e.nome}</span>
                      {!e.ativo && <SeloInativa />}
                    </span>
                    {e.nomeFantasia && <span className="block text-xs text-ink-muted ml-6">{e.nome}</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted whitespace-nowrap">{e.cnpj}</td>
                  <td className="px-4 py-2.5 tabular-nums">{e.usuarios}</td>
                  <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{formatarData(e.criadoEm)}</td>
                  <td className="px-4 py-2.5 text-right"><BotaoSituacao e={e} propria={e.id === empresaDoDono} alterar={alterarSituacao} ocupado={mudando === e.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Celular: um cartão por empresa, sem rolagem lateral */}
          <ul className="md:hidden divide-y divide-surface-linha" data-cartoes-empresas>
            {empresas.map((e) => (
              <li key={e.id} className="p-4 space-y-1" data-empresa={e.id}>
                <p className="flex items-center gap-2 font-medium text-ink"><Building2 className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden /> {e.nomeFantasia || e.nome} {!e.ativo && <SeloInativa />}</p>
                {e.nomeFantasia && <p className="text-xs text-ink-muted">{e.nome}</p>}
                <p className="text-xs text-ink-muted tabular-nums">{e.cnpj} · {e.usuarios} {e.usuarios === 1 ? "usuário" : "usuários"} · criada em {formatarData(e.criadoEm)}</p>
                <div className="pt-1"><BotaoSituacao e={e} propria={e.id === empresaDoDono} alterar={alterarSituacao} ocupado={mudando === e.id} /></div>
              </li>
            ))}
          </ul>
          </>
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

const SeloInativa = () => <span className="text-[10px] font-semibold bg-surface-alt text-ink-muted px-2 py-0.5 rounded-full" data-empresa-inativa>Inativa</span>;

/** Inativar / Reativar: a empresa do próprio dono do Frivo não oferece inativar */
function BotaoSituacao({ e, propria, alterar, ocupado }: { e: EmpresaDaLista; propria: boolean; alterar: (e: EmpresaDaLista) => void; ocupado: boolean }) {
  if (propria && e.ativo) return null;
  return (
    <Button type="button" variant="secondary" className="text-xs h-8" loading={ocupado} onClick={() => alterar(e)} data-situacao-empresa={e.ativo ? "inativar" : "reativar"}>
      {e.ativo ? "Inativar" : "Reativar"}
    </Button>
  );
}
