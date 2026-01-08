import { NextRequest, NextResponse } from 'next/server';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { displayNumericCode, extractDigits, toBrazilE164 } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const timeZone = 'America/Sao_Paulo';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function splitMessage(message: string, maxLen: number) {
  const normalized = message.replace(/\r\n/g, '\n');
  if (normalized.length <= maxLen) return [normalized];

  const lines = normalized.split('\n');
  const parts: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) parts.push(current.trimEnd());
    current = '';
  };

  for (const line of lines) {
    const chunk = line;
    if (!chunk) {
      if (current.length + 1 > maxLen) flush();
      current = current ? `${current}\n` : '\n';
      continue;
    }

    if (chunk.length > maxLen) {
      flush();
      for (let i = 0; i < chunk.length; i += maxLen) {
        parts.push(chunk.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current ? `${current}\n${chunk}` : chunk;
    if (candidate.length > maxLen) {
      flush();
      current = chunk;
    } else {
      current = candidate;
    }
  }

  flush();
  return parts.length > 0 ? parts : [normalized.slice(0, maxLen)];
}

function dateKeyInTimeZone(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function initFirebaseAdmin() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não configurado.');
  }
  const serviceAccount = JSON.parse(raw);
  initializeApp({ credential: cert(serviceAccount) });
}

function buildChargeMessage(params: {
  orderId: string;
  order: any;
  pixKey: string;
  storeName: string;
  installment: any;
  pendingAmount: number;
}) {
  const { orderId, order, pixKey, storeName, installment, pendingAmount } = params;

  const customer = order?.customer || {};
  const customerName = typeof customer?.name === 'string' ? customer.name : '';
  const firstName = customerName.split(' ')[0] || 'cliente';
  const customerCode = typeof customer?.code === 'string' ? customer.code : '';

  const items = Array.isArray(order?.items) ? order.items : [];
  const itemsLines = items.flatMap((item: any) => {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const productCode =
      typeof item?.code === 'string' && item.code.trim()
        ? item.code.trim()
        : typeof item?.id === 'string'
          ? item.id
          : '-';
    const productCodeDisplay = displayNumericCode(productCode) || '-';
    return [`*${name}* (Cód.: ${productCodeDisplay})`];
  });

  const dueDateText =
    typeof installment?.dueDate === 'string' && installment.dueDate
      ? format(parseISO(installment.dueDate), 'dd/MM/yyyy', { locale: ptBR })
      : '-';
  const installmentNumber = Number(installment?.installmentNumber) || 0;
  const installmentsCount = Number(order?.installments) || (Array.isArray(order?.installmentDetails) ? order.installmentDetails.length : 0);
  const orderCode = displayNumericCode(orderId) || orderId;
  const customerCodeDisplay = displayNumericCode(customerCode);

  return [
    `Olá, ${firstName}!`,
    '',
    `Lembrete de parcela do carnê (pedido ${orderCode}).`,
    `Parcela: ${installmentNumber}${installmentsCount ? `/${installmentsCount}` : ''}`,
    `Vencimento: *${dueDateText}*`,
    `Valor: *${formatCurrency(pendingAmount)}*`,
    customerCodeDisplay ? `Cód. Cliente: ${customerCodeDisplay}` : null,
    '',
    'Produtos:',
    ...itemsLines,
    '',
    `Chave pix: ${pixKey || '-'}`,
    'Adriano Cavalcante de Oliveira',
    'Banco: Nubank',
    '',
    'Não esqueça de enviar o comprovante!',
    '',
    storeName ? `*${storeName}*` : null,
  ]
    .filter((line) => line != null)
    .join('\n');
}

async function sendMenuiaText(to: string, message: string) {
  const appkey = process.env.MENUIA_APPKEY;
  const authkey = process.env.MENUIA_AUTHKEY;
  const endpoint = process.env.MENUIA_TEXT_ENDPOINT;

  if (!appkey || !authkey || !endpoint) {
    throw new Error('Menuia não configurado no servidor.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const parts = splitMessage(message, 900);
    for (const part of parts) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appkey, authkey, to, message: part }),
        signal: controller.signal,
      });
      if (!res.ok) return false;
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = request.headers.get('x-cron-secret') || '';
  const provided = bearer || headerSecret;

  if (provided !== secret) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    initFirebaseAdmin();
    const db = getFirestore();

    const settingsSnap = await db.doc('config/storeSettings').get();
    const settings = settingsSnap.exists ? (settingsSnap.data() as any) : {};
    const pixKey = typeof settings?.pixKey === 'string' ? settings.pixKey : '';
    const storeName = typeof settings?.storeName === 'string' ? settings.storeName : '';
    const menuiaSendEnabled = typeof settings?.menuiaSendEnabled === 'boolean' ? settings.menuiaSendEnabled : true;

    const todayKey = dateKeyInTimeZone(new Date());
    const nowIso = new Date().toISOString();

    if (!menuiaSendEnabled) {
      return NextResponse.json({
        disabled: true,
        scannedOrders: 0,
        dueInstallments: 0,
        sent: 0,
        failed: 0,
        todayKey,
      });
    }

    const ordersSnap = await db.collection('orders').get();
    let scannedOrders = 0;
    let dueInstallments = 0;
    let sent = 0;
    let failed = 0;

    for (const orderDoc of ordersSnap.docs) {
      scannedOrders++;
      const order = orderDoc.data() as any;
      const status = typeof order?.status === 'string' ? order.status : '';
      if (status === 'Excluído' || status === 'Cancelado') continue;

      const customerName = typeof order?.customer?.name === 'string' ? order.customer.name : '';
      const firstName = customerName.split(' ')[0] || 'cliente';
      const customerPhone = typeof order?.customer?.phone === 'string' ? order.customer.phone : '';
      const to = toBrazilE164(customerPhone);
      if (!to) continue;

      const installmentDetails = Array.isArray(order?.installmentDetails) ? order.installmentDetails : [];
      if (installmentDetails.length === 0) continue;

      let changed = false;
      const updatedInstallments = installmentDetails.map((inst: any) => ({ ...inst }));

      for (let i = 0; i < updatedInstallments.length; i++) {
        const inst = updatedInstallments[i];
        if (!inst || inst.status !== 'Pendente' || typeof inst.dueDate !== 'string') continue;

        const dueKey = dateKeyInTimeZone(new Date(inst.dueDate));
        if (dueKey !== todayKey) continue;

        const alreadySentAt = typeof inst.lastChargeSentAt === 'string' ? inst.lastChargeSentAt : '';
        if (alreadySentAt) {
          const sentKey = dateKeyInTimeZone(new Date(alreadySentAt));
          if (sentKey === todayKey) continue;
        }

        const amount = Number(inst.amount) || 0;
        const paidAmount = Number(inst.paidAmount) || 0;
        const pendingAmount = Math.max(0, amount - paidAmount);
        if (pendingAmount <= 0) continue;

        dueInstallments++;
        const message = buildChargeMessage({
          orderId: orderDoc.id,
          order,
          pixKey,
          storeName,
          installment: inst,
          pendingAmount,
        });

        try {
          const ok = await sendMenuiaText(to, message);
          if (ok) {
            sent++;
            updatedInstallments[i] = { ...inst, lastChargeSentAt: nowIso };
            changed = true;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      if (changed) {
        await orderDoc.ref.update({ installmentDetails: updatedInstallments });
      }
    }

    return NextResponse.json({
      scannedOrders,
      dueInstallments,
      sent,
      failed,
      todayKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
