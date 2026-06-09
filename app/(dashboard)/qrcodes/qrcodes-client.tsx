"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { QrCode, Printer, Link2, X, Plus } from "lucide-react";

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
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function QrcodesClient({ lista, equipamentosLivres }: Props) {
  const router = useRouter();
  const [filtroVinculo, setFiltroVinculo] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [modalGerar, setModalGerar] = useState(false);
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);

  const filtrada = useMemo(() => {
    return lista.filter((q) => {
      if (filtroVinculo === "vinculado" && !q.equipamento) return false;
      if (filtroVinculo === "nao" && q.equipamento) return false;
      if (filtroAtivo === "ativo" && !q.ativo) return false;
      if (filtroAtivo === "inativo" && q.ativo) return false;
      return true;
    });
  }, [lista, filtroVinculo, filtroAtivo]);

  function toggleSel(id: string) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleTodos() {
    setSelecionados((s) =>
      s.size === filtrada.length ? new Set() : new Set(filtrada.map((q) => q.id)),
    );
  }

  function imprimirSelecionados() {
    if (selecionados.size === 0) return;
    router.push(`/qrcodes/imprimir?ids=${Array.from(selecionados).join(",")}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <QrCode className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">QR Codes</h1>
            <p className="text-sm text-ink-muted mt-1">Gere etiquetas QR e vincule aos equipamentos</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={imprimirSelecionados} disabled={selecionados.size === 0}>
            <Printer className="w-4 h-4" /> Imprimir{selecionados.size > 0 ? ` (${selecionados.size})` : ""}
          </Button>
          <Button onClick={() => setModalGerar(true)}>
            <Plus className="w-4 h-4" /> Gerar QR Codes
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filtroVinculo} onChange={(e) => setFiltroVinculo(e.target.value)} className="max-w-[200px]">
          <option value="">Todos (vínculo)</option>
          <option value="vinculado">Vinculados</option>
          <option value="nao">Não vinculados</option>
        </Select>
        <Select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)} className="max-w-[180px]">
          <option value="">Todos (status)</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </Select>
        <span className="text-sm text-ink-muted">{filtrada.length} de {lista.length}</span>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-ink-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={filtrada.length > 0 && selecionados.size === filtrada.length} onChange={toggleTodos} />
              </th>
              <th className="text-left px-4 py-3 font-semibold">Código</th>
              <th className="text-left px-4 py-3 font-semibold">Equipamento</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-left px-4 py-3 font-semibold">Criado em</th>
              <th className="text-right px-4 py-3 font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrada.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-muted">Nenhum QR Code encontrado.</td></tr>
            )}
            {filtrada.map((q) => (
              <tr key={q.id} className="hover:bg-surface-alt/50">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selecionados.has(q.id)} onChange={() => toggleSel(q.id)} />
                </td>
                <td className="px-4 py-3 font-mono font-medium text-ink">{q.codigo}</td>
                <td className="px-4 py-3">
                  {q.equipamento ? (
                    <span className="text-ink">{q.equipamento.nome}{q.equipamento.local ? <span className="text-ink-muted"> · {q.equipamento.local}</span> : null}</span>
                  ) : (
                    <span className="text-ink-subtle italic">Não vinculado</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${q.ativo ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {q.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-muted">{formatarData(q.criadoEm)}</td>
                <td className="px-4 py-3 text-right">
                  {!q.equipamento && (
                    <button onClick={() => setVinculandoId(q.id)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
                      <Link2 className="w-3.5 h-3.5" /> Vincular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalGerar && <ModalGerar onClose={() => setModalGerar(false)} listaAtual={lista} onPronto={() => { setModalGerar(false); router.refresh(); }} />}
      {vinculandoId && (
        <ModalVincular
          qrId={vinculandoId}
          equipamentos={equipamentosLivres}
          onClose={() => setVinculandoId(null)}
          onPronto={() => { setVinculandoId(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ModalGerar({ onClose, onPronto, listaAtual }: { onClose: () => void; onPronto: () => void; listaAtual: QrItem[] }) {
  const [quantidade, setQuantidade] = useState(10);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  const proximo = useMemo(() => {
    const ano = new Date().getFullYear();
    const prefixo = `QR-${ano}-`;
    const max = listaAtual
      .filter((q) => q.codigo.startsWith(prefixo))
      .reduce((acc, q) => Math.max(acc, Number(q.codigo.split("-")[2]) || 0), 0);
    return { ano, seq: max + 1, prefixo };
  }, [listaAtual]);

  const previa = useMemo(() => {
    const n = Math.min(Math.max(quantidade, 1), 3);
    return Array.from({ length: n }, (_, i) => `${proximo.prefixo}${String(proximo.seq + i).padStart(4, "0")}`);
  }, [quantidade, proximo]);

  async function gerar() {
    setErro(""); setGerando(true);
    try {
      const res = await fetch("/api/qrcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao gerar."); return; }
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setGerando(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-ink">Gerar QR Codes</h2>
        <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 space-y-4">
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">{erro}</div>}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Quantidade a gerar (1 a 100)</label>
          <Input type="number" min={1} max={100} value={quantidade}
            onChange={(e) => setQuantidade(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
        </div>
        <div className="bg-surface-alt rounded-lg p-3 text-sm">
          <p className="text-ink-muted text-xs mb-1.5">Os códigos gerados serão:</p>
          <ul className="font-mono text-ink space-y-0.5">
            {previa.map((c) => <li key={c}>{c}</li>)}
            {quantidade > 3 && <li className="text-ink-subtle">… até {`${proximo.prefixo}${String(proximo.seq + quantidade - 1).padStart(4, "0")}`}</li>}
          </ul>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={gerar} loading={gerando}>Gerar</Button>
      </div>
    </Overlay>
  );
}

function ModalVincular({ qrId, equipamentos, onClose, onPronto }: { qrId: string; equipamentos: { id: string; nome: string }[]; onClose: () => void; onPronto: () => void }) {
  const [equipamentoId, setEquipamentoId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function vincular() {
    if (!equipamentoId) { setErro("Selecione um equipamento."); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/qrcodes/${qrId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipamentoId }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao vincular."); return; }
      onPronto();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-ink">Vincular a um equipamento</h2>
        <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 space-y-4">
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">{erro}</div>}
        {equipamentos.length === 0 ? (
          <p className="text-sm text-ink-muted">Não há equipamentos sem QR Code disponíveis.</p>
        ) : (
          <Select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)} placeholder="Selecione o equipamento">
            {equipamentos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </Select>
        )}
      </div>
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={vincular} loading={salvando} disabled={equipamentos.length === 0}>Vincular</Button>
      </div>
    </Overlay>
  );
}
