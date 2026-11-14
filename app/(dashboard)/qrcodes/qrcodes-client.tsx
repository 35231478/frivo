"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { confirmar, toast } from "@/components/ui/avisos";
import { CampoBusca, ListaVazia } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { QrCode, Printer, Link2, Unlink, Plus, Ban, RotateCcw } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { PLANILHA } from "@/lib/planilha";
import { cn, formatarData } from "@/lib/utils";

type EquipamentoRef = { id: string; nome: string; local: string | null };
type QrItem = {
  id: string;
  codigo: string;
  ativo: boolean;
  criadoEm: string;
  equipamento: EquipamentoRef | null;
};

interface Props {
  lista: QrItem[];
  equipamentosLivres: { id: string; nome: string }[];
  /** Próximo código pelo contador da empresa (Configurações › Numeração), ex.: QR-104 */
  proximoCodigo: string;
}

const AJUDA = "Etiquetas QR dos equipamentos. Inativa, a etiqueta deixa de abrir a página pública; pode ser reativada. Desvincular solta a etiqueta para outro equipamento.";

const COLUNAS: ColunaPro[] = [
  { id: "sel", titulo: "Selecionar", fixa: true, largura: 36, semTitulo: true, classe: "pl-3" },
  { id: "codigo", titulo: "Código", largura: 150, obrigatoria: true },
  { id: "equipamento", titulo: "Equipamento", obrigatoria: true, minimo: 180, classe: "truncate" },
  { id: "status", titulo: "Status", largura: 100 },
  { id: "criado", titulo: "Criado em", largura: 110 },
  { id: "acoes", titulo: "Ações", semTitulo: true, fixa: true, largura: 128, alinhar: "direita" },
];

/** Quantos equipamentos o diálogo de vincular mostra de uma vez (o resto vem pela pesquisa) */
const LIMITE_OPCOES = 50;

/** Lê o erro que a rota devolveu ({ erro }), ou o texto de reserva */
async function erroDa(res: Response, reserva: string): Promise<string> {
  const j = await res.json().catch(() => null);
  return (j && typeof j.erro === "string" && j.erro) || reserva;
}

/**
 * Equipamentos › QR Codes, no padrão de lista: busca, filtros, tabela no desktop e cartões no celular (a
 * tela é usada em campo). Ver e imprimir: quem tem QR Codes › visualizar. Gerar, vincular, desvincular,
 * inativar e reativar: só QR Codes › gerenciar — a mesma permissão das rotas, que recusam de qualquer
 * jeito. Toda gravação avisa (toast); se o servidor recusa, a lista não muda.
 */
export function QrcodesClient({ lista, equipamentosLivres, proximoCodigo }: Props) {
  const router = useRouter();
  const podeGerenciar = usePermissoes().pode("qrcodes", "gerenciar");
  const [busca, setBusca] = useState("");
  const [filtroVinculo, setFiltroVinculo] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [modalGerar, setModalGerar] = useState(false);
  const [vinculando, setVinculando] = useState<QrItem | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const q = busca.trim().toLowerCase();
  const filtrada = useMemo(() => lista.filter((x) => {
    if (filtroVinculo === "vinculado" && !x.equipamento) return false;
    if (filtroVinculo === "nao" && x.equipamento) return false;
    if (filtroAtivo === "ativo" && !x.ativo) return false;
    if (filtroAtivo === "inativo" && x.ativo) return false;
    if (q && !`${x.codigo} ${x.equipamento?.nome ?? ""} ${x.equipamento?.local ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  }), [lista, filtroVinculo, filtroAtivo, q]);

  const toggleSel = (id: string) => setSelecionados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosMarcados = filtrada.length > 0 && filtrada.every((x) => selecionados.has(x.id));
  const toggleTodos = () => setSelecionados(todosMarcados ? new Set() : new Set(filtrada.map((x) => x.id)));
  const hrefImprimir = (ids: string[]) => `/qrcodes/imprimir?ids=${ids.join(",")}`;

  /** Grava pela rota e só então atualiza a lista; recusado, avisa e deixa como está */
  async function gravar(item: QrItem, corpo: Record<string, unknown>, sucesso: string, falha: string) {
    setOcupado(item.id);
    try {
      const res = await fetch(`/api/qrcodes/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) { toast(await erroDa(res, falha), "erro"); return; }
      toast(sucesso);
      router.refresh();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setOcupado(null); }
  }

  async function desvincular(item: QrItem) {
    if (!(await confirmar({
      titulo: `Desvincular a etiqueta ${item.codigo}?`,
      mensagem: `Fica livre para outro equipamento. ${item.equipamento?.nome ?? "O equipamento"} e o histórico não mudam.`,
      perigo: true, confirmarTexto: "Desvincular",
    }))) return;
    await gravar(item, { equipamentoId: null }, `Etiqueta ${item.codigo} desvinculada.`, "Não foi possível desvincular a etiqueta.");
  }

  async function alternarAtivo(item: QrItem) {
    if (item.ativo && !(await confirmar({
      titulo: `Inativar a etiqueta ${item.codigo}?`,
      mensagem: "A leitura deixa de abrir a página do equipamento. A etiqueta pode ser reativada.",
      perigo: true, confirmarTexto: "Inativar",
    }))) return;
    await gravar(item, { ativo: !item.ativo }, item.ativo ? `Etiqueta ${item.codigo} inativada.` : `Etiqueta ${item.codigo} reativada.`, "Não foi possível alterar a etiqueta.");
  }

  const selo = (x: QrItem) => (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", x.ativo ? "bg-ok-claro text-ok-texto" : "bg-surface-linha text-ink-muted")} data-status-qr>
      {x.ativo ? "Ativo" : "Inativo"}
    </span>
  );
  const equipamento = (x: QrItem) => x.equipamento
    ? <span className="text-ink">{x.equipamento.nome}{x.equipamento.local ? <span className="text-ink-muted"> · {x.equipamento.local}</span> : null}</span>
    : <span className="text-ink-subtle">Não vinculado</span>;
  const btn = "p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-40";
  const acoes = (x: QrItem) => (
    <span className="inline-flex items-center justify-end gap-0.5" data-acoes-qr>
      <Link href={hrefImprimir([x.id])} aria-label={`Imprimir ${x.codigo}`} title="Imprimir" className={btn} data-imprimir-qr={x.id}><Printer className="w-4 h-4" aria-hidden /></Link>
      {podeGerenciar && (x.equipamento ? (
        <button type="button" onClick={() => void desvincular(x)} disabled={ocupado === x.id} aria-label={`Desvincular ${x.codigo}`} title="Desvincular" className={btn} data-desvincular-qr={x.id}><Unlink className="w-4 h-4" aria-hidden /></button>
      ) : (
        <button type="button" onClick={() => setVinculando(x)} disabled={ocupado === x.id} aria-label={`Vincular ${x.codigo}`} title="Vincular a um equipamento" className={btn} data-vincular-qr={x.id}><Link2 className="w-4 h-4" aria-hidden /></button>
      ))}
      {podeGerenciar && (
        <button type="button" onClick={() => void alternarAtivo(x)} disabled={ocupado === x.id} aria-label={`${x.ativo ? "Inativar" : "Reativar"} ${x.codigo}`} title={x.ativo ? "Inativar" : "Reativar"}
          className={cn(btn, x.ativo ? "hover:text-atrasado hover:bg-atrasado-claro" : "hover:text-ok-texto hover:bg-ok-claro")} data-alternar-qr={x.id}>
          {x.ativo ? <Ban className="w-4 h-4" aria-hidden /> : <RotateCcw className="w-4 h-4" aria-hidden />}
        </button>
      )}
    </span>
  );
  const caixa = (x: QrItem) => <input type="checkbox" checked={selecionados.has(x.id)} onChange={() => toggleSel(x.id)} aria-label={`Selecionar ${x.codigo}`} data-selecionar-qr={x.id} className="w-4 h-4" />;

  return (
    <div className="space-y-4" data-qrcodes>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-surface-alt rounded-lg shrink-0"><QrCode className="w-5 h-5 text-ink-muted" aria-hidden /></div>
          <h1 className="page-title flex items-center gap-1.5">QR Codes <Dica texto={AJUDA} rotulo="QR Codes" lado="direita" /></h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full" data-total-qr>{lista.length}</span>
        </div>
        {/* No celular: os botões ocupam a linha toda, um ao lado do outro */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="secondary" onClick={() => router.push(hrefImprimir([...selecionados]))} disabled={selecionados.size === 0} className="flex-1 sm:flex-none" data-imprimir-selecionados>
            <Printer className="w-4 h-4" aria-hidden /> Imprimir{selecionados.size > 0 ? ` (${selecionados.size})` : ""}
          </Button>
          {podeGerenciar && (
            <Button onClick={() => setModalGerar(true)} className="flex-1 sm:flex-none" data-gerar-qr>
              <Plus className="w-4 h-4" aria-hidden /> Gerar QR Codes
            </Button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
          {/* Celular: a pesquisa ocupa a linha e os dois filtros dividem a de baixo */}
          <div className="basis-full sm:basis-0 sm:flex-1 sm:min-w-[12rem]">
            <CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar por código ou equipamento" rotulo="Pesquisar QR Codes" atalho={false} />
          </div>
          <Select value={filtroVinculo} onChange={(e) => setFiltroVinculo(e.target.value)} aria-label="Filtrar por vínculo" className="flex-1 sm:flex-none sm:w-44" data-filtro-vinculo>
            <option value="">Vínculo: todos</option>
            <option value="vinculado">Vinculados</option>
            <option value="nao">Não vinculados</option>
          </Select>
          <Select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)} aria-label="Filtrar por status" className="flex-1 sm:flex-none sm:w-40" data-filtro-status>
            <option value="">Status: todos</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </Select>
        </div>

        {filtrada.length === 0 ? (
          <ListaVazia mensagem={lista.length === 0 ? "Nenhum QR Code gerado" : "Nenhum QR Code encontrado"} busca={q ? busca.trim() : undefined} onLimpar={() => setBusca("")} />
        ) : (
          <>
            {/* Celular: um cartão por etiqueta */}
            <div className="sm:hidden px-3 py-2 border-b border-surface-border flex items-center justify-between text-xs text-ink-muted">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={todosMarcados} onChange={toggleTodos} className="w-4 h-4" data-selecionar-todos-celular /> Selecionar todos</label>
              <span>{filtrada.length} de {lista.length}</span>
            </div>
            <ul className="sm:hidden divide-y divide-surface-border" data-cartoes>
              {filtrada.map((x) => (
                <li key={x.id} data-cartao={x.id} className={cn("flex items-start gap-3 px-3 py-3", !x.ativo && "opacity-70")}>
                  <span className="pt-0.5">{caixa(x)}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn(PLANILHA.codigo, "text-ink")}>{x.codigo}</p>
                    <p className="text-sm break-words">{equipamento(x)}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">{selo(x)}<span>{formatarData(x.criadoEm)}</span></div>
                  </div>
                  <div className="shrink-0 -mr-1">{acoes(x)}</div>
                </li>
              ))}
            </ul>
            <TabelaPro
              tela="qrcodes" quebra="sm" className="hidden sm:block" atributos={{ "data-tabela-qrcodes": true }}
              barra={<span data-contagem-qr>{filtrada.length} de {lista.length}</span>}
              colunas={COLUNAS.map((c) => (c.id === "sel" ? { ...c, cabecalho: <input type="checkbox" checked={todosMarcados} onChange={toggleTodos} aria-label="Selecionar todos" className="w-4 h-4" data-selecionar-todos /> } : c))}
              linhas={filtrada.map((x) => ({
                id: x.id, atributos: { "data-qr": x.id }, classe: x.ativo ? undefined : "opacity-70", titulos: { equipamento: x.equipamento ? `${x.equipamento.nome}${x.equipamento.local ? ` · ${x.equipamento.local}` : ""}` : undefined },
                celulas: {
                  sel: caixa(x), codigo: <span className={cn(PLANILHA.codigo, "text-ink")}>{x.codigo}</span>, equipamento: equipamento(x), status: selo(x),
                  criado: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(x.criadoEm)}</span>, acoes: acoes(x),
                },
              }))}
            />
          </>
        )}
      </div>

      <ModalGerar aberto={modalGerar} onFechar={() => setModalGerar(false)} proximoCodigo={proximoCodigo} onPronto={(n) => { setModalGerar(false); toast(n === 1 ? "1 QR Code gerado." : `${n} QR Codes gerados.`); router.refresh(); }} />
      <ModalVincular
        item={vinculando} equipamentos={equipamentosLivres} onFechar={() => setVinculando(null)}
        onPronto={(codigo) => { setVinculando(null); toast(`Etiqueta ${codigo} vinculada.`); router.refresh(); }}
      />
    </div>
  );
}

function ModalGerar({ aberto, onFechar, onPronto, proximoCodigo }: { aberto: boolean; onFechar: () => void; onPronto: (quantidade: number) => void; proximoCodigo: string }) {
  const [quantidade, setQuantidade] = useState(10);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  // O próximo vem do servidor (contador de Configurações › Numeração): a prévia só continua a sequência
  const proximo = useMemo(() => {
    const partes = proximoCodigo.split("-");
    const seq = Number(partes.pop()) || 1; // o sequencial é o que vem depois do último hífen (QR-104)
    return { prefixo: `${partes.join("-")}-`, seq };
  }, [proximoCodigo]);

  const previa = useMemo(() => {
    const n = Math.min(Math.max(quantidade, 1), 3);
    return Array.from({ length: n }, (_, i) => `${proximo.prefixo}${proximo.seq + i}`);
  }, [quantidade, proximo]);

  async function gerar() {
    setErro(""); setGerando(true);
    try {
      const res = await fetch("/api/qrcodes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantidade }) });
      if (!res.ok) { setErro(await erroDa(res, "Não foi possível gerar os QR Codes.")); return; }
      onPronto(quantidade);
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setGerando(false); }
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Gerar QR Codes" tamanho="sm">
      <div className="space-y-4" data-modal-gerar>
        {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-2.5" data-erro-gerar>{erro}</div>}
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">Quantidade (1 a 100)</span>
          <Input type="number" inputMode="numeric" min={1} max={100} value={quantidade} data-quantidade
            onChange={(e) => setQuantidade(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <div className="bg-surface-alt rounded-lg p-3 text-sm" data-previa-codigos>
          <p className="text-ink-muted text-xs mb-1.5">Códigos que serão gerados</p>
          <ul className="font-mono text-ink space-y-0.5">
            {previa.map((c) => <li key={c}>{c}</li>)}
            {quantidade > 3 && <li className="text-ink-subtle">… até {`${proximo.prefixo}${proximo.seq + quantidade - 1}`}</li>}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button onClick={gerar} loading={gerando} data-confirmar-gerar>Gerar</Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalVincular({ item, equipamentos, onFechar, onPronto }: { item: QrItem | null; equipamentos: { id: string; nome: string }[]; onFechar: () => void; onPronto: (codigo: string) => void }) {
  const [equipamentoId, setEquipamentoId] = useState("");
  const [pesquisa, setPesquisa] = useState("");
  const termo = pesquisa.trim().toLowerCase();
  const achados = termo ? equipamentos.filter((e) => e.nome.toLowerCase().includes(termo)) : equipamentos;
  const limpar = () => { setErro(""); setEquipamentoId(""); setPesquisa(""); };
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function vincular() {
    if (!item) return;
    if (!equipamentoId) { setErro("Selecione um equipamento."); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/qrcodes/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ equipamentoId }) });
      if (!res.ok) { setErro(await erroDa(res, "Não foi possível vincular a etiqueta.")); return; }
      limpar();
      onPronto(item.codigo);
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <Modal aberto={!!item} onFechar={() => { limpar(); onFechar(); }} titulo={item ? `Vincular a etiqueta ${item.codigo}` : "Vincular a etiqueta"} tamanho="sm">
      <div className="space-y-4" data-modal-vincular>
        {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-2.5" data-erro-vincular>{erro}</div>}
        {equipamentos.length === 0 ? (
          <p className="text-sm text-ink-muted" data-sem-equipamentos>Não há equipamento sem QR Code.</p>
        ) : (
          // Lista dentro do próprio diálogo (um seletor suspenso ficava cortado pela moldura no celular)
          <div>
            <Input value={pesquisa} onChange={(e) => setPesquisa(e.target.value)} placeholder="Pesquisar equipamento sem QR Code" aria-label="Pesquisar equipamento sem QR Code" data-pesquisa-equipamento />
            <ul role="listbox" aria-label="Equipamentos sem QR Code" className="mt-2 max-h-56 overflow-y-auto border border-surface-border rounded-lg divide-y divide-surface-border" data-opcoes-equipamento>
              {achados.length === 0 && <li className="px-3 py-3 text-xs text-ink-subtle">Nenhum equipamento encontrado.</li>}
              {achados.slice(0, LIMITE_OPCOES).map((e) => (
                <li key={e.id}>
                  <button type="button" role="option" aria-selected={e.id === equipamentoId} onClick={() => { setEquipamentoId(e.id); setErro(""); }} data-opcao-equipamento={e.id}
                    className={cn("w-full text-left px-3 py-2 text-sm hover:bg-primary-50", e.id === equipamentoId ? "bg-primary-50 text-primary-700 font-medium" : "text-ink")}>
                    {e.nome}
                  </button>
                </li>
              ))}
            </ul>
            {achados.length > LIMITE_OPCOES && <p className="mt-1 text-xs text-ink-muted" data-mais-opcoes>Mostrando {LIMITE_OPCOES} de {achados.length}. Refine a pesquisa.</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { limpar(); onFechar(); }}>Cancelar</Button>
          <Button onClick={vincular} loading={salvando} disabled={equipamentos.length === 0} data-confirmar-vincular>Vincular</Button>
        </div>
      </div>
    </Modal>
  );
}
