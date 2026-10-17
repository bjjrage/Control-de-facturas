"use client";

import { useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink, QrCode } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createReceiptPortalLink } from "@/app/(internal)/inventory/actions";
import styles from "./receipt-share.module.css";

export function ReceiptPortalLink({ orderId, orderCode }: { orderId: string; orderCode?: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const local = url ? ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname) : false;

  async function generate() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    let portalUrl = url;
    try {
      if (!portalUrl) {
        const result = await createReceiptPortalLink(orderId);
        if (result.error || !result.url) throw new Error(result.error ?? "No se pudo crear el enlace.");
        portalUrl = new URL(result.url, window.location.origin).toString();
        setUrl(portalUrl);
      }
      setQr(await QRCode.toDataURL(portalUrl, { width: 640, margin: 2, errorCorrectionLevel: "M" }));
    } catch (e) {
      setError(portalUrl ? "El enlace quedó creado, pero no se pudo generar el QR. Podés copiar el enlace o reintentar el QR." : e instanceof Error ? e.message : "No se pudo crear el enlace.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("No se pudo copiar. Seleccioná el enlace para copiarlo manualmente."); }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="secondary" size="sm"><QrCode size={15} aria-hidden="true" /> QR para recibir</Button></DialogTrigger>
    <DialogContent title={orderCode ? `QR de recepción · ${orderCode}` : "QR para el depositero"} className={styles.dialog}>
      <div className={styles.body}>
        <p>El depositero confirma las cantidades recibidas y adjunta el remito desde este enlace.</p>
        <p className={styles.hint}>Al confirmar, la mercadería ingresa al stock de la obra. No requiere otra aprobación.</p>
        {!url && <p className={styles.notice}>El enlace dura 7 días y sirve para una entrega. Generarlo reemplaza cualquier enlace activo anterior de esta OC.</p>}
        {error && <p role="alert" className={styles.notice}>{error}</p>}
        {qr && <div className={styles.qr}>
          {/* QR generated locally from the scoped receipt URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR del portal de recepción" width={240} height={240} />
        </div>}
        {url && <label className={styles.hint}>Enlace de recepción<input aria-label="Enlace de recepción" className={styles.url} value={url} readOnly onFocus={event => event.target.select()} /></label>}
        {local && <p role="status" className={styles.notice}>Preview local: este enlace funciona en esta computadora. Un teléfono necesita una URL accesible desde ese dispositivo.</p>}
      </div>
      <footer className={styles.footer}>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>
        {url && <>
          <Button type="button" variant="secondary" size="sm" onClick={copy}><Copy size={14} aria-hidden="true" />{copied ? "Enlace copiado" : "Copiar enlace"}</Button>
          {qr && <a className={buttonClassName({ variant: "secondary", size: "sm" })} href={qr} download={`recepcion-${orderCode ?? "OC"}.png`}><Download size={14} aria-hidden="true" /> Descargar QR</a>}
          <a className={buttonClassName({ variant: "secondary", size: "sm" })} href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Abrir portal</a>
        </>}
        {!qr && <Button type="button" onClick={() => void generate()} disabled={pending}>{pending ? "Generando…" : url ? "Reintentar QR" : "Generar QR"}</Button>}
      </footer>
    </DialogContent>
  </Dialog>;
}
