"use client";

import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, ChevronRight, Crown, FileWarning, FileX, HardHat, Loader2, Pencil, Phone, Plane, Plus,
  SlidersHorizontal, UserX, Users, Wrench, X, Ban,
} from "lucide-react";
import { cn, formatarData, formatarTelefone } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { CadastroRapidoModal, type CampoRapido } from "@/components/ui/select-cadastro-rapido";
import { TECNICO } from "@/components/cadastro-rapido/definicoes";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { AlternarVisao, CampoBusca, ChipResumo, MultiSelect, Paginacao, SelectFiltro, ThOrd, type Opcao } from "@/components/listagem/listagem-ui";
import type { FiltrosColaboradores, OrdemColaboradores } from "@/lib/colaborador-listagem";

export type ColaboradorLinha = {
  id: string; nome: string; funcao: string; funcaoLabel: string; cargo: string | null;
  telefone: string; email: string | null; ativo: boolean; status: string; especialidades: string[];
  foto: string | null; equipes: { id: string; nome: string; cor: string }[]; lider: boolean; semEquipe: boolean;
  atividades: number; documento: { nome: string; data: string; vencido: boolean } | null;
};

interface Props {
  itens: ColaboradorLinha[];
  total: number;
  filtros: FiltrosColaboradores;
  opcoes: { funcoes: Opcao[]; cargos: Opcao[]; equipes: Opcao[] };
  resumo: { ativos: number; inativos: number; tecnicos: number; semEquipe: number; ausentes: number; docVencido: number; docVencendo: number };
}

const STATUS: Record<string, { txt: string; cls: string; dot: string }> = {
  ATIVO: { txt: "Ativo", cls: "text-emerald-700 bg-emerald-50", dot: "bg-emerald-500" },
  FERIAS: { txt: "Férias", cls: "text-sky-700 bg-sky-50", dot: "bg-sky-500" },
  AFASTADO: { txt: "Afastado", cls: "text-amber-700 bg-amber-50", dot: "bg-amber-500" },
  INATIVO: { txt: "Inativo", cls: "text-slate-500 bg-slate-100", dot: "bg-slate-400" },
};

function StatusColaboradorSelo({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.ATIVO;
  return (
    <span data-status-colaborador={status} className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", s.cls, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />{s.txt}
    </span>
  );
}

/** "Técnico de campo · Eletricista" — função e cargo (o que houver). */
const funcaoCargo = (c: ColaboradorLinha) => [c.cargo, c.funcaoLabel].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ");

export function ColaboradoresListaClient({ itens, total, filtros: f, opcoes, resumo }: Props) {
  const massa = useAcoesMassaDisponiveis("colaboradores");
  const { pode } = usePermissoes();
  const podeGerenciar = pode("equipes", "gerenciar");
  // Mesmo hook das listagens de Equipamentos e Veículos
  const { visao, trocarVisao, busca, setBusca, navegar, limpar, pendente } = useListagemUrl({ chave: "colaboradores", qAtual: f.q });
  const [filtrosMobile, setFiltrosMobile] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);

  function ordenar(k: OrdemColaboradores) {
    const dir = f.ordem === k ? (f.dir === "asc" ? "desc" : "asc") : "asc";
    navegar({ ordem: k === "nome" ? null : k, dir: dir === "asc" ? null : "desc" });
  }
  const filtrosAtivos = [f.q, f.funcoes.length, f.cargo, f.equipe, f.status !== "ativo", f.aviso].filter(Boolean).length;
  const alternarAviso = (a: FiltrosColaboradores["aviso"]) => navegar({ aviso: f.aviso === a ? null : a, ...(f.status === "inativo" ? { status: null } : {}) });

  // Cadastro direto (mesmo mini-cadastro do #9/#10) + função e cargo
  const camposNovo: CampoRapido[] = [
    ...TECNICO.campos,
    { nome: "tipo", label: "Função", tipo: "select", colunas: 3, placeholder: "Técnico de campo", opcoes: opcoes.funcoes },
    ...(opcoes.cargos.length ? [{ nome: "cargoId", label: "Cargo", tipo: "select", colunas: 3, placeholder: "Sem cargo", opcoes: opcoes.cargos } as CampoRapido] : []),
  ];

  return (
    <div className="space-y-4" data-listagem-colaboradores>
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-2 bg-primary-50 rounded-lg hidden sm:block"><HardHat className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Colaboradores</h1>
          <span data-total className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total.toLocaleString("pt-BR")}</span>
          {pendente && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <AlternarVisao visao={visao} onTrocar={trocarVisao} />
          {podeGerenciar && (
            <button onClick={() => setNovoAberto(true)} data-novo-colaborador
              className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo colaborador</span><span className="sm:hidden">Novo</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Indicadores ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-indicadores>
        <ChipResumo id="ativos" ativo={f.status === "ativo" && !f.aviso} onClick={() => navegar({ status: null, aviso: null })}
          icone={CheckCircle2} cor="text-emerald-700" rotulo="Ativos" valor={resumo.ativos} />
        <ChipResumo id="inativos" ativo={f.status === "inativo"} onClick={() => navegar({ status: f.status === "inativo" ? null : "inativo", aviso: null })}
          icone={Ban} cor="text-slate-500" rotulo="Inativos" valor={resumo.inativos} />
        <ChipResumo id="tecnicos" ativo={f.aviso === "tecnicos"} onClick={() => alternarAviso("tecnicos")}
          icone={Wrench} cor="text-primary-600" rotulo="Técnicos" valor={resumo.tecnicos} />
        <ChipResumo id="sem_equipe" ativo={f.aviso === "sem_equipe"} onClick={() => alternarAviso("sem_equipe")}
          icone={UserX} cor="text-amber-700" rotulo="Sem equipe" valor={resumo.semEquipe} />
        <ChipResumo id="ausente" ativo={f.aviso === "ausente"} onClick={() => alternarAviso("ausente")}
          icone={Plane} cor="text-sky-700" rotulo="Férias / afastados" valor={resumo.ausentes} />
        <ChipResumo id="doc_vencido" ativo={f.aviso === "doc_vencido"} onClick={() => alternarAviso("doc_vencido")}
          icone={FileX} cor="text-red-600" rotulo="Documento vencido" valor={resumo.docVencido} />
        <ChipResumo id="doc_vencendo" ativo={f.aviso === "doc_vencendo"} onClick={() => alternarAviso("doc_vencendo")}
          icone={FileWarning} cor="text-amber-700" rotulo="Documento vencendo" valor={resumo.docVencendo} />
      </div>

      {/* ── Busca + filtros ── */}
      <div className="bg-white border border-surface-border rounded-xl p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_auto] gap-2 items-center">
          <CampoBusca valor={busca} onChange={setBusca} rotulo="Buscar colaborador" placeholder="Buscar nome, CPF, telefone, e-mail ou cargo…" />
          <button onClick={() => setFiltrosMobile((v) => !v)}
            className="lg:hidden w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium text-primary-600 border border-surface-border rounded-lg py-2">
            <SlidersHorizontal className="w-4 h-4" />
            {filtrosMobile ? "Ocultar filtros" : `Filtros${filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ""}`}
          </button>
          <div className={cn("flex-wrap items-center gap-2", filtrosMobile ? "flex" : "hidden lg:flex")}>
            <SelectFiltro rotulo="Status" valor={f.status === "ativo" ? "" : f.status} onChange={(v) => navegar({ status: v || null })}
              vazio="Status: ativos" opcoes={[{ value: "inativo", label: "Status: inativos" }, { value: "todos", label: "Status: todos" }]} />
            <MultiSelect titulo="Função" opcoes={opcoes.funcoes} selecionados={f.funcoes} onChange={(v) => navegar({ funcoes: v.join(",") || null })} />
            {opcoes.cargos.length > 0 && <SelectFiltro rotulo="Cargo" valor={f.cargo} onChange={(v) => navegar({ cargo: v || null })} vazio="Cargo: todos" opcoes={opcoes.cargos} />}
            {opcoes.equipes.length > 0 && <SelectFiltro rotulo="Equipe" valor={f.equipe} onChange={(v) => navegar({ equipe: v || null })} vazio="Equipe: todas" opcoes={opcoes.equipes} />}
            <label className="inline-flex items-center gap-2 text-sm text-ink-muted select-none px-1">
              <input type="checkbox" checked={f.status === "todos"} onChange={(e) => navegar({ status: e.target.checked ? "todos" : null })} className="accent-primary-600" aria-label="Mostrar inativos" />
              Mostrar inativos
            </label>
            {filtrosAtivos > 0 && (
              <button onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-red-500">
                <X className="w-3.5 h-3.5" /> Limpar filtros ({filtrosAtivos})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className={cn("transition-opacity", pendente && "opacity-60")}>
        {itens.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-xl text-center py-16">
            <HardHat className="w-10 h-10 text-ink-subtle mx-auto mb-3" />
            <p className="text-ink font-medium">{f.q ? `Nenhum colaborador encontrado para “${f.q}”` : "Nenhum colaborador encontrado"}</p>
            <p className="text-sm text-ink-muted mt-1">{filtrosAtivos > 0 ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro colaborador."}</p>
            {filtrosAtivos > 0 && <button onClick={limpar} className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>}
          </div>
        ) : (
          <>
            <div className="md:hidden bg-white border border-surface-border rounded-xl divide-y divide-surface-border overflow-hidden" data-visao="mobile">
              {itens.map((c) => (
                <div key={c.id} className="flex items-stretch">
                  {massa && <div className="pl-3 pt-4"><CheckboxLinha id={c.id} rotulo={c.nome} /></div>}
                  <div className="min-w-0 flex-1"><LinhaMobile c={c} /></div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              {visao === "lista" ? <Tabela massa={massa} itens={itens} f={f} onOrdenar={ordenar} /> : <Cards massa={massa} itens={itens} />}
            </div>
          </>
        )}
      </div>

      <Paginacao total={total} pagina={f.pagina} porPagina={f.porPagina} onNavegar={navegar} />

      {podeGerenciar && (
        <CadastroRapidoModal
          aberto={novoAberto} onFechar={() => setNovoAberto(false)} titulo="Novo colaborador"
          campos={camposNovo} linkCadastroCompleto={TECNICO.link} rotuloSalvar="Cadastrar colaborador"
          criar={async (v) => {
            const cpf = (v.cpf ?? "").replace(/\D/g, "");
            if (cpf.length !== 11) throw new Error("CPF deve ter 11 dígitos.");
            const res = await fetch("/api/tecnicos", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nome: v.nome, cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`, telefone: v.telefone,
                ...(v.tipo && { tipo: v.tipo }), ...(v.cargoId && { cargoId: v.cargoId }), competenciaIds: [],
              }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.erro ?? "Erro ao cadastrar o colaborador.");
            return { value: d.id, label: d.nome };
          }}
          // Mostra quem acabou de ser cadastrado (senão ele poderia cair em outra página da lista)
          onCriado={(o) => { setNovoAberto(false); setBusca(o.label); navegar({ q: o.label, status: null, aviso: null, funcoes: null, cargo: null, equipe: null }); }}
        />
      )}
    </div>
  );
}

/* ───────── Equipes / avisos ───────── */
function Equipes({ c, max = 2 }: { c: ColaboradorLinha; max?: number }) {
  if (c.semEquipe) return <span data-sem-equipe className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-amber-700 bg-amber-50"><UserX className="w-3 h-3" /> Sem equipe</span>;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {c.lider && <span title="Líder de equipe" className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full text-amber-800 bg-amber-100"><Crown className="w-3 h-3" /> Líder</span>}
      {c.equipes.slice(0, max).map((e) => (
        <span key={e.id} className="inline-flex items-center gap-1 text-[11px] text-ink bg-surface-alt border border-surface-border px-1.5 py-0.5 rounded-full max-w-[140px] truncate">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.cor }} />{e.nome}
        </span>
      ))}
      {c.equipes.length > max && <span className="text-[11px] text-ink-subtle">+{c.equipes.length - max}</span>}
    </span>
  );
}
function DocSelo({ c }: { c: ColaboradorLinha }) {
  if (!c.documento) return null;
  const v = c.documento.vencido;
  return (
    <span data-aviso="documento" title={`${c.documento.nome}: ${v ? "venceu" : "vence"} em ${formatarData(c.documento.data)}`}
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", v ? "text-red-700 bg-red-50" : "text-amber-700 bg-amber-50")}>
      {v ? <FileX className="w-3 h-3" /> : <FileWarning className="w-3 h-3" />}
      {c.documento.nome.length > 14 ? "Documento" : c.documento.nome} {v ? "vencido" : formatarData(c.documento.data)}
    </span>
  );
}

/* ───────── Tabela (desktop) ───────── */
function Tabela({ massa, itens, f, onOrdenar }: { massa: boolean; itens: ColaboradorLinha[]; f: FiltrosColaboradores; onOrdenar: (k: OrdemColaboradores) => void }) {
  const router = useRouter();
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-x-auto" data-visao="lista">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-ink-muted text-[11px] uppercase tracking-wide border-b border-surface-border">
          <tr>
            {massa && <th className="w-px pl-4 pr-1 py-2.5"><CheckboxPagina /></th>}
            <ThOrd label="Colaborador" k="nome" ordem={f.ordem} dir={f.dir} onOrdenar={onOrdenar} className={massa ? "pl-2" : "pl-4"} />
            <ThOrd label="Cargo / função" k="cargo" ordem={f.ordem} dir={f.dir} onOrdenar={onOrdenar} />
            <th className="text-left px-3 py-2.5 font-semibold">Equipe</th>
            <th className="text-left px-3 py-2.5 font-semibold">Contato</th>
            <th className="text-left px-3 py-2.5 font-semibold">Avisos</th>
            <th className="text-left px-3 py-2.5 font-semibold">Status</th>
            <th className="text-right pl-2 pr-3 py-2.5 font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border/70">
          {itens.map((c) => (
            <tr key={c.id} data-colaborador-id={c.id} onClick={() => router.push(`/colaboradores/${c.id}/editar`)}
              className={cn("cursor-pointer hover:bg-primary-50/40 transition-colors", !c.ativo && "opacity-60")}>
              {massa && <td className="w-px pl-4 pr-1 py-2.5" onClick={(ev) => ev.stopPropagation()}><CheckboxLinha id={c.id} rotulo={c.nome} /></td>}
              <td className={massa ? "pl-2 pr-3 py-2.5" : "pl-4 pr-3 py-2.5"}>
                <div className="flex items-center gap-3 min-w-[200px]">
                  <AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={40} />
                  <div className="min-w-0">
                    <p data-nome className="font-semibold text-ink truncate max-w-[240px]">{c.nome}</p>
                    <p className="text-xs text-ink-muted">{c.atividades} atividade{c.atividades === 1 ? "" : "s"}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 max-w-[220px]" data-cargo>
                <p className="text-ink truncate">{c.cargo ?? c.funcaoLabel}</p>
                {c.cargo && <p className="text-xs text-ink-muted truncate">{c.funcaoLabel}</p>}
              </td>
              <td className="px-3 py-2.5"><Equipes c={c} /></td>
              <td className="px-3 py-2.5 whitespace-nowrap text-xs text-ink-muted">
                <p className="flex items-center gap-1 text-ink"><Phone className="w-3 h-3 text-ink-subtle" />{formatarTelefone(c.telefone)}</p>
                {c.email && <p className="truncate max-w-[200px]">{c.email}</p>}
              </td>
              <td className="px-3 py-2.5">{c.documento ? <DocSelo c={c} /> : <span className="text-xs text-ink-subtle">—</span>}</td>
              <td className="px-3 py-2.5"><StatusColaboradorSelo status={c.status} /></td>
              <td className="pl-2 pr-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                <div className="flex items-center justify-end gap-0.5">
                  <Link href={`/colaboradores/${c.id}/editar`} title="Editar" className="p-1 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><Pencil className="w-4 h-4" /></Link>
                  <InativarRegistro url={`/api/tecnicos/${c.id}`} modulo="equipes" acaoReativar="gerenciar" ativo={c.ativo} nome={c.nome} entidade="colaborador" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── Celular ───────── */
function LinhaMobile({ c }: { c: ColaboradorLinha }) {
  return (
    <Link href={`/colaboradores/${c.id}/editar`} data-colaborador-id={c.id} className={cn("flex items-start gap-3 p-3 active:bg-surface-alt", !c.ativo && "opacity-60")}>
      <AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p data-nome className="font-semibold text-ink leading-tight truncate">{c.nome}</p>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" />
        </div>
        <p className="text-xs text-ink-muted truncate">{funcaoCargo(c)}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {c.status !== "ATIVO" && <StatusColaboradorSelo status={c.status} />}
          <Equipes c={c} max={1} />
          <DocSelo c={c} />
        </div>
      </div>
    </Link>
  );
}

/* ───────── Cards (desktop, alternativo) ───────── */
function Cards({ massa, itens }: { massa: boolean; itens: ColaboradorLinha[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4" data-visao="cards">
      {itens.map((c) => (
        <div key={c.id} className="relative">
        {massa && <CheckboxLinha id={c.id} rotulo={c.nome} className="absolute top-2 left-2 z-10 bg-white rounded p-1.5 m-0 shadow-sm" />}
        <Link href={`/colaboradores/${c.id}/editar`} data-colaborador-id={c.id}
          className={cn("h-full group bg-white border border-surface-border rounded-xl p-4 hover:shadow-md hover:border-primary-300 transition-all flex flex-col gap-3", !c.ativo && "opacity-60")}>
          <div className="flex items-start gap-3">
            <AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 data-nome className="font-semibold text-ink leading-tight truncate group-hover:text-primary-600">{c.nome}</h3>
                <StatusColaboradorSelo status={c.status} className="shrink-0" />
              </div>
              <p data-cargo className="text-sm text-ink-muted truncate">{c.cargo ?? c.funcaoLabel}</p>
              {c.cargo && <p className="text-xs text-ink-subtle truncate">{c.funcaoLabel}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap"><Equipes c={c} /><DocSelo c={c} /></div>
          <p className="mt-auto text-xs text-ink-muted truncate flex items-center gap-1.5 pt-2 border-t border-surface-border/70">
            <Phone className="w-3.5 h-3.5 shrink-0" /> {formatarTelefone(c.telefone)}
            <span className="ml-auto inline-flex items-center gap-1 text-ink-subtle"><Users className="w-3.5 h-3.5" />{c.atividades} ativ.</span>
          </p>
        </Link>
        </div>
      ))}
    </div>
  );
}
