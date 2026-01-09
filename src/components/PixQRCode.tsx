'use client';

import { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import { Skeleton } from './ui/skeleton';

interface PixQRCodeProps {
  payload: string;
  pixKey?: string | null;
}

const qrCodeUrlCache = new Map<string, string>();
const qrCodePromiseCache = new Map<string, Promise<string>>();

export default function PixQRCode({ payload, pixKey }: PixQRCodeProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(() => {
    if (!payload) return null;
    return qrCodeUrlCache.get(payload) ?? null;
  });

  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setQrCodeUrl(null);
      return;
    }

    const cachedUrl = qrCodeUrlCache.get(payload);
    if (cachedUrl) {
      setQrCodeUrl(cachedUrl);
      return;
    }

    const existingPromise = qrCodePromiseCache.get(payload);
    const promise =
      existingPromise ??
      (async () => {
        const qrcode = await import('qrcode');
        return qrcode.toDataURL(payload, { width: 256, margin: 1 });
      })();

    if (!existingPromise) {
      qrCodePromiseCache.set(payload, promise);
    }

    promise
      .then((url) => {
        qrCodeUrlCache.set(payload, url);
        qrCodePromiseCache.delete(payload);
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch(() => {
        qrCodePromiseCache.delete(payload);
        if (!cancelled) setQrCodeUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (!payload) return null;

  return (
    <div className="flex flex-col items-center gap-2 p-2 border rounded-lg bg-muted/50 print:gap-1 print:p-1 print-default:gap-1 print-default:p-1">
        <div className="flex items-center gap-2 font-semibold text-sm print:text-[8px] print:gap-1 print-default:text-[8px] print-default:gap-1">
            <QrCode className="h-4 w-4 text-primary print:h-3 print:w-3"/>
            <span>Pague com PIX</span>
        </div>
      {qrCodeUrl ? (
        <img src={qrCodeUrl} alt="PIX QR Code" className="w-full h-auto rounded-md" />
      ) : (
        <Skeleton className="w-full aspect-square rounded-md" />
      )}
      {pixKey && (
        <div className="w-full text-center leading-tight text-foreground print:text-[10px] print-default:text-[9px] print-a4:text-[11px]">
          <div className="text-base font-semibold print:text-[10px] print-default:text-[9px] print-a4:text-[11px]">Chave Pix</div>
          <div className="font-mono font-semibold text-[18px] tracking-tight break-all print:text-[10px] print-default:text-[9px] print-a4:text-[11px]">
            {pixKey}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground text-center mt-1 print-hidden pdf-hidden">
        Abra o app do seu banco e aponte a câmera para o QR Code para pagar.
      </p>
    </div>
  );
}
