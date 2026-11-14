"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { Drawer } from "@/components/ui/drawer";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { SomenteLeitura, erroDaResposta } from "@/components/config/permissao-config";
import { CampoBusca, ListaVazia, SkeletonLista } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { Plus, Pencil, Ban, Trash2, Check, ArrowUp, ListChecks } from "lucide-react";

const FREQUENCIAS = [{ v: "DIARIO", l: "Diário" }, { v: "SEMANAL", l: "Semanal" }, { v: "MENSAL", l: "Mensal" }];
const TIPOS_ITEM = [
  { v: "OK_NOK", l: "OK / NOK" },
  { v: "NIVEL", l: "Níveis (opções)" },
  { v: "TEXTO", l: "Texto livre" },
  { v: "FOTO", l: "Foto" },
];

const AJUDA = "Modelos do checklist que o colaborador preenche no veículo. Inativar tira o modelo dos próximos preenchimentos; os já feitos continuam no histórico do veículo.";
const PERMISSAO = "Configurações › gerenciar ou Frota › gerenciar";

const COLUNAS: ColunaPro[] = [
  { id: "nome", titulo: "Nome", obrigatoria: true, minimo: 160 },
  { id: "frequencia", titulo: "Frequência", largura: 120 },
  { id: "itens", titulo: "Itens", largura: 80, alinhar: "direita" },
  { id: "preenchidos", titulo: "Preenchimentos", largura: 130, alinhar: "direita" },
  { id: "acoes", titulo: "Ações", semTitulo: true, fixa: true, largura: 84, alinhar: "direita" },
];

interface ItemForm { id?: string; categoria: string; descricao: string; tipo: string; opcoesStr: string; obrigatorio: boolean }
interface Modelo { id: string; nome: string; descricao?: string | null; frequencia: string; ativo?: boolean; itens?: any[]; _count?: { itens?: number; preenchidos?: number } }

const ITEM_VAZIO: ItemForm = { categoria: "", descricao: "", tipo: "OK_NOK", opcoesStr: "OK, NOK", obrigatorio: true };
const rotuloFrequencia = (f: string) => FREQUENCIAS.find((x) => x.v === f)?.l ?? f;
const nItens = (t: Modelo) => t._count?.itens ?? t.itens?.length ?? 0;
const nPreenchidos = (t: Modelo) => t._count?.preenchidos ?? 0;

/**
 * Frota › Checklists: os modelos de checklist de veículo, no padrão de lista — busca, tabela no desktop
 * e cartões no celular; criar e editar na gaveta. Novo, Editar e Inativar só para quem tem
 * Configurações › Gerenciar ou Frota › Gerenciar (as mesmas permissões que a rota exige); sem elas, a
 * tela é só leitura. Toda gravação avisa (toast): se o servidor recusa, a lista NÃO muda.
 */
export function ChecklistTemplatesClient() {
  const { pode } = usePermissoes();
  const podeGerenciar = pode("configuracoes", "gerenciar") || pode("veiculos", "gerenciar");
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [frequencia, setFrequencia] = useState("DIARIO");
  const [itens, setItens] = useState<ItemForm[]>([]);

  useEffect(() => {
    fetch("/api/checklist-templates").then((r) => (r.ok ? r.json() : [])).then((d) => setModelos(Array.isArray(d) ? d : [])).catch(() => setModelos([]));
  }, []);

  function abrirNovo() {
    setNome(""); setDescricao(""); setFrequencia("DIARIO"); setItens([{ ...ITEM_VAZIO }]);
    setEditando("novo"); setErro("");
  }
  function abrir(t: Modelo) {
    setNome(t.nome); setDescricao(t.descricao ?? ""); setFrequencia(t.frequencia);
    setItens((t.itens ?? []).map((i: any) => ({
      id: i.id, categoria: i.categoria, descricao: i.descricao, tipo: i.tipo,
      opcoesStr: (i.opcoes ?? []).join(", "), obrigatorio: i.obrigatorio,
    })));
    setEditando(t.id); setErro("");
  }

  const addItem = () => setItens((p) => [...p, { ...ITEM_VAZIO, categoria: p[p.length - 1]?.categoria ?? "" }]);
  const updItem = (i: number, k: keyof ItemForm, v: any) => setItens((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeItem = (i: number) => setItens((p) => p.filter((_, idx) => idx !== i));
  const subirItem = (i: number) => setItens((p) => {
    if (i === 0) return p;
    const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]];
    return n;
  });

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Informe o nome do modelo."); return; }
    if (itens.length === 0) { setErro("Adicione ao menos um item."); return; }
    if (itens.some((i) => !i.descricao.trim() || !i.categoria.trim())) { setErro("Preencha a categoria e a descrição de todos os itens."); return; }
    setSalvando(true);
    const payload = {
      nome, descricao, frequencia,
      // id dos itens existentes: o servidor atualiza no lugar (removido vira inativo, não é apagado)
      itens: itens.map((i, idx) => ({
        id: i.id, categoria: i.categoria, descricao: i.descricao, tipo: i.tipo,
        opcoes: (i.tipo === "OK_NOK" || i.tipo === "NIVEL") ? i.opcoesStr.split(",").map((s) => s.trim()).filter(Boolean) : [],
        obrigatorio: i.obrigatorio, ordem: idx,
      })),
    };
    try {
      const novo = editando === "novo";
      const res = await fetch(novo ? "/api/checklist-templates" : `/api/checklist-templates/${editando}`, { method: novo ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { setErro(await erroDaResposta(res, "Não foi possível salvar o modelo.")); return; }
      const salvo: Modelo = await res.json();
      setModelos((p) => (novo ? [...(p ?? []), salvo] : (p ?? []).map((t) => (t.id === salvo.id ? { ...t, ...salvo } : t))));
      setEditando(null);
      toast(novo ? "Modelo de checklist criado." : "Modelo de checklist salvo.");
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  async function inativar(t: Modelo) {
    const n = nPreenchidos(t);
    if (!(await confirmar({
      titulo: `Inativar o modelo "${t.nome}"?`,
      mensagem: `${n === 0 ? "Ainda não foi preenchido." : `Já foi preenchido ${n} ${n === 1 ? "vez" : "vezes"}.`} Ele deixa de aparecer para os próximos preenchimentos; os já feitos continuam no histórico.`,
      perigo: true, confirmarTexto: "Inativar",
    }))) return;
    try {
      const res = await fetch(`/api/checklist-templates/${t.id}`, { method: "DELETE" });
      // Recusado (sem permissão, modelo de outra empresa…): a lista fica como está e a tela diz por quê
      if (!res.ok) { toast(await erroDaResposta(res, "Não foi possível inativar o modelo."), "erro"); return; }
      setModelos((p) => (p ?? []).map((x) => (x.id === t.id ? { ...x, ativo: false } : x)));
      toast("Modelo de checklist inativado.");
    } catch { toast("Sem conexão. Tente de novo.", "erro"); }
  }

  const q = busca.trim().toLowerCase();
  const ativos = useMemo(() => (modelos ?? []).filter((t) => t.ativo !== false), [modelos]);
  const filtrados = useMemo(() => (q ? ativos.filter((t) => t.nome.toLowerCase().includes(q)) : ativos), [ativos, q]);
  const somenteLeitura = !podeGerenciar;

  const acoes = (t: Modelo) => (
    <span className="inline-flex items-center justify-end gap-0.5">
      <button type="button" onClick={() => abrir(t)} aria-label={`${podeGerenciar ? "Editar" : "Ver"} ${t.nome}`} title={podeGerenciar ? "Editar" : "Ver"} data-abrir-modelo={t.id}
        className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded transition-colors">
        {podeGerenciar ? <Pencil className="w-4 h-4" aria-hidden /> : <ListChecks className="w-4 h-4" aria-hidden />}
      </button>
      {podeGerenciar && (
        <button type="button" onClick={() => void inativar(t)} aria-label={`Inativar ${t.nome}`} title="Inativar" data-inativar-modelo={t.id}
          className="p-1.5 text-ink-muted hover:text-atrasado hover:bg-atrasado-claro rounded transition-colors">
          <Ban className="w-4 h-4" aria-hidden />
        </button>
      )}
    </span>
  );

  return (
    <div className="space-y-4" data-checklists-veiculo>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[12rem] max-w-sm">
          <CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar modelo" rotulo="Pesquisar modelo de checklist" atalho={false} />
        </div>
        <Dica texto={AJUDA} rotulo="Checklists de veículo" />
        {podeGerenciar && (
          <Button type="button" onClick={abrirNovo} className="ml-auto shrink-0" data-novo-modelo>
            <Plus className="w-4 h-4" aria-hidden /> Novo modelo
          </Button>
        )}
      </div>

      {modelos === null ? (
        <div className="border border-surface-border rounded-lg"><SkeletonLista linhas={3} /></div>
      ) : filtrados.length === 0 ? (
        <div className="border border-surface-border rounded-lg">
          <ListaVazia mensagem={q ? "Nenhum modelo encontrado" : "Nenhum modelo de checklist cadastrado"} busca={q ? busca.trim() : undefined} onLimpar={() => setBusca("")} />
        </div>
      ) : (
        <>
          {/* Celular: cada registro vira um cartão */}
          <ul className="sm:hidden space-y-2" data-cartoes>
              {filtrados.map((t) => (
                <li key={t.id} data-cartao={t.id} className="border border-surface-border rounded-lg bg-white p-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink break-words">{t.nome}</p>
                    <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                      <dt className="text-ink-subtle">Frequência</dt><dd className="text-ink">{rotuloFrequencia(t.frequencia)}</dd>
                      <dt className="text-ink-subtle">Itens</dt><dd className="text-ink tabular-nums">{nItens(t)}</dd>
                      <dt className="text-ink-subtle">Preenchimentos</dt><dd className="text-ink tabular-nums">{nPreenchidos(t)}</dd>
                    </dl>
                  </div>
                  <div className="shrink-0">{acoes(t)}</div>
                </li>
              ))}
            </ul>
          <TabelaPro
          tela="config-checklists-veiculo" quebra="sm" className="hidden sm:block border border-surface-border rounded-lg overflow-hidden" colunas={COLUNAS} atributos={{ "data-tabela-modelos": true }}
          barra={<span className="text-xs text-ink-muted" data-total-modelos>{filtrados.length} {filtrados.length === 1 ? "modelo" : "modelos"}</span>}
          linhas={filtrados.map((t) => ({
            id: t.id, atributos: { "data-modelo": t.id }, titulos: { nome: t.nome },
            celulas: {
              nome: <span className={PLANILHA.nome}>{t.nome}</span>, frequencia: rotuloFrequencia(t.frequencia),
              itens: <span className="tabular-nums">{nItens(t)}</span>, preenchidos: <span className="tabular-nums">{nPreenchidos(t)}</span>, acoes: acoes(t),
            },
          }))}
        />
        </>
      )}

      {somenteLeitura && <SomenteLeitura permissao={PERMISSAO} />}

      <Drawer
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        titulo={editando === "novo" ? "Novo modelo de checklist" : (nome || "Modelo de checklist")}
        rodape={podeGerenciar ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar} data-salvar-modelo><Check className="w-4 h-4" aria-hidden /> Salvar</Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Fechar</Button>
        )}
      >
        <div className="space-y-4" data-form-modelo>
          {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-modelo>{erro}</div>}
          {somenteLeitura && <SomenteLeitura permissao={PERMISSAO} />}
          <fieldset disabled={somenteLeitura} className="space-y-4 min-w-0">
            <FormGrid cols={3}>
              <FormField label="Nome" required className="sm:col-span-2"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Checklist diário" data-nome-modelo /></FormField>
              <FormField label="Frequência"><Select value={frequencia} onChange={(e) => setFrequencia(e.target.value)}>{FREQUENCIAS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}</Select></FormField>
            </FormGrid>
            <FormField label="Descrição"><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></FormField>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-muted uppercase flex items-center gap-1">Itens
                <Dica texto="Nas opções, a primeira é o estado saudável; as demais geram alerta. A ordem daqui é a ordem do preenchimento." rotulo="Itens" />
              </p>
              {itens.map((it, i) => (
                <div key={i} className="border border-surface-border bg-white rounded-lg p-3 space-y-3" data-item-modelo>
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-ink-muted w-4 shrink-0 tabular-nums pt-2.5">{i + 1}</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-w-0">
                      <Input value={it.categoria} onChange={(e) => updItem(i, "categoria", e.target.value)} placeholder="Categoria (ex.: Motor)" aria-label={`Categoria do item ${i + 1}`} />
                      <Input value={it.descricao} onChange={(e) => updItem(i, "descricao", e.target.value)} placeholder="Item (ex.: Nível do óleo)" aria-label={`Descrição do item ${i + 1}`} />
                    </div>
                    {podeGerenciar && (
                      <span className="inline-flex items-center shrink-0 pt-1.5">
                        <button type="button" onClick={() => subirItem(i)} disabled={i === 0} aria-label={`Subir o item ${i + 1}`} title="Subir" className="p-1 text-ink-muted hover:text-ink disabled:opacity-30"><ArrowUp className="w-4 h-4" aria-hidden /></button>
                        <button type="button" onClick={() => removeItem(i)} aria-label={`Excluir o item ${i + 1}`} title="Excluir" className="p-1 text-ink-muted hover:text-atrasado"><Trash2 className="w-4 h-4" aria-hidden /></button>
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:pl-6">
                    <Select value={it.tipo} onChange={(e) => updItem(i, "tipo", e.target.value)} aria-label={`Tipo do item ${i + 1}`}>{TIPOS_ITEM.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</Select>
                    {(it.tipo === "OK_NOK" || it.tipo === "NIVEL") && (
                      <Input value={it.opcoesStr} onChange={(e) => updItem(i, "opcoesStr", e.target.value)} placeholder="Opções separadas por vírgula" aria-label={`Opções do item ${i + 1}`} className="sm:col-span-2" />
                    )}
                    <label className="flex items-center gap-2 text-sm text-ink-muted">
                      <input type="checkbox" checked={it.obrigatorio} onChange={(e) => updItem(i, "obrigatorio", e.target.checked)} className="rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                      Obrigatório
                    </label>
                  </div>
                </div>
              ))}
              {podeGerenciar && (
                <Button type="button" variant="ghost" onClick={addItem} className="text-xs h-7 px-2.5" data-adicionar-item><Plus className="w-3 h-3" aria-hidden /> Adicionar item</Button>
              )}
            </div>
          </fieldset>
        </div>
      </Drawer>
    </div>
  );
}
