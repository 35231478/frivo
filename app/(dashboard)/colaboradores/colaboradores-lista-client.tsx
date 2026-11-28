"use client";

import { CheckboxLinha, CheckboxPagina, useAcoesMassaDisponiveis } from "@/components/acoes-massa/selecao";
import { useMemo, useState } from "react";
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
import { AlternarVisao, CampoBusca, sugerirPorUrl, ChipResumo, MultiSelect, Paginacao, SelectFiltro, type Opcao } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { toast } from "@/components/ui/avisos";
import type { FiltrosColaboradores, OrdemColaboradores } from "@/lib/colaborador-listagem";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";
import { MSG_RT_SEM_CREA, ROTULO_CAMPO, ROTULO_RT, gravarFuncao } from "@/lib/colaborador/funcao";

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
  ATIVO: { txt: "Ativo", cls: "text-ok-texto bg-ok-claro", dot: "bg-ok" },
  FERIAS: { txt: "Férias", cls: "text-acento-hover bg-acento-claro", dot: "bg-acento" },
  AFASTADO: { txt: "Afastado", cls: "text-atencao-texto bg-atencao-claro", dot: "bg-atencao" },
  INATIVO: { txt: "Inativo", cls: "text-ink-muted bg-surface-linha", dot: "bg-ink-subtle" },
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
  const roteador = useRouter();
  const sugerir = useMemo(() => sugerirPorUrl("/api/listas/sugestoes?lista=colaboradores"), []);
  const [filtrosMobile, setFiltrosMobile] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);

  function ordenar(k: OrdemColaboradores) {
    const dir = f.ordem === k ? (f.dir === "asc" ? "desc" : "asc") : "asc";
    navegar({ ordem: k === "nome" ? null : k, dir: dir === "asc" ? null : "desc" });
  }
  const filtrosAtivos = [f.q, f.funcoes.length, f.cargo, f.equipe, f.status !== "ativo", f.aviso].filter(Boolean).length;
  const alternarAviso = (a: FiltrosColaboradores["aviso"]) => navegar({ aviso: f.aviso === a ? null : a, ...(f.status === "inativo" ? { status: null } : {}) });

  // Cadastro direto (mesmo mini-cadastro do #9/#10) + a função (as duas chaves da ficha, lib/colaborador/funcao) e cargo
  const camposNovo: CampoRapido[] = [
    ...TECNICO.campos,
    { nome: "campo", label: ROTULO_CAMPO, tipo: "select", colunas: 3, placeholder: "Sim", opcoes: [{ value: "nao", label: "Não" }] },
    { nome: "rt", label: ROTULO_RT, tipo: "select", colunas: 3, placeholder: "Não", opcoes: [{ value: "sim", label: "Sim" }] },
    { nome: "crea", label: "CREA (do responsável técnico)", colunas: 3, placeholder: "Ex: 5012345-D/SP", maxLength: 60 },
    ...(opcoes.cargos.length ? [{ nome: "cargoId", label: "Cargo", tipo: "select", colunas: 3, placeholder: "Sem cargo", opcoes: opcoes.cargos } as CampoRapido] : []),
  ];

  return (
    <div className="space-y-4" data-listagem-colaboradores>
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-2 bg-surface-alt rounded-lg hidden sm:block"><HardHat className="w-5 h-5 text-ink-muted" /></div>
          <h1 className="page-title">Colaboradores</h1>
          <span data-total className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total.toLocaleString("pt-BR")}</span>
          {pendente && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <AlternarVisao visao={visao} onTrocar={trocarVisao} />
          {podeGerenciar && <ImportarPlanilha entidade="colaboradores" />}
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
          icone={CheckCircle2} cor="text-ok-texto" rotulo="Ativos" valor={resumo.ativos} />
        <ChipResumo id="inativos" ativo={f.status === "inativo"} onClick={() => navegar({ status: f.status === "inativo" ? null : "inativo", aviso: null })}
          icone={Ban} cor="text-ink-muted" rotulo="Inativos" valor={resumo.inativos} />
        <ChipResumo id="tecnicos" ativo={f.aviso === "tecnicos"} onClick={() => alternarAviso("tecnicos")}
          icone={Wrench} cor="text-primary-600" rotulo="Técnicos" valor={resumo.tecnicos} />
        <ChipResumo id="sem_equipe" ativo={f.aviso === "sem_equipe"} onClick={() => alternarAviso("sem_equipe")}
          icone={UserX} cor="text-atencao-texto" rotulo="Sem equipe" valor={resumo.semEquipe} />
        <ChipResumo id="ausente" ativo={f.aviso === "ausente"} onClick={() => alternarAviso("ausente")}
          icone={Plane} cor="text-acento-hover" rotulo="Férias / afastados" valor={resumo.ausentes} />
        <ChipResumo id="doc_vencido" ativo={f.aviso === "doc_vencido"} onClick={() => alternarAviso("doc_vencido")}
          icone={FileX} cor="text-atrasado" rotulo="Documento vencido" valor={resumo.docVencido} />
        <ChipResumo id="doc_vencendo" ativo={f.aviso === "doc_vencendo"} onClick={() => alternarAviso("doc_vencendo")}
          icone={FileWarning} cor="text-atencao-texto" rotulo="Documento vencendo" valor={resumo.docVencendo} />
      </div>

      {/* ── Busca + filtros ── */}
      <div className="bg-white border border-surface-border rounded-card p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_auto] gap-2 items-center">
          <CampoBusca valor={busca} onChange={setBusca} carregando={pendente} sugerir={sugerir} onEscolher={(s) => s.href && roteador.push(s.href)} rotulo="Pesquisar colaborador" placeholder="Pesquisar nome, CPF, telefone, e-mail ou cargo…" />
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
              <button onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-atrasado">
                <X className="w-3.5 h-3.5" /> Limpar filtros ({filtrosAtivos})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className={cn("transition-opacity", pendente && "opacity-60")}>
        {itens.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-card text-center py-16">
            <HardHat className="w-10 h-10 text-ink-subtle mx-auto mb-3" />
            <p className="text-ink font-medium">{f.q ? `Nenhum colaborador encontrado para “${f.q}”` : "Nenhum colaborador encontrado"}</p>
            <p className="text-sm text-ink-muted mt-1">{filtrosAtivos > 0 ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro colaborador."}</p>
            {filtrosAtivos > 0 && <button onClick={limpar} className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>}
          </div>
        ) : (
          <>
            <div className="md:hidden bg-white border border-surface-border rounded-card divide-y divide-surface-border overflow-hidden" data-visao="mobile">
              {itens.map((c) => (
                <div key={c.id} className="flex items-stretch">
                  {massa && <div className="pl-3 pt-4"><CheckboxLinha id={c.id} rotulo={c.nome} /></div>}
                  <div className="min-w-0 flex-1"><LinhaMobile c={c} podeGerenciar={podeGerenciar} /></div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              {visao === "lista" ? <Tabela massa={massa} itens={itens} f={f} onOrdenar={ordenar} podeGerenciar={podeGerenciar} /> : <Cards massa={massa} itens={itens} podeGerenciar={podeGerenciar} />}
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
            const funcao = gravarFuncao({ campo: v.campo !== "nao", rt: v.rt === "sim" });
            const crea = (v.crea ?? "").trim();
            if (funcao.tipo === "RESPONSAVEL_TECNICO" && !crea) throw new Error(MSG_RT_SEM_CREA);
            const res = await fetch("/api/tecnicos", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nome: v.nome, cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`, telefone: v.telefone,
                ...funcao, ...(crea && { crea }), ...(v.cargoId && { cargoId: v.cargoId }), competenciaIds: [],
              }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.erro ?? "Erro ao cadastrar o colaborador.");
            return { value: d.id, label: d.nome };
          }}
          // Mostra quem acabou de ser cadastrado (senão ele poderia cair em outra página da lista)
          onCriado={(o) => { setNovoAberto(false); toast("Colaborador cadastrado."); setBusca(o.label); navegar({ q: o.label, status: null, aviso: null, funcoes: null, cargo: null, equipe: null }); }}
        />
      )}
    </div>
  );
}

/* ───────── Equipes / avisos ───────── */
function Equipes({ c, max = 2 }: { c: ColaboradorLinha; max?: number }) {
  if (c.semEquipe) return <span data-sem-equipe className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-atencao-texto bg-atencao-claro"><UserX className="w-3 h-3" /> Sem equipe</span>;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {c.lider && <span title="Líder de equipe" className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full text-atencao-texto bg-atencao-claro"><Crown className="w-3 h-3" /> Líder</span>}
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
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", v ? "text-atrasado-texto bg-atrasado-claro" : "text-atencao-texto bg-atencao-claro")}>
      {v ? <FileX className="w-3 h-3" /> : <FileWarning className="w-3 h-3" />}
      {c.documento.nome.length > 14 ? "Documento" : c.documento.nome} {v ? "vencido" : formatarData(c.documento.data)}
    </span>
  );
}

/* ───────── Tabela (desktop) ───────── */
// As larguras somam o que cabe num notebook (1440px com o menu aberto) sem rolar de lado
const COLUNAS: ColunaPro[] = [
  { id: "colaborador", titulo: "Colaborador", ordenar: "nome", obrigatoria: true, minimo: 200 },
  { id: "cargo", titulo: "Cargo e função", ordenar: "cargo", largura: 168, classe: "truncate" },
  { id: "equipe", titulo: "Equipe", largura: 164 },
  { id: "contato", titulo: "Contato", largura: 142, classe: "truncate" },
  { id: "atividades", titulo: "Atividades", largura: 90, alinhar: "direita" },
  { id: "avisos", titulo: "Avisos", largura: 132 },
  { id: "status", titulo: "Status", largura: 96 },
  { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 76, alinhar: "direita", classe: "py-0.5" },
];

/**
 * A ficha do colaborador (CPF, documentos) só abre para quem tem Equipes › gerenciar — a página e a
 * rota recusam os demais. Sem a permissão, o nome não é link e a linha não tem Editar nem Inativar.
 */
function Tabela({ massa, itens, f, onOrdenar, podeGerenciar }: {
  massa: boolean; itens: ColaboradorLinha[]; f: FiltrosColaboradores; onOrdenar: (k: OrdemColaboradores) => void; podeGerenciar: boolean;
}) {
  return (
    <TabelaPro
      tela="colaboradores" className="bg-white border border-surface-border rounded-card overflow-hidden" atributos={{ "data-visao": "lista", "data-tabela-colaboradores": true }}
      ordenacao={{ ativa: f.ordem, dir: f.dir, onOrdenar: (k) => onOrdenar(k as OrdemColaboradores) }}
      barra={<span>{itens.length === 1 ? "1 colaborador nesta página" : `${itens.length} colaboradores nesta página`}</span>}
      colunas={[
        ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
        ...COLUNAS,
      ]}
      linhas={itens.map((c) => {
        const nome = <><AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={26} /><span data-nome className={cn(PLANILHA.nome, "truncate")}>{c.nome}</span></>;
        const contato = [formatarTelefone(c.telefone), c.email].filter(Boolean).join(" · ");
        return {
          id: c.id, atributos: { "data-colaborador-id": c.id }, classe: c.ativo ? undefined : "opacity-60",
          href: podeGerenciar ? `/colaboradores/${c.id}/editar` : undefined,
          titulos: { colaborador: c.nome, cargo: funcaoCargo(c), contato },
          celulas: {
            sel: massa ? <CheckboxLinha id={c.id} rotulo={c.nome} /> : null,
            colaborador: podeGerenciar
              ? <Link href={`/colaboradores/${c.id}/editar`} className="flex items-center gap-2 min-w-0 hover:text-primary-600">{nome}</Link>
              : <span className="flex items-center gap-2 min-w-0">{nome}</span>,
            cargo: <span data-cargo className="text-ink">{funcaoCargo(c)}</span>,
            equipe: <Equipes c={c} max={1} />,
            contato: <span className={PLANILHA.apagado}>{contato}</span>,
            atividades: <span className="tabular-nums">{c.atividades}</span>,
            avisos: c.documento ? <DocSelo c={c} /> : <span className="text-xs text-ink-subtle">—</span>,
            status: <StatusColaboradorSelo status={c.status} />,
            acoes: (
              <span className="inline-flex items-center justify-end gap-0.5" data-acoes-colaborador={c.id}>
                {podeGerenciar && (
                  <Link href={`/colaboradores/${c.id}/editar`} title="Editar" aria-label={`Editar ${c.nome}`} data-editar-colaborador
                    className="p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50"><Pencil className="w-4 h-4" aria-hidden /></Link>
                )}
                <InativarRegistro url={`/api/tecnicos/${c.id}`} modulo="equipes" acaoReativar="gerenciar" ativo={c.ativo} nome={c.nome} entidade="colaborador" />
              </span>
            ),
          },
        };
      })}
    />
  );
}

/* ───────── Celular ───────── */
function LinhaMobile({ c, podeGerenciar }: { c: ColaboradorLinha; podeGerenciar: boolean }) {
  const Caixa = podeGerenciar ? Link : SemLink;
  return (
    <Caixa href={`/colaboradores/${c.id}/editar`} data-colaborador-id={c.id} className={cn("flex items-start gap-3 p-3 active:bg-surface-alt", !c.ativo && "opacity-60")}>
      <AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p data-nome className="font-semibold text-ink leading-tight truncate">{c.nome}</p>
          {podeGerenciar && <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" aria-hidden />}
        </div>
        <p className="text-xs text-ink-muted truncate">{funcaoCargo(c)}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {c.status !== "ATIVO" && <StatusColaboradorSelo status={c.status} />}
          <Equipes c={c} max={1} />
          <DocSelo c={c} />
        </div>
      </div>
    </Caixa>
  );
}

/** O mesmo cartão sem navegação (quem não pode abrir a ficha) */
function SemLink({ href: _href, children, ...resto }: { href: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...resto}>{children}</div>;
}

/* ───────── Cards (desktop, alternativo) ───────── */
function Cards({ massa, itens, podeGerenciar }: { massa: boolean; itens: ColaboradorLinha[]; podeGerenciar: boolean }) {
  const Caixa = podeGerenciar ? Link : SemLink;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4" data-visao="cards">
      {itens.map((c) => (
        <div key={c.id} className="relative">
        {massa && <CheckboxLinha id={c.id} rotulo={c.nome} className="absolute top-2 left-2 z-10 bg-white rounded p-1.5 m-0 shadow-sm" />}
        <Caixa href={`/colaboradores/${c.id}/editar`} data-colaborador-id={c.id}
          className={cn("h-full group bg-white border border-surface-border rounded-card p-4 transition-all flex flex-col gap-3", podeGerenciar && "hover:shadow-md hover:border-primary-300", !c.ativo && "opacity-60")}>
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
          <p className="mt-auto text-xs text-ink-muted truncate flex items-center gap-1.5 pt-2 pr-8 border-t border-surface-border/70">
            <Phone className="w-3.5 h-3.5 shrink-0" /> {formatarTelefone(c.telefone)}
            <span className="ml-auto inline-flex items-center gap-1 text-ink-subtle"><Users className="w-3.5 h-3.5" />{c.atividades} ativ.</span>
          </p>
        </Caixa>
        {/* Fora do link (o modal não navega ao fechar): o mesmo Inativar/Reativar da lista */}
        <span className="absolute bottom-2 right-2" data-acoes-cartao={c.id}>
          <InativarRegistro url={`/api/tecnicos/${c.id}`} modulo="equipes" acaoReativar="gerenciar" ativo={c.ativo} nome={c.nome} entidade="colaborador" />
        </span>
        </div>
      ))}
    </div>
  );
}
