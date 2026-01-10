

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useSettings } from '@/context/SettingsContext';
import { useAdmin, useAdminData } from '@/context/AdminContext';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState, useRef } from 'react';
import { Settings, Save, FileDown, Upload, AlertTriangle, RotateCcw, Trash2, Lock, History, User, Calendar, Shield, Image as ImageIcon, Clock, Package, DollarSign, Users, ShoppingCart } from 'lucide-react';
import type { RolePermissions, UserRole, AppSection, StoreSettings, CustomerInfo, Order } from '@/lib/types';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAudit } from '@/context/AuditContext';
import { usePermissions } from '@/context/PermissionsContext';
import { ALL_SECTIONS } from '@/lib/permissions';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { WhatsAppIcon } from '@/components/WhatsAppIcon';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Image from 'next/image';
import { Switch } from '@/components/ui/switch';
import { useData } from '@/context/DataContext';
import { buildWhatsAppLink, displayNumericCode, toBrazilE164 } from '@/lib/utils';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, waitForPendingWrites, writeBatch, type DocumentData, type Query, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';

const settingsSchema = z.object({
  storeName: z.string().trim().min(1, 'O nome da loja é obrigatório.').max(1000),
  storeAddress: z.string().trim().min(1, 'O endereço da loja é obrigatório.').max(1000),
  storeCity: z.string().trim().min(1, 'A cidade da loja é obrigatória.').max(1000),
  pixKey: z.string().trim().min(1, 'A chave PIX é obrigatória.').max(1000),
  storePhone: z.string().trim().min(1, 'O telefone da loja é obrigatório.').max(1000),
  logoUrl: z.string().optional(),
  accessControlEnabled: z.boolean().optional(),
  commercialHourStart: z.string().optional(),
  commercialHourEnd: z.string().optional(),
  chargeSendTime: z.string().optional(),
  menuiaSendEnabled: z.boolean().optional(),
});

function AuditLogCard() {
    const { auditLogs, isLoading } = useAudit();
    const [page, setPage] = useState(1);
    const logsPerPage = 10;

    const paginatedLogs = auditLogs.slice((page - 1) * logsPerPage, page * logsPerPage);
    const totalPages = Math.ceil(auditLogs.length / logsPerPage);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <History className="h-6 w-6" />
                    Log de Ações do Sistema
                </CardTitle>
                <CardDescription>
                    Acompanhe as ações importantes realizadas no sistema.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p>Carregando logs...</p>
                ) : auditLogs.length > 0 ? (
                    <>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[180px]">Data e Hora</TableHead>
                                        <TableHead>Usuário</TableHead>
                                        <TableHead>Ação</TableHead>
                                        <TableHead>Detalhes</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedLogs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-xs whitespace-nowrap">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" />
                                                    {format(new Date(log.timestamp), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium flex items-center gap-1"><User className="h-3 w-3" /> {log.userName}</span>
                                                    <Badge variant="secondary" className="capitalize w-fit mt-1">
                                                        <Shield className="h-3 w-3 mr-1" />
                                                        {log.userRole}
                                                    </Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{log.action}</Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{log.details}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="flex justify-end items-center gap-2 mt-4">
                                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-sm disabled:opacity-50">
                                    Anterior
                                </button>
                                <span className="text-sm">
                                    Página {page} de {totalPages}
                                </span>
                                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-sm disabled:opacity-50">
                                    Próxima
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <History className="mx-auto h-12 w-12" />
                        <h3 className="mt-4 text-lg font-semibold">Nenhum registro de auditoria</h3>
                        <p className="mt-1 text-sm">As ações realizadas no sistema aparecerão aqui.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default function ConfiguracaoPage() {
  const { settings, updateSettings, isLoading: settingsLoading, restoreSettings, resetSettings } = useSettings();
  const { restoreAdminData, seedSampleCatalog, importCatalogData, resetOrders, resetProducts, resetFinancials, resetAllAdminData } = useAdmin();
  const { products, categories } = useData();
  const { orders, customers } = useAdminData();
  const { user, users, restoreUsers, initialUsers } = useAuth();
  const { permissions, updatePermissions, isLoading: permissionsLoading, resetPermissions } = usePermissions();
  const { toast } = useToast();
  const { logAction } = useAudit();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const catalogFileInputRef = useRef<HTMLInputElement>(null);
  
  const [dialogOpenFor, setDialogOpenFor] = useState<'resetOrders' | 'resetProducts' | 'resetFinancials' | 'resetAll' | null>(null);
  const [localPermissions, setLocalPermissions] = useState<RolePermissions | null>(null);
  const [isFirestoreBackupExporting, setIsFirestoreBackupExporting] = useState(false);
  const [isFirestoreBackupCsvExporting, setIsFirestoreBackupCsvExporting] = useState(false);
  const [isBackupExporting, setIsBackupExporting] = useState(false);
  const [isOrdersCsvExporting, setIsOrdersCsvExporting] = useState(false);

  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const removeUndefinedDeep = <T,>(value: T): T => {
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
    if (isPlainObject(value)) {
      const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefinedDeep(v)]);
      return Object.fromEntries(entries) as T;
    }
    return value;
  };

  const deserializeFirestoreValue = (value: any): any => {
    if (value == null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map((v) => deserializeFirestoreValue(v));

    if (typeof value === 'object') {
      const typeTag = (value as any).__type;
      if (typeTag === 'timestamp' || typeTag === 'date') {
        const raw = (value as any).value;
        return typeof raw === 'string' ? raw : raw;
      }
      if (typeTag === 'geopoint') {
        return { latitude: (value as any).latitude, longitude: (value as any).longitude };
      }
      if (typeTag === 'reference') {
        return { path: (value as any).path };
      }

      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = deserializeFirestoreValue(v);
      }
      return out;
    }

    return value;
  };

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
        storeName: '',
        storeCity: '',
        storeAddress: '',
        pixKey: '',
        storePhone: '',
        logoUrl: '',
        accessControlEnabled: false,
        commercialHourStart: '08:00',
        commercialHourEnd: '18:00',
        chargeSendTime: '09:00',
        menuiaSendEnabled: true,
    },
  });

  useEffect(() => {
    if (!settingsLoading && settings) {
      form.reset({
          ...settings,
          commercialHourStart: settings.commercialHourStart || '08:00',
          commercialHourEnd: settings.commercialHourEnd || '18:00',
          chargeSendTime: settings.chargeSendTime || '09:00',
          menuiaSendEnabled: settings.menuiaSendEnabled ?? true,
      });
    }
  }, [settingsLoading, settings, form]);

  useEffect(() => {
    if (!permissionsLoading && permissions) {
        setLocalPermissions(JSON.parse(JSON.stringify(permissions)));
    }
  }, [permissionsLoading, permissions]);

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        form.setValue('logoUrl', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleExport = (data: any, filename: string, options?: { pretty?: boolean }) => {
    const json = options?.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().slice(0, 10);
    link.download = `export-${filename}-${date}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: 'Exportação Concluída!', description: `O arquivo ${filename} foi baixado.` });
  };

  const handleExportCsv = (csv: string, filename: string) => {
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().slice(0, 10);
    link.download = `export-${filename}-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: 'Exportação Concluída!', description: `O arquivo ${filename} foi baixado.` });
  };

  const fetchAllRawFromCollection = async (collectionName: string) => {
    const { db } = getClientFirebase();
    let last: QueryDocumentSnapshot<DocumentData> | null = null;
    const all: any[] = [];

    while (true) {
      let q: Query<DocumentData>;
      if (last) {
        q = query(collection(db, collectionName), orderBy(documentId()), startAfter(last), limit(450));
      } else {
        q = query(collection(db, collectionName), orderBy(documentId()), limit(450));
      }
      const snap: QuerySnapshot<DocumentData> = await getDocs(q);
      if (snap.empty) break;
      snap.docs.forEach((d: QueryDocumentSnapshot<DocumentData>) => {
        all.push({ id: d.id, ...d.data() });
      });
      last = snap.docs[snap.docs.length - 1] ?? null;
    }
    return all;
  };

  const handleExportFullBackup = async () => {
    if (isBackupExporting) return;
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
      toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem exportar backup completo.', variant: 'destructive' });
      return;
    }

    setIsBackupExporting(true);
    toast({ title: 'Gerando backup completo...', description: 'Carregando dados do Firestore.' });

    try {
      const [allOrders, allProducts, allCategories, allUsers] = await Promise.all([
        fetchAllRawFromCollection('orders'),
        fetchAllRawFromCollection('products'),
        fetchAllRawFromCollection('categories'),
        fetchAllRawFromCollection('users'),
      ]);
      const backupData = {
        settings,
        products: allProducts,
        orders: allOrders,
        categories: allCategories,
        users: allUsers,
        permissions,
      };

      handleExport(backupData, 'backup-completo');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar backup completo.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setIsBackupExporting(false);
    }
  };

  const serializeFirestoreValue = (value: any): any => {
    if (value == null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
    if (Array.isArray(value)) return value.map((v) => serializeFirestoreValue(v));

    if (typeof value === 'object') {
      const maybeToDate = (value as { toDate?: () => Date }).toDate;
      if (typeof maybeToDate === 'function') return { __type: 'timestamp', value: maybeToDate().toISOString() };

      const seconds = (value as { seconds?: number }).seconds;
      if (typeof seconds === 'number') return { __type: 'timestamp', value: new Date(seconds * 1000).toISOString() };

      const geo = value as { latitude?: unknown; longitude?: unknown };
      if (typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
        return { __type: 'geopoint', latitude: geo.latitude, longitude: geo.longitude };
      }

      const ref = value as { path?: unknown };
      if (typeof ref.path === 'string' && ref.path.includes('/')) {
        return { __type: 'reference', path: ref.path };
      }

      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = serializeFirestoreValue(v);
      }
      return out;
    }

    return value;
  };

  const fetchAllFromCollection = async (collectionName: string) => {
    const { db } = getClientFirebase();
    let last: QueryDocumentSnapshot<DocumentData> | null = null;
    const all: any[] = [];

    while (true) {
      let q: Query<DocumentData>;
      if (last) {
        q = query(collection(db, collectionName), orderBy(documentId()), startAfter(last), limit(450));
      } else {
        q = query(collection(db, collectionName), orderBy(documentId()), limit(450));
      }
      const snap: QuerySnapshot<DocumentData> = await getDocs(q);
      if (snap.empty) break;
      snap.docs.forEach((d: QueryDocumentSnapshot<DocumentData>) => {
        all.push({ id: d.id, ...serializeFirestoreValue(d.data()) });
      });
      last = snap.docs[snap.docs.length - 1] ?? null;
    }
    return all;
  };

  const handleExportFirestoreFullBackup = async () => {
    if (isFirestoreBackupExporting) return;
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
      toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem exportar backup completo.', variant: 'destructive' });
      return;
    }

    setIsFirestoreBackupExporting(true);
    toast({ title: 'Gerando backup completo...', description: 'Isso pode demorar alguns minutos.' });

    try {
      const { db } = getClientFirebase();

      const settingsSnap = await getDoc(doc(db, 'config', 'storeSettings'));
      const permissionsSnap = await getDoc(doc(db, 'config', 'rolePermissions'));

      const collectionNames = [
        'orders',
        'products',
        'categories',
        'users',
        'commissionPayments',
        'stockAudits',
        'avarias',
        'chatSessions',
        'auditLogs',
      ];

      const collections: Record<string, any[]> = {};
      let totalDocs = 0;
      for (const name of collectionNames) {
        const items = await fetchAllFromCollection(name);
        collections[name] = items;
        totalDocs += items.length;
      }

      const exportedAt = new Date().toISOString();
      const payload = {
        version: 1,
        exportedAt,
        config: {
          storeSettings: settingsSnap.exists() ? serializeFirestoreValue(settingsSnap.data()) : null,
          rolePermissions: permissionsSnap.exists() ? serializeFirestoreValue(permissionsSnap.data()) : null,
        },
        collections,
      };

      handleExport(payload, 'backup-completo-firestore', { pretty: false });
      toast({ title: 'Backup exportado!', description: `Backup completo do Firestore baixado (${totalDocs} registros).` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar backup completo.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setIsFirestoreBackupExporting(false);
    }
  };

  const handleExportFirestoreFullBackupCsv = async () => {
    if (isFirestoreBackupCsvExporting) return;
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
      toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem exportar backup completo.', variant: 'destructive' });
      return;
    }

    setIsFirestoreBackupCsvExporting(true);
    toast({ title: 'Gerando backup completo em CSV...', description: 'Isso pode demorar alguns minutos.' });

    const delimiter = ';';
    const escapeCsv = (value: unknown) => {
      const raw = value == null ? '' : String(value);
      const escaped = raw.replace(/"/g, '""');
      const mustQuote = escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r') || escaped.includes(delimiter);
      return mustQuote ? `"${escaped}"` : escaped;
    };

    try {
      const { db } = getClientFirebase();

      const settingsSnap = await getDoc(doc(db, 'config', 'storeSettings'));
      const permissionsSnap = await getDoc(doc(db, 'config', 'rolePermissions'));

      const collectionNames = [
        'orders',
        'products',
        'categories',
        'users',
        'commissionPayments',
        'stockAudits',
        'avarias',
        'chatSessions',
        'auditLogs',
      ];

      const collections: Record<string, any[]> = {};
      let totalDocs = 0;
      for (const name of collectionNames) {
        const items = await fetchAllFromCollection(name);
        collections[name] = items;
        totalDocs += items.length;
      }

      const rows: string[] = [];
      rows.push(['scope', 'name', 'id', 'data'].join(delimiter));

      const configStoreSettings = settingsSnap.exists() ? serializeFirestoreValue(settingsSnap.data()) : null;
      const configRolePermissions = permissionsSnap.exists() ? serializeFirestoreValue(permissionsSnap.data()) : null;

      rows.push(
        ['config', 'storeSettings', '', JSON.stringify(configStoreSettings)].map(escapeCsv).join(delimiter)
      );
      rows.push(
        ['config', 'rolePermissions', '', JSON.stringify(configRolePermissions)].map(escapeCsv).join(delimiter)
      );

      for (const [collectionName, items] of Object.entries(collections)) {
        for (const raw of items) {
          const id = typeof raw?.id === 'string' ? raw.id : '';
          const data = { ...raw };
          delete (data as any).id;
          rows.push(
            ['collection', collectionName, id, JSON.stringify(data)].map(escapeCsv).join(delimiter)
          );
        }
      }

      handleExportCsv(rows.join('\n'), 'backup-completo-firestore');
      toast({ title: 'Backup exportado!', description: `Backup completo em CSV baixado (${totalDocs} registros).` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar backup completo.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setIsFirestoreBackupCsvExporting(false);
    }
  };

  const handleExportOrdersCsv = async () => {
    if (isOrdersCsvExporting) return;
    setIsOrdersCsvExporting(true);
    toast({ title: 'Gerando pedidos em CSV...', description: 'Carregando dados do Firestore.' });

    const delimiter = ';';
    const escapeCsv = (value: unknown) => {
      const raw = value == null ? '' : String(value);
      const escaped = raw.replace(/"/g, '""');
      const mustQuote = escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r') || escaped.includes(delimiter);
      return mustQuote ? `"${escaped}"` : escaped;
    };

    const normalizeValue = (value: unknown): unknown => {
      if (value == null) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value) || typeof value === 'object') {
        const maybeToDate = (value as { toDate?: () => Date }).toDate;
        if (typeof maybeToDate === 'function') return maybeToDate().toISOString();
        const seconds = (value as { seconds?: number }).seconds;
        if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString();
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    };

    const getCreatedByName = (order: Partial<Order> & { createdById?: string; createdByName?: string; source?: string }) => {
      const explicit = order.createdByName?.trim();
      if (explicit) return explicit;
      const byId = order.createdById;
      if (byId) return users.find((u) => u.id === byId)?.name || '';
      if (order.source === 'catalogo') return 'Cliente (catálogo)';
      return '';
    };

    try {
      const allOrders = await fetchAllRawFromCollection('orders');

      const headers = [
        'orderId',
        'orderDate',
        'status',
        'paymentMethod',
        'total',
        'discount',
        'downPayment',
        'installments',
        'installmentValue',
        'commission',
        'commissionPaid',
        'sellerId',
        'sellerName',
        'createdByName',
        'createdFromIp',
        'source',
        'customerName',
        'customerCpf',
        'customerCode',
        'customerPhone',
        'customerPhone2',
        'customerPhone3',
        'customerEmail',
        'customerZip',
        'customerAddress',
        'customerNumber',
        'customerComplement',
        'customerNeighborhood',
        'customerCity',
        'customerState',
        'observations',
        'installmentDetailsJson',
        'attachmentsJson',
        'itemId',
        'itemName',
        'itemPrice',
        'itemQuantity',
      ];

      const rows: string[] = [];
      rows.push(headers.join(delimiter));

      for (const raw of allOrders) {
        const order = raw as Partial<Order> & { id?: string };
        const customer = (order.customer || {}) as Partial<CustomerInfo>;
        const createdByName = getCreatedByName(order);

        const baseRow: Record<string, unknown> = {
          orderId: displayNumericCode(order.id),
          orderDate: order.date ?? '',
          status: order.status ?? '',
          paymentMethod: order.paymentMethod ?? '',
          total: order.total ?? '',
          discount: order.discount ?? '',
          downPayment: order.downPayment ?? '',
          installments: order.installments ?? '',
          installmentValue: order.installmentValue ?? '',
          commission: order.commission ?? '',
          commissionPaid: order.commissionPaid ?? '',
          sellerId: order.sellerId ?? '',
          sellerName: order.sellerName ?? '',
          createdByName,
          createdFromIp: (order as any).createdFromIp ?? '',
          source: order.source ?? '',
          customerName: customer.name ?? '',
          customerCpf: customer.cpf ?? '',
          customerCode: customer.code ?? '',
          customerPhone: customer.phone ?? '',
          customerPhone2: customer.phone2 ?? '',
          customerPhone3: customer.phone3 ?? '',
          customerEmail: customer.email ?? '',
          customerZip: customer.zip ?? '',
          customerAddress: customer.address ?? '',
          customerNumber: customer.number ?? '',
          customerComplement: customer.complement ?? '',
          customerNeighborhood: customer.neighborhood ?? '',
          customerCity: customer.city ?? '',
          customerState: customer.state ?? '',
          observations: order.observations ?? '',
          installmentDetailsJson: JSON.stringify(order.installmentDetails || []),
          attachmentsJson: JSON.stringify(order.attachments || []),
        };

        const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [{ id: '', name: '', price: 0, quantity: 0, imageUrl: '' }];
        for (const item of items as any[]) {
          const rowObj: Record<string, unknown> = {
            ...baseRow,
            itemId: item?.id ?? '',
            itemName: item?.name ?? '',
            itemPrice: item?.price ?? '',
            itemQuantity: item?.quantity ?? '',
          };
          rows.push(headers.map((h) => escapeCsv(normalizeValue(rowObj[h]))).join(delimiter));
        }
      }

      handleExportCsv(rows.join('\n'), 'pedidos');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao exportar pedidos em CSV.';
      toast({ title: 'Erro', description: message, variant: 'destructive' });
    } finally {
      setIsOrdersCsvExporting(false);
    }
  };


  const handleRestore = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const restoreStartedAt = Date.now();
      let willReload = false;
      try {
        window.localStorage.setItem('admin.restore.inflight.v1', String(restoreStartedAt));
      } catch {
      }
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        const { db } = getClientFirebase();

        const commitWithRetry = async (batch: ReturnType<typeof writeBatch>, op: 'delete' | 'write') => {
          let delayMs = 600;
          for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
              await batch.commit();
              return;
            } catch (error) {
              const code = (error as { code?: unknown } | null)?.code;
              const shouldRetry = code === 'resource-exhausted' || code === 'unavailable' || code === 'deadline-exceeded';
              if (!shouldRetry || attempt === 5) {
                throw error instanceof Error ? error : new Error(`Firestore ${op} failed`);
              }
              await sleep(delayMs);
              delayMs = Math.min(10_000, Math.floor(delayMs * 1.7));
            }
          }
        };

        const deleteAllDocs = async (collectionName: string) => {
          let last: QueryDocumentSnapshot<DocumentData> | null = null;
          while (true) {
            const q: Query<DocumentData> = last
              ? query(collection(db, collectionName), orderBy(documentId()), startAfter(last), limit(450))
              : query(collection(db, collectionName), orderBy(documentId()), limit(450));
            const snap: QuerySnapshot<DocumentData> = await getDocs(q);
            if (snap.empty) break;

            const batch = writeBatch(db);
            snap.docs.forEach((d: QueryDocumentSnapshot<DocumentData>) => batch.delete(d.ref));
            await commitWithRetry(batch, 'delete');
            last = snap.docs[snap.docs.length - 1] ?? null;
          }
        };

        const restoreCollection = async (collectionName: string, rawItems: unknown) => {
          const items = Array.isArray(rawItems) ? rawItems : [];
          await deleteAllDocs(collectionName);

          let batch = writeBatch(db);
          let ops = 0;

          const commitIfNeeded = async (force = false) => {
            if (!force && ops < 450) return;
            if (ops === 0) return;
            await commitWithRetry(batch, 'write');
            batch = writeBatch(db);
            ops = 0;
          };

          for (let i = 0; i < items.length; i += 1) {
            const raw = items[i] as any;
            const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `restored-${collectionName}-${Date.now()}-${i}`;
            const decoded = deserializeFirestoreValue(raw);
            const { id: _omit, ...docData } = decoded ?? {};
            batch.set(doc(db, collectionName, id), removeUndefinedDeep(docData));
            ops += 1;
            await commitIfNeeded(false);
          }

          await commitIfNeeded(true);
        };

        const isFirestoreBackup =
          !!data &&
          typeof data === 'object' &&
          (data as any).version === 1 &&
          !!(data as any).collections &&
          typeof (data as any).collections === 'object' &&
          !!(data as any).config &&
          typeof (data as any).config === 'object';

        if (isFirestoreBackup) {
          if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
            toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem restaurar backup.', variant: 'destructive' });
            return;
          }

          toast({ title: 'Restaurando backup completo...', description: 'Escrevendo dados no Firestore. Isso pode demorar.' });

          const payload = data as any;
          const config = payload.config ?? {};
          const collectionsPayload = payload.collections ?? {};

          try {
            window.localStorage.setItem('admin.orders.cache.v1', JSON.stringify([]));
          } catch {
          }

          const storeSettings = config.storeSettings ? deserializeFirestoreValue(config.storeSettings) : null;
          const rolePermissions = config.rolePermissions ? deserializeFirestoreValue(config.rolePermissions) : null;

          if (storeSettings) {
            await setDoc(doc(db, 'config', 'storeSettings'), removeUndefinedDeep(storeSettings));
          }
          if (rolePermissions) {
            await setDoc(doc(db, 'config', 'rolePermissions'), removeUndefinedDeep(rolePermissions));
          }

          const collectionNames = Object.keys(collectionsPayload);
          for (const name of collectionNames) {
            await restoreCollection(name, collectionsPayload[name]);
          }

          try {
            const rawOrders = collectionsPayload?.orders;
            const items = Array.isArray(rawOrders) ? rawOrders : [];
            const decodedOrders = items
              .map((raw: any, i: number) => {
                const id =
                  typeof raw?.id === 'string' && raw.id.trim()
                    ? raw.id.trim()
                    : `restored-orders-${restoreStartedAt}-${i}`;
                const decoded = deserializeFirestoreValue(raw);
                const { id: _omit, ...docData } = decoded ?? {};
                return { ...docData, id };
              })
              .filter((o: any) => !!o && typeof o.id === 'string' && o.id.trim().length > 0);

            const getSortTime = (order: any) => {
              const raw = (order?.date || order?.createdAt || '') as string;
              const t = Date.parse(raw);
              return Number.isFinite(t) ? t : 0;
            };
            decodedOrders.sort((a: any, b: any) => getSortTime(b) - getSortTime(a));

            const RECENT_ORDERS_LIMIT = 1000;
            window.localStorage.setItem('admin.orders.cache.v1', JSON.stringify(decodedOrders.slice(0, RECENT_ORDERS_LIMIT)));
          } catch {
          }

          await Promise.race([waitForPendingWrites(db), sleep(8000)]);

          toast({ title: 'Backup Restaurado!', description: 'Dados completos foram gravados no Firestore.' });
          willReload = true;
          window.setTimeout(() => window.location.reload(), 250);
          return;
        }

        if (data.settings && data.products && data.orders && data.categories && data.users) {
          await restoreSettings(data.settings);
          await restoreAdminData({ products: data.products, orders: data.orders, categories: data.categories }, logAction, user);
          await restoreUsers(data.users);
          if (data.permissions) {
             await updatePermissions(data.permissions);
          }
          await Promise.race([waitForPendingWrites(db), sleep(8000)]);
          toast({ title: 'Backup Restaurado!', description: 'Os dados da loja foram restaurados com sucesso.' });
          willReload = true;
          window.setTimeout(() => window.location.reload(), 250);
        } else {
          throw new Error('Formato de arquivo de backup inválido.');
        }
      } catch (error) {
        console.error("Failed to restore backup:", error);
        toast({ title: 'Erro ao Restaurar', description: 'O arquivo de backup é inválido ou está corrompido.', variant: 'destructive' });
      } finally {
        if (!willReload) {
          try {
            window.localStorage.removeItem('admin.restore.inflight.v1');
          } catch {
          }
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const handleCatalogImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        const isArray = Array.isArray(parsed);
        const isObject = !!parsed && typeof parsed === 'object' && !isArray;

        if (isArray) {
          const first = parsed[0] as any;
          const looksLikeCategory = !!first && typeof first === 'object' && ('subcategories' in first || 'order' in first);
          if (looksLikeCategory) {
            await importCatalogData({ categories: parsed }, logAction, user);
          } else {
            await importCatalogData({ products: parsed }, logAction, user);
          }
          return;
        }

        if (isObject) {
          const obj = parsed as any;
          const productsFromFile = Array.isArray(obj.products) ? obj.products : undefined;
          const categoriesFromFile = Array.isArray(obj.categories) ? obj.categories : undefined;

          if (!productsFromFile && !categoriesFromFile) {
            throw new Error('Formato inválido para catálogo.');
          }

          await importCatalogData({ products: productsFromFile, categories: categoriesFromFile }, logAction, user);
          return;
        }

        throw new Error('Formato inválido para catálogo.');
      } catch (error) {
        console.error("Failed to import catalog:", error);
        toast({ title: 'Erro ao Importar', description: 'O arquivo de catálogo é inválido ou está corrompido.', variant: 'destructive' });
      } finally {
        if (catalogFileInputRef.current) {
          catalogFileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };
  
  const handleReset = async (type: 'resetOrders' | 'resetProducts' | 'resetFinancials' | 'resetAll') => {
    setDialogOpenFor(null);
    switch (type) {
        case 'resetOrders':
            await resetOrders(logAction, user);
            toast({ title: "Ação Concluída", description: "Todos os pedidos e dados de clientes foram zerados." });
            break;
        case 'resetProducts':
            await resetProducts(logAction, user);
            toast({ title: "Ação Concluída", description: "Todos os produtos foram zerados." });
            break;
        case 'resetFinancials':
            await resetFinancials(logAction, user);
            toast({ title: "Ação Concluída", description: "O histórico de pagamentos de comissão foi zerado." });
            break;
        case 'resetAll':
            await resetAllAdminData(logAction, user);
            await restoreUsers(initialUsers);
            await resetPermissions();
            toast({ title: "Loja Resetada!", description: "Todos os dados foram restaurados para o padrão." });
            break;
    }
  }

  function onSubmit(values: z.infer<typeof settingsSchema>) {
    const safeValues = { ...values };
    if ((!safeValues.logoUrl || safeValues.logoUrl.trim() === '') && settings.logoUrl) {
      safeValues.logoUrl = undefined;
    }
    updateSettings(safeValues);
  }

  const handleTestMenuiaSend = async () => {
    const rawPhone = form.getValues('storePhone') || settings.storePhone;
    const to = toBrazilE164(rawPhone);
    if (!to) {
      toast({ title: 'Erro', description: 'Telefone da loja inválido.', variant: 'destructive' });
      return;
    }

    const message = `Teste automático (Menuia) - ${new Date().toLocaleString('pt-BR')}`;
    const menuiaSendEnabled = form.getValues('menuiaSendEnabled') ?? true;
    if (!menuiaSendEnabled) {
      const link = buildWhatsAppLink(to, message);
      if (!link) {
        toast({ title: 'Erro', description: 'Telefone da loja inválido.', variant: 'destructive' });
        return;
      }
      window.open(link, '_blank', 'noopener,noreferrer');
      toast({ title: 'WhatsApp aberto', description: 'Envio manual (Menuia desativado).' });
      return;
    }

    try {
      const res = await fetch('/api/menuia/send-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to,
          message,
        }),
      });

      if (res.ok) {
        toast({ title: 'OK', description: 'Mensagem de teste enviada para o WhatsApp da loja.' });
      } else {
        toast({ title: 'Erro', description: `Falha ao enviar mensagem (status ${res.status}).`, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Erro', description: 'Falha ao enviar mensagem de teste.', variant: 'destructive' });
    }
  };

  const handlePermissionChange = (role: UserRole, section: AppSection, checked: boolean) => {
    setLocalPermissions(prev => {
        if (!prev) return null;
        let updatedPermissions = { ...prev };
        
        let rolePermissions = updatedPermissions[role] ? [...updatedPermissions[role]] : [];

        if (checked) {
            if (!rolePermissions.includes(section)) {
                rolePermissions.push(section);
            }
        } else {
            rolePermissions = rolePermissions.filter(s => s !== section);
        }

        updatedPermissions[role] = rolePermissions;
        
        return updatedPermissions;
    });
  };

  const handleSavePermissions = () => {
      if (localPermissions) {
          updatePermissions(localPermissions);
      }
  };

  if (settingsLoading || permissionsLoading) {
    return <p>Carregando configurações...</p>;
  }

  const logoPreview = form.watch('logoUrl');
  const accessControlEnabled = form.watch('accessControlEnabled');


  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Configurações da Loja
          </CardTitle>
          <CardDescription>
            Altere as informações da sua loja, como nome, endereço, chave PIX e telefone para notificações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="storeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da Loja</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Minha Loja Incrível" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="storeAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endereço da Loja</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Ex: Rua da Loja, 123 - Centro, São Paulo/SP" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2"><ImageIcon /> Logo da Loja</FormLabel>
                     <div className="flex items-center gap-4">
                        {logoPreview ? (
                            <div className="relative w-32 h-14 rounded-md border p-1 bg-muted">
                                <Image src={logoPreview} alt="Preview do Logo" fill className="object-contain" sizes="130px"/>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-14 w-32 rounded-md border border-dashed bg-muted/50 text-muted-foreground">
                                <ImageIcon className="h-8 w-8" />
                            </div>
                        )}
                        <FormControl>
                            <Input type="file" accept="image/*" onChange={handleLogoUpload} className="max-w-xs" />
                        </FormControl>
                    </div>
                    <FormDescription>
                      Tamanho recomendado: 130px (largura) por 56px (altura).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <FormField
                    control={form.control}
                    name="storeCity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cidade da Loja (para Recibos)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: São Paulo" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pixKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Chave PIX</FormLabel>
                        <FormControl>
                          <Input placeholder="CPF, CNPJ, Email, Telefone ou Chave Aleatória" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="chargeSendTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Horário do Envio Automático de Cobrança</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} value={field.value || '09:00'} />
                        </FormControl>
                        <FormDescription>
                          Horário de referência para o envio automático das mensagens de cobrança.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="storePhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                            <div className="text-green-600"><WhatsAppIcon /></div>
                            Telefone da Loja (WhatsApp)
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="5511999999999" {...field} />
                        </FormControl>
                        <div className="flex">
                          <Button type="button" variant="outline" size="sm" onClick={handleTestMenuiaSend}>
                            Testar envio (Menuia)
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="menuiaSendEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 md:col-span-2">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">
                            Enviar automaticamente pelo WhatsApp (Menuia)
                          </FormLabel>
                          <FormDescription>
                            Se desativado, o sistema abre o WhatsApp para envio manual.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
              </div>
              <Button type="submit">
                  <Save className="mr-2 h-4 w-4" />
                  Salvar Alterações
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {user?.role === 'admin' && (
        <Card>
           <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-6 w-6" />
                Controle de Acesso por Horário
              </CardTitle>
              <CardDescription>
                Restrinja o acesso de vendedores ao sistema para um horário comercial específico. Gerentes e admins não são afetados.
              </CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="accessControlEnabled"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                    <FormLabel className="text-base">
                                    Ativar controle de acesso por horário
                                    </FormLabel>
                                    <FormDescription>
                                    Se ativado, vendedores só poderão acessar o painel no horário definido.
                                    </FormDescription>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                                </FormItem>
                            )}
                        />
                         {accessControlEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                <FormField
                                    control={form.control}
                                    name="commercialHourStart"
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel>Início do Horário Comercial</FormLabel>
                                        <FormControl>
                                            <Input type="time" {...field} value={field.value || '08:00'} />
                                        </FormControl>
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="commercialHourEnd"
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel>Fim do Horário Comercial</FormLabel>
                                        <FormControl>
                                            <Input type="time" {...field} value={field.value || '18:00'} />
                                        </FormControl>
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                        <Button type="submit">
                            <Save className="mr-2 h-4 w-4" />
                            Salvar Controle de Acesso
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
      )}
      
      {user?.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-6 w-6" />
              Permissões de Acesso
            </CardTitle>
            <CardDescription>
              Defina quais seções cada perfil de usuário pode acessar no painel administrativo. A hierarquia é Vendedor {'<'} Gerente {'<'} Admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
              {localPermissions ? (
                  <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          <div>
                              <h3 className="font-semibold mb-4 capitalize">Vendedor</h3>
                              <div className="space-y-3">
                                  {ALL_SECTIONS.map(section => (
                                      <div key={`vendedor-${section.id}`} className="flex items-center space-x-2">
                                          <Checkbox
                                              id={`vendedor-${section.id}`}
                                              checked={localPermissions.vendedor?.includes(section.id)}
                                              onCheckedChange={(checked) => handlePermissionChange('vendedor', section.id, !!checked)}
                                          />
                                          <label
                                              htmlFor={`vendedor-${section.id}`}
                                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                          >
                                              {section.label}
                                          </label>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div>
                              <h3 className="font-semibold mb-4 capitalize">Gerente</h3>
                               <div className="space-y-3">
                                  {ALL_SECTIONS.filter(section => section.id !== 'financeiro').map(section => (
                                      <div key={`gerente-${section.id}`} className="flex items-center space-x-2">
                                          <Checkbox
                                              id={`gerente-${section.id}`}
                                              checked={localPermissions.gerente?.includes(section.id)}
                                              onCheckedChange={(checked) => handlePermissionChange('gerente', section.id, !!checked)}
                                          />
                                          <label
                                              htmlFor={`gerente-${section.id}`}
                                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                          >
                                              {section.label}
                                          </label>
                                      </div>
                                  ))}
                              </div>
                          </div>

                          <div>
                              <h3 className="font-semibold mb-4 capitalize">Admin</h3>
                              <div className="space-y-3">
                                  {ALL_SECTIONS.map(section => (
                                      <div key={`admin-${section.id}`} className="flex items-center space-x-2">
                                          <Checkbox
                                              id={`admin-${section.id}`}
                                              checked
                                              disabled
                                          />
                                          <label
                                              htmlFor={`admin-${section.id}`}
                                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                          >
                                              {section.label}
                                          </label>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>
                      <Button onClick={handleSavePermissions}>
                          <Save className="mr-2 h-4 w-4" />
                          Salvar Permissões
                      </Button>
                  </div>
              ) : (
                  <p>Carregando permissões...</p>
              )}
          </CardContent>
        </Card>
      )}

      <Card>
          <CardHeader>
              <CardTitle>Backup e Restauração</CardTitle>
              <CardDescription>Salve ou recupere os dados da sua loja.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Exportar Dados</h3>
                <div className="flex flex-col sm:flex-row gap-4">
                    <Button variant="outline" onClick={() => handleExport(orders, 'pedidos')}>
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Exportar Pedidos
                    </Button>
                    <Button variant="outline" onClick={() => void handleExportOrdersCsv()} disabled={isOrdersCsvExporting}>
                        <FileDown className="mr-2 h-4 w-4" />
                        Exportar Pedidos em CSV
                    </Button>
                    <Button variant="outline" onClick={() => handleExport(customers, 'clientes')}>
                        <Users className="mr-2 h-4 w-4" />
                        Exportar Clientes
                    </Button>
                    <Button variant="outline" onClick={() => handleExport(products, 'produtos')}>
                        <Package className="mr-2 h-4 w-4" />
                        Exportar Produtos
                    </Button>
                    <Button variant="outline" onClick={() => void handleExportFullBackup()} disabled={isBackupExporting}>
                        <FileDown className="mr-2 h-4 w-4" />
                        Exportar Backup Completo
                    </Button>
                    <Button variant="outline" onClick={() => void handleExportFirestoreFullBackup()} disabled={isFirestoreBackupExporting}>
                        <FileDown className="mr-2 h-4 w-4" />
                        Exportar Backup Completo (Firestore)
                    </Button>
                    <Button variant="outline" onClick={() => void handleExportFirestoreFullBackupCsv()} disabled={isFirestoreBackupCsvExporting}>
                        <FileDown className="mr-2 h-4 w-4" />
                        Exportar Backup Completo (Firestore) em CSV
                    </Button>
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2 mt-6">Restaurar Backup Completo</h3>
                 <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                   <Upload className="mr-2 h-4 w-4" />
                  Restaurar Backup
                </Button>
                <Input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleRestore} />
                 <p className="text-xs text-muted-foreground mt-2">A restauração substitui todos os dados (pedidos, produtos, categorias, usuários, etc.).</p>
              </div>
              <div>
                <h3 className="font-semibold mb-2 mt-6">Importar Catálogo</h3>
                <Button variant="outline" onClick={() => catalogFileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Importar Produtos/Categorias
                </Button>
                <Input type="file" ref={catalogFileInputRef} className="hidden" accept=".json" onChange={handleCatalogImport} />
                <p className="text-xs text-muted-foreground mt-2">Substitui produtos e/ou categorias conforme o arquivo (não altera pedidos/usuários).</p>
              </div>
              <div>
                <h3 className="font-semibold mb-2 mt-6">Catálogo de Exemplo</h3>
                <Button variant="outline" onClick={() => seedSampleCatalog(logAction, user)}>
                  <Package className="mr-2 h-4 w-4" />
                  Criar Catálogo de Exemplo
                </Button>
                <p className="text-xs text-muted-foreground mt-2">Só funciona se produtos e categorias estiverem vazios.</p>
              </div>
          </CardContent>
      </Card>

       <Card className="border-destructive/50">
          <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-6 w-6" />
                  Zona de Perigo
              </CardTitle>
              <CardDescription>Ações nesta área são irreversíveis. Tenha certeza do que está fazendo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
              <AlertDialog open={dialogOpenFor === 'resetOrders'} onOpenChange={(open) => !open && setDialogOpenFor(null)}>
                  <AlertDialogTrigger asChild>
                      <Button variant="destructive" outline onClick={() => setDialogOpenFor('resetOrders')}>
                        <Trash2 className="mr-2 h-4 w-4" /> Zerar Pedidos
                      </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                      <AlertDialogHeader>
                          <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
                          <AlertDialogDescription>
                              Esta ação não pode ser desfeita. Isso irá apagar permanentemente todos os pedidos e dados de clientes associados.
                          </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleReset('resetOrders')}>Sim, zerar pedidos</AlertDialogAction>
                      </AlertDialogFooter>
                  </AlertDialogContent>
              </AlertDialog>
              <AlertDialog open={dialogOpenFor === 'resetProducts'} onOpenChange={(open) => !open && setDialogOpenFor(null)}>
                  <AlertDialogTrigger asChild>
                      <Button variant="destructive" outline onClick={() => setDialogOpenFor('resetProducts')}>
                        <Package className="mr-2 h-4 w-4" /> Zerar Produtos
                      </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                      <AlertDialogHeader>
                          <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
                          <AlertDialogDescription>
                              Esta ação não pode ser desfeita. Isso irá apagar permanentemente todos os produtos do catálogo.
                          </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleReset('resetProducts')}>Sim, zerar produtos</AlertDialogAction>
                      </AlertDialogFooter>
                  </AlertDialogContent>
              </AlertDialog>
              <AlertDialog open={dialogOpenFor === 'resetFinancials'} onOpenChange={(open) => !open && setDialogOpenFor(null)}>
                  <AlertDialogTrigger asChild>
                      <Button variant="destructive" outline onClick={() => setDialogOpenFor('resetFinancials')}>
                        <DollarSign className="mr-2 h-4 w-4" /> Zerar Financeiro
                      </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                      <AlertDialogHeader>
                          <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
                          <AlertDialogDescription>
                              Esta ação não pode ser desfeita. Isso irá apagar permanentemente todo o histórico de pagamentos de comissão.
                          </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleReset('resetFinancials')}>Sim, zerar financeiro</AlertDialogAction>
                      </AlertDialogFooter>
                  </AlertDialogContent>
              </AlertDialog>

               <AlertDialog open={dialogOpenFor === 'resetAll'} onOpenChange={(open) => !open && setDialogOpenFor(null)}>
                  <AlertDialogTrigger asChild>
                      <Button variant="destructive" onClick={() => setDialogOpenFor('resetAll')}>
                          <RotateCcw className="mr-2 h-4 w-4" /> Resetar Loja
                      </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                      <AlertDialogHeader>
                          <AlertDialogTitle>Você realmente quer resetar toda a loja?</AlertDialogTitle>
                          <AlertDialogDescription>
                              Esta ação é irreversível. Todos os produtos, pedidos, clientes e categorias serão apagados. A loja voltará ao estado inicial, como se tivesse acabado de ser instalada.
                          </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                           <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleReset('resetAll')}>Sim, resetar toda a loja</AlertDialogAction>
                      </AlertDialogFooter>
                  </AlertDialogContent>
              </AlertDialog>
          </CardContent>
       </Card>
        
        <AuditLogCard />
    </div>
  );
}
