"use client";

import { useEffect, useState } from "react";
import { Building2, Check, CheckCircle2, Copy, KeyRound, Pencil, Plus, AlertCircle, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { REQUISITOS_SENHA } from "@/lib/acesso/senha";
import { cnpjValido } from "@/lib/documento";
import { rotuloEventoEmpresa, type DadosEmpresa } from "@/lib/empresa/eventos";
import { cn, formatarData, formatarDataHora } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";

export interface EmpresaDaLista {
  id: string; nome: string; nomeFantasia: string | null; cnpj: string; ativo: boolean; criadoEm: string; usuarios: number;
}

/** A lista (TabelaPro: largura, mostrar/esconder e ordem por usuário); no celular, cartões */
const COLUNAS_EMPRESAS: ColunaPro[] = [
  { id: "empresa", titulo: "Empresa", obrigatoria: true, minimo: 220, classe: "truncate" },
  { id: "cnpj", titulo: "CNPJ", largura: 170 },
  { id: "usuarios", titulo: "Usuários", largura: 100, alinhar: "direita" },
  { id: "criada", titulo: "Criada em", largura: 120 },
  { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 400, alinhar: "direita", classe: "py-0.5" },
];

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
 * Em cada empresa: Editar (dados do cadastro, com o Histórico), Nova senha do 1º administrador
 * (mostrada uma vez) e Inativar/Reativar. A página e a API são só do SUPER_ADMIN.
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
  const [editando, setEditando] = useState<EmpresaDaLista | null>(null);
  const [gerando, setGerando] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ empresa: string; nome: string; email: string; senha: string } | null>(null);

  /** Nova senha provisória do 1º administrador: confirma, gera no servidor e mostra UMA vez */
  async function novaSenhaAdmin(e: EmpresaDaLista) {
    const nome = e.nomeFantasia || e.nome;
    const ok = await confirmar({
      mensagem: `Gerar nova senha provisória do 1º administrador de ${nome}? A senha atual deixa de valer.`,
      confirmarTexto: "Gerar nova senha",
    });
    if (!ok) return;
    setGerando(e.id);
    try {
      const res = await fetch(`/api/admin/empresas/${e.id}/nova-senha-admin`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.erro ?? "Não foi possível gerar a nova senha.", "erro"); return; }
      setSenhaGerada({ empresa: nome, nome: d.admin.nome, email: d.admin.email, senha: d.senha });
    } catch { toast("Erro de conexão. Tente novamente.", "erro"); } finally { setGerando(null); }
  }

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

  /** As ações da linha (tabela e cartão do celular): Editar, Nova senha do admin e Inativar/Reativar */
  const acoes = (e: EmpresaDaLista) => (
    <>
      <Button type="button" variant="secondary" className="text-xs h-8" onClick={() => setEditando(e)} data-editar-empresa={e.id}>
        <Pencil className="w-3.5 h-3.5" aria-hidden /> Editar
      </Button>
      <Button type="button" variant="secondary" className="text-xs h-8" loading={gerando === e.id} onClick={() => novaSenhaAdmin(e)} data-nova-senha-admin={e.id}>
        <KeyRound className="w-3.5 h-3.5" aria-hidden /> Nova senha do admin
      </Button>
      <BotaoSituacao e={e} propria={e.id === empresaDoDono} alterar={alterarSituacao} ocupado={mudando === e.id} />
    </>
  );

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

      <div className="bg-white rounded-card border border-surface-border overflow-hidden">
        {empresas.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted text-center">Nenhuma empresa cadastrada.</p>
        ) : (
          <TabelaPro
            tela="admin-empresas" colunas={COLUNAS_EMPRESAS} atributos={{ "data-lista-empresas": true }}
            barra={<span>{empresas.length === 1 ? "1 empresa" : `${empresas.length} empresas`}</span>}
            cartoes={(
              // Celular: um cartão por empresa, sem rolagem lateral
              <ul className="md:hidden divide-y divide-surface-linha" data-cartoes-empresas>
                {empresas.map((e) => (
                  <li key={e.id} className="p-4 space-y-1" data-empresa={e.id}>
                    <p className="flex items-center gap-2 font-medium text-ink"><Building2 className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden /> {e.nomeFantasia || e.nome} {!e.ativo && <SeloInativa />}</p>
                    {e.nomeFantasia && <p className="text-xs text-ink-muted">{e.nome}</p>}
                    <p className="text-xs text-ink-muted tabular-nums">{e.cnpj} · {e.usuarios} {e.usuarios === 1 ? "usuário" : "usuários"} · criada em {formatarData(e.criadoEm)}</p>
                    <div className="pt-1 flex flex-wrap gap-2">{acoes(e)}</div>
                  </li>
                ))}
              </ul>
            )}
            linhas={empresas.map((e) => ({
              id: e.id, atributos: { "data-empresa": e.id }, titulos: { empresa: e.nomeFantasia ? `${e.nomeFantasia} · ${e.nome}` : e.nome },
              celulas: {
                empresa: (
                  <span className="block min-w-0">
                    <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden />
                      <span className="font-medium text-ink truncate">{e.nomeFantasia || e.nome}</span>
                      {!e.ativo && <SeloInativa />}
                    </span>
                    {e.nomeFantasia && <span className="block text-xs text-ink-muted ml-6 truncate">{e.nome}</span>}
                  </span>
                ),
                cnpj: <span className={cn(PLANILHA.codigo, "text-ink-muted")}>{e.cnpj}</span>,
                usuarios: e.usuarios,
                criada: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(e.criadoEm)}</span>,
                acoes: <span className="flex justify-end gap-2">{acoes(e)}</span>,
              },
            }))}
          />
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

      {editando && (
        <EditarEmpresa empresa={editando} onFechar={() => setEditando(null)}
          onSalvo={(d) => setEmpresas((lista) => lista.map((x) => (x.id === editando.id ? { ...x, nome: d.razaoSocial ?? x.nome, nomeFantasia: d.nomeFantasia, cnpj: d.cnpj ?? x.cnpj } : x)))} />
      )}
      <SenhaDoAdmin gerada={senhaGerada} onFechar={() => setSenhaGerada(null)} />
    </div>
  );
}

/** A senha provisória gerada: aparece só aqui, uma vez, com Copiar. Fechar descarta (não fica em lugar nenhum). */
function SenhaDoAdmin({ gerada, onFechar }: { gerada: { empresa: string; nome: string; email: string; senha: string } | null; onFechar: () => void }) {
  const [copiou, setCopiou] = useState(false);
  const [erroCopia, setErroCopia] = useState(false);
  useEffect(() => { setCopiou(false); setErroCopia(false); }, [gerada?.senha]);
  async function copiar() {
    if (!gerada) return;
    try { await navigator.clipboard.writeText(gerada.senha); setCopiou(true); } catch { setErroCopia(true); }
  }
  return (
    <Modal aberto={!!gerada} onFechar={onFechar} titulo="Nova senha provisória" tamanho="sm">
      {gerada && (
        <div className="space-y-4" data-senha-admin-gerada>
          <p className="text-sm text-ink">1º administrador de <strong>{gerada.empresa}</strong>: {gerada.nome}, login <strong>{gerada.email}</strong>.</p>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface-alt px-3 py-2">
            <span className="text-sm font-mono text-ink select-all" data-senha-admin>{gerada.senha}</span>
            <button type="button" onClick={copiar} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800 min-h-[32px] px-1" data-copiar-senha-admin>
              {copiou ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />} {copiou ? "Copiada" : "Copiar"}
            </button>
          </div>
          {erroCopia && <p className="text-xs text-atrasado-texto" role="alert">Não foi possível copiar. Selecione a senha e copie.</p>}
          <p className="text-xs text-ink-muted flex items-center gap-1" data-aviso-senha-admin>Aparece só agora. Copie e entregue ao administrador.
            <Dica rotulo="Nova senha provisória" texto="No próximo acesso, o sistema pede que ele crie a própria senha. As sessões abertas dele foram encerradas." /></p>
          <div className="flex justify-end"><Button type="button" onClick={onFechar} data-fechar-senha-admin>Fechar</Button></div>
        </div>
      )}
    </Modal>
  );
}

interface EventoDaEmpresa { id: string; tipo: string; detalhe: string | null; criadoEm: string; autor: string | null }
const DADOS_VAZIOS = { razaoSocial: "", nomeFantasia: "", cnpj: "", email: "", telefone: "" };

/** Editar os dados do cadastro da empresa (com a trilha recente embaixo). O servidor confere tudo de novo. */
function EditarEmpresa({ empresa, onFechar, onSalvo }: { empresa: EmpresaDaLista; onFechar: () => void; onSalvo: (d: DadosEmpresa) => void }) {
  const [f, setF] = useState(DADOS_VAZIOS);
  const [eventos, setEventos] = useState<EventoDaEmpresa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  // Não carregou os dados de agora: nada a salvar (salvar gravaria os campos vazios por cima)
  const [falhouCarga, setFalhouCarga] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/admin/empresas/${empresa.id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setFalhouCarga(true); setErro(d.erro ?? "Não foi possível carregar a empresa."); return; }
      const e = d.empresa as DadosEmpresa;
      setF({ razaoSocial: e.razaoSocial ?? "", nomeFantasia: e.nomeFantasia ?? "", cnpj: e.cnpj ?? "", email: e.email ?? "", telefone: e.telefone ?? "" });
      setEventos(d.eventos ?? []);
    }).catch(() => { if (vivo) { setFalhouCarga(true); setErro("Erro de conexão. Tente novamente."); } }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [empresa.id]);

  const muda = (k: keyof typeof DADOS_VAZIOS) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((v) => ({ ...v, [k]: k === "cnpj" ? mascararCnpj(e.target.value) : e.target.value })); setErro("");
  };

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (falhouCarga) return;
    if (!cnpjValido(f.cnpj)) { setErro("CNPJ inválido."); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/admin/empresas/${empresa.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ razaoSocial: f.razaoSocial, nomeFantasia: f.nomeFantasia || null, cnpj: f.cnpj, email: f.email, telefone: f.telefone || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar."); return; }
      onSalvo(d.empresa);
      toast(d.alterado ? "Dados da empresa salvos." : "Nenhum dado foi alterado.");
      onFechar();
    } catch { setErro("Erro de conexão. Tente novamente."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto onFechar={() => { if (!salvando) onFechar(); }} titulo={`Editar ${empresa.nomeFantasia || empresa.nome}`} tamanho="lg">
      <form onSubmit={salvar} className="space-y-5" data-form-editar-empresa>
        <fieldset className="grid sm:grid-cols-2 gap-3" disabled={salvando || carregando || falhouCarga}>
          <FormField label="Razão social" required><Input value={f.razaoSocial} onChange={muda("razaoSocial")} data-editar-campo="razaoSocial" /></FormField>
          <FormField label="Nome fantasia"><Input value={f.nomeFantasia} onChange={muda("nomeFantasia")} data-editar-campo="nomeFantasia" /></FormField>
          <FormField label="CNPJ" required dica="Precisa ser válido e não pode ser o CNPJ de outra empresa do Frivo.">
            <Input value={f.cnpj} onChange={muda("cnpj")} inputMode="numeric" placeholder="00.000.000/0000-00" data-editar-campo="cnpj" />
          </FormField>
          <FormField label="E-mail da empresa" required><Input type="email" value={f.email} onChange={muda("email")} data-editar-campo="email" /></FormField>
          <FormField label="Telefone"><Input value={f.telefone} onChange={muda("telefone")} inputMode="tel" data-editar-campo="telefone" /></FormField>
        </fieldset>
        {erro && (
          <div role="alert" className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-editar-empresa>
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando} disabled={carregando || falhouCarga} data-salvar-empresa>Salvar</Button>
        </div>
      </form>
      <section className="mt-6 border-t border-surface-linha pt-4" data-historico-empresa>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">Histórico</h3>
        {carregando ? <p className="text-sm text-ink-muted">Carregando...</p> : eventos.length === 0 ? (
          <p className="text-sm text-ink-muted" data-historico-vazio>Nenhum registro ainda.</p>
        ) : (
          <ul className="space-y-2 max-h-60 overflow-y-auto">
            {eventos.map((ev) => (
              <li key={ev.id} className="text-sm" data-evento-empresa={ev.tipo}>
                <p className="text-ink"><span className="font-medium">{rotuloEventoEmpresa(ev.tipo)}</span>
                  <span className="text-xs text-ink-muted"> · {formatarDataHora(ev.criadoEm)}{ev.autor ? ` · ${ev.autor}` : ""}</span></p>
                {ev.detalhe && <p className="text-xs text-ink-muted whitespace-pre-line">{ev.detalhe}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
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
