"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { cn, formatarData, formatarDataHora, LABELS_STATUS_OS } from "@/lib/utils";
import { Pencil, QrCode, FileText, ClipboardList, User, ExternalLink, CircleCheck } from "lucide-react";

interface Props {
  equipamento: any;
  tipoNome: string;
  historico: any[];
}

type Aba = "dados" | "ordens" | "formularios";

export function EquipamentoPerfil({ equipamento: e, tipoNome, historico }: Props) {
  const [aba, setAba] = useState<Aba>("dados");
  const cliente = e.unidade?.cliente;
  const titulo = e.nome ? e.nome : `${e.marca} ${e.modelo}`;

  const abas: { id: Aba; label: string; badge?: number }[] = [
    { id: "dados", label: "Dados" },
    { id: "ordens", label: "Ordens de Serviço", badge: e.ordensServico?.length ?? 0 },
    { id: "formularios", label: "Formulários", badge: historico.length },
  ];

  const especificacoes: { label: string; valor?: string | null }[] = [
    { label: "Marca", valor: e.marca },
    { label: "Modelo", valor: e.modelo },
    { label: "Nº de série", valor: e.numeroSerie },
    { label: "Patrimônio", valor: e.patrimonio },
    { label: "Capacidade", valor: e.capacidade },
    { label: "Fluido", valor: e.fluido },
    { label: "Tensão", valor: e.tensao },
    { label: "Potência", valor: e.potencia },
    { label: "Fase", valor: e.fase },
    { label: "Corrente nominal", valor: e.correnteNominal },
    { label: "Ano fabricação", valor: e.anoFabricacao },
    { label: "Localização", valor: e.localizacao },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={titulo}
        description={`${tipoNome}${cliente ? ` · ${cliente.nomeFantasia ?? cliente.nome}` : ""}`}
        backHref="/equipamentos"
        actions={
          <>
            <Link href={`/equipamentos/${e.id}/editar?aba=qrcode`} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary-600 border border-surface-border rounded-lg px-3 py-2">
              <QrCode className="w-4 h-4" /> QR Code
            </Link>
            <Link href={`/equipamentos/${e.id}/editar`} className="inline-flex items-center gap-1.5 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg px-3 py-2">
              <Pencil className="w-4 h-4" /> Editar
            </Link>
          </>
        }
      />

      {/* Abas */}
      <div className="flex gap-1 border-b border-surface-border mb-4 overflow-x-auto">
        {abas.map((a) => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              aba === a.id ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink")}>
            {a.label}
            {a.badge !== undefined && a.badge > 0 && <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{a.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── Dados ── */}
      {aba === "dados" && (
        <div className="bg-white rounded-xl border border-surface-border p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            {especificacoes.filter((s) => s.valor).map((s) => (
              <div key={s.label}>
                <p className="text-[11px] text-ink-muted uppercase tracking-wide">{s.label}</p>
                <p className="text-sm text-ink font-medium">{s.valor}</p>
              </div>
            ))}
          </div>
          {e.observacoes && (
            <div className="mt-5 pt-4 border-t border-surface-border">
              <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1">Observações</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{e.observacoes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Ordens de Serviço ── */}
      {aba === "ordens" && (
        <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
          {(e.ordensServico?.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-muted text-center py-10">Nenhuma OS registrada para este equipamento.</p>
          ) : (
            <div className="divide-y divide-surface-border">
              {e.ordensServico.map((os: any) => (
                <Link key={os.id} href={`/ordens/${os.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-alt">
                  <FileText className="w-4 h-4 text-ink-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink font-mono">{os.numero}</p>
                    <p className="text-[11px] text-ink-muted">
                      {os.atividades?.[0]?.tipoOs?.nome ?? "—"} · {formatarData(os.criadoEm)}
                      {os.atividades?.[0]?.tecnico?.nome ? ` · ${os.atividades[0].tecnico.nome}` : ""}
                    </p>
                  </div>
                  <span className="ml-auto text-[10px] text-ink-muted bg-surface-alt px-2 py-0.5 rounded-full whitespace-nowrap">
                    {LABELS_STATUS_OS[os.status] ?? os.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Formulários (histórico por OS) ── */}
      {aba === "formularios" && (
        <div className="space-y-3">
          {historico.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border text-center py-10">
              <ClipboardList className="w-6 h-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-ink-muted">Nenhum formulário respondido para este equipamento.</p>
            </div>
          ) : (
            historico.map((h) => (
              <div key={h.chave} className="bg-white rounded-xl border border-surface-border overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-surface-alt border-b border-surface-border">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink flex items-center gap-2">
                      <ClipboardList className="w-3.5 h-3.5 text-primary-500" /> {h.formularioNome}
                    </p>
                    <p className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {h.tipoOs && <span className="text-white px-1.5 py-px rounded-full" style={{ backgroundColor: h.tipoOs.cor }}>{h.tipoOs.nome}</span>}
                      <span>{formatarDataHora(h.respondidoEm)}</span>
                      {h.respondidoPor && <span className="flex items-center gap-1"><User className="w-3 h-3" />{h.respondidoPor}</span>}
                    </p>
                  </div>
                  <Link href={`/ordens/${h.osId}`} className="text-[11px] text-primary-600 hover:text-primary-700 flex items-center gap-1 whitespace-nowrap shrink-0">
                    OS {h.osNumero} <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="divide-y divide-surface-border/60">
                  {h.campos.map((c: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-4 px-4 py-2">
                      <span className="text-xs text-ink-muted">{c.label}</span>
                      <span className="text-sm text-ink text-right max-w-[60%]">{renderValor(c)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function renderValor(c: any) {
  if (c.tipo === "FOTO") {
    return c.arquivoUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={c.arquivoUrl} alt={c.label} className="w-14 h-14 rounded-lg object-cover border border-surface-border inline-block" />
      : <span className="text-ink-muted">—</span>;
  }
  if (c.tipo === "SIM_NAO") {
    const sim = c.resposta === "Sim" || c.resposta === "true";
    return <span className={cn("inline-flex items-center gap-1", sim ? "text-green-600" : "text-ink")}>{sim && <CircleCheck className="w-3.5 h-3.5" />}{c.resposta || "—"}</span>;
  }
  return <span>{c.resposta || "—"}</span>;
}
