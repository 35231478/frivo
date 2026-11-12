export default function PublicoLayout({ children }: { children: React.ReactNode }) {
  // Na impressão: fundo branco e sem altura mínima (min-h-screen esticava a última página com fundo cinza)
  return <div className="min-h-screen bg-surface-page print:min-h-0 print:bg-white">{children}</div>;
}
