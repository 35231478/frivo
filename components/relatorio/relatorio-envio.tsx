"use client";

import { Printer, Mail, MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/utils";

interface Props {
  token: string;
  numero: string;
  empresaNome: string;
  emailDestino?: string | null;
  whatsappDestino?: string | null;
}

export function RelatorioEnvio({ token, numero, empresaNome, emailDestino, whatsappDestino }: Props) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = `${origin}/relatorio/${token}`;
  const printUrl = `/relatorio/${token}/imprimir`;

  const assunto = `Relatório ${numero} — ${empresaNome}`;
  const corpo = `Olá,\n\nSegue o relatório ${numero} para sua avaliação:\n\n${publicUrl}\n\nAtenciosamente,\n${empresaNome}`;
  const mailto = emailDestino
    ? `mailto:${encodeURIComponent(emailDestino)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`
    : `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  const wpp = whatsappDestino ? whatsappLink(whatsappDestino, corpo) : `https://wa.me/?text=${encodeURIComponent(corpo)}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={printUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
        <Printer className="w-4 h-4" /> Baixar PDF
      </a>
      <a href={mailto} className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
        <Mail className="w-4 h-4" /> Enviar por E-mail
      </a>
      <a href={wpp} target="_blank" rel="noopener" className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
        <MessageCircle className="w-4 h-4" /> WhatsApp
      </a>
    </div>
  );
}
