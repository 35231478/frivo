"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Eye, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { CampoBusca, ListaVazia, SkeletonLista } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { ItensChecklist } from "@/components/veiculos/itens-checklist";
import { PLANILHA } from "@/lib/planilha";
import { cn, formatarDataHora } from "@/lib/utils";
import { PERMISSAO_CHECKLIST, ROTULO_STATUS_CHECKLIST, primeiroObrigatorioFaltando, type ItemDoModelo, type RespostaDoItem } from "@/lib/veiculos/checklist";

interface Linha {
  id: string; status: string; criadoEm: string; editadoEm: string | null; inativadoEm: string | null; veiculoId: string;
  veiculo: { placa: string; modelo: string }; colaborador: { nome: string } | null; template: { nome: string };
  inativadoPor: { nome: string } | null; totalItens: number; alertas: number;
}
interface Detalhe extends Omit<Linha, "totalItens" | "alertas"> {
  observacaoGeral: string | null;
  colaborador: { id: string; nome: string } | null;
  editadoPor: { nome: string } | null;
  itens: { id: string; itemTemplateId: string; valor: string | null; foto: string | null; alerta: boolean; itemTemplate: ItemDoModelo }[];
}
type Aba = "ativos" | "inativos";

const AJUDA = "Checklists já enviados. Excluir é reversível: o checklist inativado sai da lista e das contagens, e pode ser reativado na aba Inativos.";

/** O erro que a rota devolveu ({ erro }) ou o texto de reserva */
async function erroDa(res: Response, reserva: string): Promise<string> {
  const j = await res.json().catch(() => null);
  return (j && typeof j.erro === "string" && j.erro) || reserva;
}

const selo = (status: string) => (
  <span data-status-checklist={status} className={cn("inline-flex text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap",
    status === "COM_ALERTAS" ? "bg-atencao-claro text-atencao-texto" : status === "CONCLUIDO" ? "bg-ok-claro text-ok-texto" : "bg-surface-alt text-ink-muted")}>
    {ROTULO_STATUS_CHECKLIST[status] ?? status}
  </span>
);

/**
 * Checklists de veículo PREENCHIDOS, no padrão de lista (tabela no desktop, cartões no celular), com
 * Detalhe, Editar e Excluir — reversível: inativa, e a aba "Inativos" traz o Reativar.
 *
 * Ver: Veículos › visualizar. Editar e reativar: Veículos › gerenciar. Inativar: Veículos › excluir.
 * São as mesmas permissões das rotas, que recusam de qualquer jeito; se o servidor recusa, a lista
 * não muda e o motivo aparece. Com `veiculoId`, lista só os daquele veículo (aba do cadastro).
 */
export function ChecklistsPreenchidos({ veiculoId, colaboradores, onMudou }: {
  veiculoId?: string; colaboradores: { id: string; nome: string }[];
  /** Depois de editar, excluir ou reativar (a ficha do veículo recarrega as contagens) */
  onMudou?: () => void;
}) {
  const { pode } = usePermissoes();
  const podeEditar = pode(PERMISSAO_CHECKLIST.editar.modulo, PERMISSAO_CHECKLIST.editar.acao);
  const podeInativar = pode(PERMISSAO_CHECKLIST.inativar.modulo, PERMISSAO_CHECKLIST.inativar.acao);
  const podeReativar = pode(PERMISSAO_CHECKLIST.reativar.modulo, PERMISSAO_CHECKLIST.reativar.acao);

  const [aba, setAba] = useState<Aba>("ativos");
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [erroLista, setErroLista] = useState("");
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ id: string; modo: "ver" | "editar" } | null>(null);

  const carregar = useCallback(async (qual: Aba) => {
    setErroLista("");
    try {
      const p = new URLSearchParams();
      if (veiculoId) p.set("veiculoId", veiculoId);
      if (qual === "inativos") p.set("inativos", "1");
      const res = await fetch(`/api/checklists?${p}`, { cache: "no-store" });
      if (!res.ok) { setErroLista(await erroDa(res, "Não foi possível carregar os checklists.")); setLista([]); return; }
      const d = await res.json();
      setLista(Array.isArray(d) ? d : []);
    } catch { setErroLista("Sem conexão. Tente de novo."); setLista([]); }
  }, [veiculoId]);
  useEffect(() => { setLista(null); void carregar(aba); }, [aba, carregar]);

  const q = busca.trim().toLowerCase();
  const filtrada = useMemo(() => (lista ?? []).filter((c) => !q
    || `${c.veiculo.placa} ${c.veiculo.modelo} ${c.colaborador?.nome ?? ""} ${c.template.nome}`.toLowerCase().includes(q)), [lista, q]);

  const nome = (c: Linha) => `o checklist de ${c.veiculo.placa} de ${formatarDataHora(c.criadoEm)}`;

  async function inativar(c: Linha) {
    if (!(await confirmar({
      titulo: "Excluir este checklist?",
      mensagem: `Sai da lista e das contagens ${nome(c)}. As respostas ficam guardadas; dá para reativar na aba Inativos.`,
      perigo: true, confirmarTexto: "Excluir",
    }))) return;
    setOcupado(c.id);
    try {
      const res = await fetch(`/api/checklists/${c.id}`, { method: "DELETE" });
      if (!res.ok) { toast(await erroDa(res, "Não foi possível excluir o checklist."), "erro"); return; }
      toast("Checklist excluído. Está na aba Inativos.");
      await carregar(aba); onMudou?.();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setOcupado(null); }
  }

  async function reativar(c: Linha) {
    setOcupado(c.id);
    try {
      const res = await fetch(`/api/checklists/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: true }) });
      if (!res.ok) { toast(await erroDa(res, "Não foi possível reativar o checklist."), "erro"); return; }
      toast("Checklist reativado.");
      await carregar(aba); onMudou?.();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setOcupado(null); }
  }

  const btn = "p-2.5 sm:p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-40";
  const acoes = (c: Linha) => (
    <span className="inline-flex items-center justify-end gap-0.5" data-acoes-checklist>
      <button type="button" onClick={() => setAberto({ id: c.id, modo: "ver" })} aria-label={`Ver ${nome(c)}`} title="Detalhe" className={btn} data-ver-checklist={c.id}><Eye className="w-4 h-4" aria-hidden /></button>
      {aba === "ativos" && podeEditar && (
        <button type="button" onClick={() => setAberto({ id: c.id, modo: "editar" })} aria-label={`Editar ${nome(c)}`} title="Editar" className={btn} data-editar-checklist={c.id}><Pencil className="w-4 h-4" aria-hidden /></button>
      )}
      {aba === "ativos" && podeInativar && (
        <button type="button" onClick={() => void inativar(c)} disabled={ocupado === c.id} aria-label={`Excluir ${nome(c)}`} title="Excluir" className={cn(btn, "hover:text-atrasado hover:bg-atrasado-claro")} data-inativar-checklist={c.id}><Ban className="w-4 h-4" aria-hidden /></button>
      )}
      {aba === "inativos" && podeReativar && (
        <button type="button" onClick={() => void reativar(c)} disabled={ocupado === c.id} aria-label={`Reativar ${nome(c)}`} title="Reativar" className={cn(btn, "hover:text-ok-texto hover:bg-ok-claro")} data-reativar-checklist={c.id}><RotateCcw className="w-4 h-4" aria-hidden /></button>
      )}
    </span>
  );
  const resumo = (c: Linha) => `${c.totalItens} ${c.totalItens === 1 ? "item" : "itens"}${c.alertas ? ` · ${c.alertas} ${c.alertas === 1 ? "alerta" : "alertas"}` : ""}`;

  const colunas: ColunaPro[] = [
    { id: "data", titulo: aba === "inativos" ? "Preenchido em" : "Data", largura: 132, obrigatoria: true },
    ...(veiculoId ? [] : [{ id: "veiculo", titulo: "Veículo", largura: 190, obrigatoria: true, classe: "truncate" }]),
    { id: "modelo", titulo: "Modelo de checklist", minimo: 160, classe: "truncate" },
    { id: "colaborador", titulo: "Colaborador", largura: 170, classe: "truncate" },
    { id: "itens", titulo: "Itens", largura: 150 },
    { id: "status", titulo: "Status", largura: 116 },
    ...(aba === "inativos" ? [{ id: "inativado", titulo: "Excluído em", largura: 200, classe: "truncate" }] : []),
    { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 104, alinhar: "direita" as const, classe: "py-0.5" },
  ];

  return (
    <div className="space-y-3" data-checklists-preenchidos>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-surface-border bg-white p-0.5" role="tablist" aria-label="Situação dos checklists">
          {(["ativos", "inativos"] as Aba[]).map((a) => (
            <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)} data-aba-checklists={a}
              className={cn("px-3 py-1.5 text-sm font-medium rounded-md transition-colors", aba === a ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:text-ink")}>
              {a === "ativos" ? "Preenchidos" : "Inativos"}
            </button>
          ))}
        </div>
        <Dica texto={AJUDA} rotulo="Checklists preenchidos" lado="direita" />
        <div className="basis-full sm:basis-0 sm:flex-1 sm:min-w-[12rem]">
          <CampoBusca valor={busca} onChange={setBusca} placeholder={veiculoId ? "Pesquisar por colaborador ou modelo" : "Pesquisar por placa, colaborador ou modelo"} rotulo="Pesquisar checklists" atalho={false} />
        </div>
      </div>

      <div className="bg-white border border-surface-border rounded-card overflow-hidden">
        {erroLista && <p role="alert" className="px-4 py-3 text-sm text-atrasado-texto bg-atrasado-claro border-b border-atrasado/20" data-erro-checklists>{erroLista}</p>}
        {lista === null ? <SkeletonLista linhas={4} /> : filtrada.length === 0 ? (
          <ListaVazia mensagem={q ? "Nenhum checklist encontrado" : aba === "inativos" ? "Nenhum checklist inativo" : "Nenhum checklist preenchido"} busca={q ? busca.trim() : undefined} onLimpar={() => setBusca("")} />
        ) : (
          <>
            <ul className="sm:hidden divide-y divide-surface-border" data-cartoes>
              {filtrada.map((c) => (
                <li key={c.id} data-cartao={c.id} className="flex items-start gap-2 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{veiculoId ? formatarDataHora(c.criadoEm) : `${c.veiculo.placa} · ${c.veiculo.modelo}`}</p>
                    <p className="text-xs text-ink-muted truncate">{[veiculoId ? null : formatarDataHora(c.criadoEm), c.template.nome, c.colaborador?.nome].filter(Boolean).join(" · ")}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">{selo(c.status)}<span>{resumo(c)}</span></div>
                    {c.inativadoEm && <p className="mt-1 text-xs text-ink-subtle">Excluído em {formatarDataHora(c.inativadoEm)}{c.inativadoPor ? ` por ${c.inativadoPor.nome}` : ""}</p>}
                  </div>
                  <div className="shrink-0 -mr-1">{acoes(c)}</div>
                </li>
              ))}
            </ul>
            <TabelaPro
              tela={veiculoId ? "checklists-do-veiculo" : "checklists-veiculo"} quebra="sm" atributos={{ "data-tabela-checklists": true }}
              barra={<span data-contagem-checklists>{filtrada.length === 1 ? "1 checklist" : `${filtrada.length} checklists`}</span>}
              colunas={colunas}
              linhas={filtrada.map((c) => ({
                id: c.id, atributos: { "data-checklist": c.id }, titulos: { veiculo: `${c.veiculo.placa} · ${c.veiculo.modelo}`, modelo: c.template.nome, colaborador: c.colaborador?.nome },
                celulas: {
                  data: <span className={PLANILHA.data}>{formatarDataHora(c.criadoEm)}</span>,
                  veiculo: <span><span className={PLANILHA.codigo}>{c.veiculo.placa}</span> <span className={PLANILHA.apagado}>{c.veiculo.modelo}</span></span>,
                  modelo: <span className="text-ink">{c.template.nome}</span>,
                  colaborador: c.colaborador ? <span className={PLANILHA.apagado}>{c.colaborador.nome}</span> : <span className="text-ink-subtle">—</span>,
                  itens: <span className={cn(PLANILHA.apagado, "whitespace-nowrap")}>{resumo(c)}{c.editadoEm ? " · editado" : ""}</span>,
                  status: selo(c.status),
                  inativado: <span className={PLANILHA.apagado}>{c.inativadoEm ? formatarDataHora(c.inativadoEm) : ""}{c.inativadoPor ? ` · ${c.inativadoPor.nome}` : ""}</span>,
                  acoes: acoes(c),
                },
              }))}
            />
          </>
        )}
      </div>

      <PainelDoChecklist
        aberto={aberto} colaboradores={colaboradores} podeEditar={podeEditar}
        onFechar={() => setAberto(null)} onEditar={() => setAberto((a) => (a ? { ...a, modo: "editar" } : a))}
        onSalvo={() => { setAberto(null); void carregar(aba); onMudou?.(); }}
      />
    </div>
  );
}

/** A gaveta do checklist: o detalhe (só leitura) ou a correção das respostas */
function PainelDoChecklist({ aberto, colaboradores, podeEditar, onFechar, onEditar, onSalvo }: {
  aberto: { id: string; modo: "ver" | "editar" } | null; colaboradores: { id: string; nome: string }[]; podeEditar: boolean;
  onFechar: () => void; onEditar: () => void; onSalvo: () => void;
}) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState("");
  const [respostas, setRespostas] = useState<Record<string, RespostaDoItem>>({});
  const [observacao, setObservacao] = useState("");
  const [colaboradorId, setColaboradorId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const id = aberto?.id ?? null;

  useEffect(() => {
    if (!id) { setD(null); return; }
    let vivo = true;
    setD(null); setErro("");
    (async () => {
      try {
        const res = await fetch(`/api/checklists/${id}`, { cache: "no-store" });
        if (!vivo) return;
        if (!res.ok) { setErro(await erroDa(res, "Não foi possível abrir o checklist.")); return; }
        const c: Detalhe = await res.json();
        if (!vivo) return;
        setD(c);
        setRespostas(Object.fromEntries(c.itens.map((i) => [i.itemTemplateId, { valor: i.valor, foto: i.foto }])));
        setObservacao(c.observacaoGeral ?? "");
        setColaboradorId(c.colaborador?.id ?? "");
      } catch { if (vivo) setErro("Sem conexão. Tente de novo."); }
    })();
    return () => { vivo = false; };
  }, [id]);

  const itens = useMemo(() => (d ? d.itens.map((i) => i.itemTemplate) : []), [d]);
  const editando = aberto?.modo === "editar" && podeEditar && !!d && !d.inativadoEm;

  async function salvar() {
    if (!d) return;
    const falta = primeiroObrigatorioFaltando(itens, respostas);
    if (falta) { setErro(falta); return; }
    setErro(""); setSalvando(true);
    try {
      const antes = new Map(d.itens.map((i) => [i.itemTemplateId, i]));
      const corpo = {
        colaboradorId: colaboradorId || null, observacaoGeral: observacao,
        // a foto só vai se mudou (o que não vai, o servidor mantém)
        itens: itens.map((it) => {
          const r = respostas[it.id] ?? { valor: null, foto: null };
          return { itemTemplateId: it.id, valor: r.valor, ...(r.foto !== antes.get(it.id)?.foto ? { foto: r.foto } : {}) };
        }),
      };
      const res = await fetch(`/api/checklists/${d.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) { setErro(await erroDa(res, "Não foi possível salvar o checklist.")); return; }
      toast("Checklist atualizado.");
      onSalvo();
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  const titulo = !d ? "Checklist" : editando ? `Editando o checklist de ${d.veiculo.placa}` : `Checklist de ${d.veiculo.placa}`;
  return (
    <Drawer
      aberto={!!aberto} onFechar={onFechar} titulo={titulo}
      rodape={d && (editando ? (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando} data-salvar-checklist>Salvar</Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          {podeEditar && !d.inativadoEm && <Button onClick={onEditar} data-editar-no-detalhe><Pencil className="w-4 h-4" aria-hidden /> Editar</Button>}
        </div>
      ))}
    >
      <div className="space-y-4" data-painel-checklist={editando ? "editar" : "ver"}>
        {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-checklist>{erro}</p>}
        {!d && !erro && <SkeletonLista linhas={5} />}
        {d && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-cabecalho-checklist>
              <div><dt className="text-xs text-ink-muted">Veículo</dt><dd className="text-ink">{d.veiculo.placa} · {d.veiculo.modelo}</dd></div>
              <div><dt className="text-xs text-ink-muted">Modelo de checklist</dt><dd className="text-ink">{d.template.nome}</dd></div>
              <div><dt className="text-xs text-ink-muted">Preenchido em</dt><dd className="text-ink">{formatarDataHora(d.criadoEm)}</dd></div>
              <div><dt className="text-xs text-ink-muted">Status</dt><dd>{selo(d.status)}</dd></div>
              {d.editadoEm && <div className="col-span-2" data-editado><dt className="text-xs text-ink-muted">Última edição</dt><dd className="text-ink">{formatarDataHora(d.editadoEm)}{d.editadoPor ? ` · ${d.editadoPor.nome}` : ""}</dd></div>}
              {d.inativadoEm && <div className="col-span-2" data-inativado><dt className="text-xs text-ink-muted">Excluído em</dt><dd className="text-ink">{formatarDataHora(d.inativadoEm)}{d.inativadoPor ? ` · ${d.inativadoPor.nome}` : ""}</dd></div>}
            </dl>

            {editando ? (
              <FormField label="Colaborador">
                <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)} placeholder="Sem colaborador" data-colaborador-checklist>
                  {[...colaboradores, ...(d.colaborador && !colaboradores.some((c) => c.id === d.colaborador!.id) ? [d.colaborador] : [])].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </Select>
              </FormField>
            ) : (
              <div className="text-sm"><p className="text-xs text-ink-muted">Colaborador</p><p className="text-ink">{d.colaborador?.nome ?? "Sem colaborador"}</p></div>
            )}

            <ItensChecklist
              itens={itens} respostas={respostas} somenteLeitura={!editando}
              onResposta={(itemId, r) => setRespostas((p) => ({ ...p, [itemId]: r }))} onErro={setErro}
            />

            {editando ? (
              <FormField label="Observação geral">
                <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} data-observacao-checklist />
              </FormField>
            ) : (
              <div className="text-sm" data-observacao-checklist><p className="text-xs text-ink-muted">Observação geral</p><p className={cn("whitespace-pre-wrap", d.observacaoGeral ? "text-ink" : "text-ink-subtle")}>{d.observacaoGeral ?? "Sem observação"}</p></div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
