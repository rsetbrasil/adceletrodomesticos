

'use client';

import React, { createContext, useContext, ReactNode, useCallback, useState, useEffect, useMemo, useRef } from 'react';
import type { Order, Product, Installment, CustomerInfo, Category, User, CommissionPayment, Payment, StockAudit, Avaria, ChatSession } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, doc, writeBatch, setDoc, updateDoc, deleteDoc, getDocs, query, orderBy, deleteField, limit, startAfter, documentId, type DocumentData, type Query, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useData } from './DataContext';
import { addMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from './AuthContext';
import { usePathname } from 'next/navigation';
import { products as sampleCatalogProducts } from '@/lib/products';

// Helper function to log actions, passed as an argument now
type LogAction = (action: string, details: string, user: User | null) => void;

// Moved from utils to avoid server-side execution
const calculateCommission = (order: Order, allProducts: Product[]) => {
      if (!order.sellerId) return 0;

      if (order.isCommissionManual && typeof order.commission === 'number') {
        return order.commission;
      }

      return order.items.reduce((totalCommission, item) => {
          const product = allProducts.find(p => p.id === item.id);
          if (!product || typeof product.commissionValue === 'undefined') return totalCommission;
          
          const commissionType = product.commissionType || 'percentage'; // Default to percentage

          if (commissionType === 'fixed') {
              return totalCommission + (product.commissionValue * item.quantity);
          }
          if (commissionType === 'percentage') {
              return totalCommission + (item.price * item.quantity * (product.commissionValue / 100));
          }
          return totalCommission;
      }, 0);
  };

const getCustomerKey = (customer: CustomerInfo) => {
  const normalizedCpf = customer.cpf?.replace(/\D/g, '');
  if (normalizedCpf) return normalizedCpf;
  if (customer.code) return customer.code;
  return `${customer.name}-${customer.phone}`;
};

const formatCustomerCode = (value: number) => {
  return `CLI-${String(value).padStart(5, '0')}`;
};

const getMaxCustomerCodeNumber = (orders: Order[]) => {
  let max = 0;
  orders.forEach(o => {
    const code = o.customer?.code;
    if (!code) return;
    const match = code.match(/^CLI-(\d{5})$/);
    if (!match) return;
    const num = Number(match[1]);
    if (!Number.isNaN(num) && num > max) {
      max = num;
    }
  });
  return max;
};

const normalizeProductCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  return digits ? digits : undefined;
};

const toIsoDateString = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'object') {
    const maybeToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof maybeToDate === 'function') return maybeToDate().toISOString();

    const maybeSeconds = (value as { seconds?: number }).seconds;
    if (typeof maybeSeconds === 'number') return new Date(maybeSeconds * 1000).toISOString();
  }
  return '';
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const removeUndefinedDeep = <T,>(value: T): T => {
  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
};

function recalculateInstallments(total: number, installmentsCount: number, orderId: string, firstDueDate: string): Installment[] {
    if (installmentsCount <= 0 || total < 0) return [];
    
    const totalInCents = Math.round(total * 100);
    const baseInstallmentValueInCents = Math.floor(totalInCents / installmentsCount);
    let remainderInCents = totalInCents % installmentsCount;

    const newInstallmentDetails: Installment[] = [];
    
    for (let i = 0; i < installmentsCount; i++) {
        let installmentValueCents = baseInstallmentValueInCents;
        if (remainderInCents > 0) {
            installmentValueCents++;
            remainderInCents--;
        }
        
        newInstallmentDetails.push({
            id: `inst-${orderId}-${i + 1}`,
            installmentNumber: i + 1,
            amount: installmentValueCents / 100,
            dueDate: addMonths(new Date(firstDueDate), i).toISOString(),
            status: 'Pendente',
            paidAmount: 0,
            payments: [],
        });
    }

    return newInstallmentDetails;
}


interface AdminContextType {
  addOrder: (order: Partial<Order> & { firstDueDate: Date }, logAction: LogAction, user: User | null) => Promise<Order | null>;
  deleteOrder: (orderId: string, logAction: LogAction, user: User | null) => Promise<void>;
  permanentlyDeleteOrder: (orderId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateOrderStatus: (orderId: string, status: Order['status'], logAction: LogAction, user: User | null) => Promise<void>;
  recordInstallmentPayment: (orderId: string, installmentNumber: number, payment: Omit<Payment, 'receivedBy'>, logAction: LogAction, user: User | null) => Promise<void>;
  reversePayment: (orderId: string, installmentNumber: number, paymentId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateInstallmentDueDate: (orderId: string, installmentNumber: number, newDueDate: Date, logAction: LogAction, user: User | null) => Promise<void>;
  updateInstallmentAmount: (orderId: string, installmentNumber: number, newAmount: number, logAction: LogAction, user: User | null) => Promise<void>;
  updateCustomer: (oldCustomer: CustomerInfo, updatedCustomerData: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  deleteCustomer: (customer: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  restoreCustomer: (customer: CustomerInfo, logAction: LogAction, user: User | null) => Promise<void>;
  importCustomers: (csvData: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateOrderDetails: (orderId: string, details: Partial<Order> & { downPayment?: number, resetDownPayment?: boolean }, logAction: LogAction, user: User | null) => Promise<void>;
  addProduct: (productData: Omit<Product, 'id' | 'data-ai-hint' | 'createdAt'>, logAction: LogAction, user: User | null) => Promise<void>;
  updateProduct: (product: Product, logAction: LogAction, user: User | null) => Promise<void>;
  deleteProduct: (productId: string, logAction: LogAction, user: User | null) => Promise<void>;
  addCategory: (categoryName: string, logAction: LogAction, user: User | null) => Promise<void>;
  deleteCategory: (categoryId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateCategoryName: (categoryId: string, newName: string, logAction: LogAction, user: User | null) => Promise<void>;
  addSubcategory: (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateSubcategory: (categoryId: string, oldSub: string, newSub: string, logAction: LogAction, user: User | null) => Promise<void>;
  deleteSubcategory: (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => Promise<void>;
  moveCategory: (categoryId: string, direction: 'up' | 'down', logAction: LogAction, user: User | null) => Promise<void>;
  reorderSubcategories: (categoryId: string, draggedSub: string, targetSub: string, logAction: LogAction, user: User | null) => Promise<void>;
  moveSubcategory: (sourceCategoryId: string, subName: string, targetCategoryId: string, logAction: LogAction, user: User | null) => Promise<void>;
  payCommissions: (sellerId: string, sellerName: string, amount: number, orderIds: string[], period: string, logAction: LogAction, user: User | null) => Promise<string | null>;
  reverseCommissionPayment: (paymentId: string, logAction: LogAction, user: User | null) => Promise<void>;
  restoreAdminData: (data: { products: Product[], orders: Order[], categories: Category[] }, logAction: LogAction, user: User | null) => Promise<void>;
  seedSampleCatalog: (logAction: LogAction, user: User | null) => Promise<void>;
  importCatalogData: (data: { products?: Product[]; categories?: Category[] }, logAction: LogAction, user: User | null) => Promise<void>;
  resetOrders: (logAction: LogAction, user: User | null) => Promise<void>;
  resetProducts: (logAction: LogAction, user: User | null) => Promise<void>;
  resetFinancials: (logAction: LogAction, user: User | null) => Promise<void>;
  resetAllAdminData: (logAction: LogAction, user: User | null) => Promise<void>;
  saveStockAudit: (audit: StockAudit, logAction: LogAction, user: User | null) => Promise<void>;
  addAvaria: (avariaData: Omit<Avaria, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>, logAction: LogAction, user: User | null) => Promise<void>;
  updateAvaria: (avariaId: string, avariaData: Partial<Omit<Avaria, 'id'>>, logAction: LogAction, user: User | null) => Promise<void>;
  deleteAvaria: (avariaId: string, logAction: LogAction, user: User | null) => Promise<void>;
  emptyTrash: (logAction: LogAction, user: User | null) => Promise<void>;
  deleteChatSession: (sessionId: string, logAction: LogAction, user: User | null) => Promise<void>;
  updateChatSession: (sessionId: string, data: Partial<ChatSession>, logAction: LogAction, user: User | null) => Promise<void>;
  // Admin Data states
  orders: Order[];
  commissionPayments: CommissionPayment[];
  stockAudits: StockAudit[];
  avarias: Avaria[];
  chatSessions: ChatSession[];
  customers: CustomerInfo[];
  customerOrders: { [key: string]: Order[] };
  customerFinancials: { [key: string]: { totalComprado: number, totalPago: number, saldoDevedor: number } };
  financialSummary: { totalVendido: number, totalRecebido: number, totalPendente: number, lucroBruto: number, monthlyData: { name: string, total: number }[] };
  commissionSummary: { totalPendingCommission: number, commissionsBySeller: { id: string; name: string; total: number; count: number; orderIds: string[] }[] };
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const { products, categories } = useData();
  const { toast } = useToast();
  const { user, users } = useAuth();
  const pathname = usePathname();
  const shouldLoadAllOrders =
    pathname.startsWith('/admin/pedidos') ||
    pathname.startsWith('/admin/clientes') ||
    pathname.startsWith('/admin/financeiro') ||
    pathname.startsWith('/admin/minhas-comissoes') ||
    pathname.startsWith('/admin/criar-pedido');
  const shouldComputeCustomers =
    pathname.startsWith('/admin/clientes') || pathname.startsWith('/admin/criar-pedido');
  const shouldComputeFinancialSummary = pathname.startsWith('/admin/financeiro');
  const shouldComputeCommissionSummary =
    pathname.startsWith('/admin/financeiro') || pathname.startsWith('/admin/minhas-comissoes');

  // Admin data states, now managed here
  const [orders, setOrders] = useState<Order[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<CommissionPayment[]>([]);
  const [stockAudits, setStockAudits] = useState<StockAudit[]>([]);
  const [avarias, setAvarias] = useState<Avaria[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const didMigrateCustomerCodesRef = useRef(false);
  const didMigrateProductCodesRef = useRef(false);
  const preferAllOrdersRef = useRef(false);

  // Effect for fetching admin-specific data
  useEffect(() => {
    const ORDERS_CACHE_KEY = 'admin.orders.cache.v1';
    const RECENT_ORDERS_LIMIT = 1000;
    let db: ReturnType<typeof getClientFirebase>['db'] | null = null;
    try {
      ({ db } = getClientFirebase());
    } catch (error) {
      return;
    }
    if (!db) return;

    const normalizeOrderAuditFields = (raw: any): Order => {
        const order = raw as Order;

        const createdAt = toIsoDateString(order.createdAt) || toIsoDateString(order.date) || new Date().toISOString();
        const date = toIsoDateString(order.date) || toIsoDateString(order.createdAt) || createdAt;
        const createdByName =
          order.createdByName ||
          (order.source === 'catalogo' ? (order.customer?.name || 'Cliente') : undefined) ||
          undefined;
        const createdById = order.createdById;

        return { ...order, createdAt, date, createdByName, createdById };
    };

    const getSortTime = (order: Order) => {
      const raw = (order.date || order.createdAt || '') as string;
      const t = Date.parse(raw);
      return Number.isFinite(t) ? t : 0;
    };

    const mergeRecentOrdersIntoAllOrders = (allOrders: Order[], recentOrders: Order[]) => {
      const byId = new Map<string, Order>();
      allOrders.forEach((o) => {
        if (o?.id) byId.set(o.id, o);
      });

      const next: Order[] = allOrders.slice();

      recentOrders.forEach((o) => {
        const id = o?.id;
        if (!id) return;

        if (byId.has(id)) {
          for (let i = 0; i < next.length; i++) {
            if (next[i]?.id === id) {
              next[i] = o;
              break;
            }
          }
        } else {
          next.unshift(o);
        }
      });

      return next.sort((a, b) => getSortTime(b) - getSortTime(a));
    };

    let seededOrders = false;
    try {
      const cachedRaw = window.localStorage.getItem(ORDERS_CACHE_KEY);
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw) as unknown;
        if (Array.isArray(parsed)) {
          const cachedOrders = parsed
            .slice(0, RECENT_ORDERS_LIMIT)
            .map((o) => normalizeOrderAuditFields(o))
            .filter((o) => !!o && typeof o.id === 'string' && o.id.trim().length > 0);
          if (cachedOrders.length > 0) setOrders(cachedOrders);
          if (cachedOrders.length > 0) seededOrders = true;
        }
      }
    } catch {
    }

    const setupCollectionFetch = (
      collectionName: string,
      setter: React.Dispatch<React.SetStateAction<any[]>>,
      orderField = 'createdAt',
      mapper?: (doc: any) => any,
    ) => {
      const q = query(collection(db, collectionName), orderBy(orderField, 'desc'), limit(2000));
      getDocs(q)
        .then((snapshot) => {
          setter(snapshot.docs.map((d) => (mapper ? mapper(d) : ({ ...d.data(), id: d.id }))));
        })
        .catch(() => {});
    };

    const recentQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(RECENT_ORDERS_LIMIT));
    getDocs(recentQuery)
      .then((snapshot) => {
        const nextOrders = snapshot.docs.map((d) => normalizeOrderAuditFields({ ...d.data(), id: d.id }));
        if (nextOrders.length === 0) return;
        if ((preferAllOrdersRef.current as boolean) && (window as any).__fullOrdersLoaded__) {
          setOrders((current) => mergeRecentOrdersIntoAllOrders(current, nextOrders));
        } else {
          setOrders(nextOrders);
        }
        try {
          window.localStorage.removeItem('admin.restore.inflight.v1');
        } catch {
        }
        try {
          const toCache = nextOrders.slice(0, RECENT_ORDERS_LIMIT);
          window.setTimeout(() => {
            try {
              window.localStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(toCache));
            } catch {
            }
          }, 0);
        } catch {
        }
      })
      .catch(() => {
        if (!seededOrders) {
          toast({ title: 'Conexão instável', description: 'Mostrando pedidos do cache recente.', variant: 'default' });
        }
      });

    setupCollectionFetch('commissionPayments', setCommissionPayments, 'paymentDate');
    setupCollectionFetch('stockAudits', setStockAudits);
    setupCollectionFetch('avarias', setAvarias);
    setupCollectionFetch('chatSessions', setChatSessions, 'lastMessageAt');
    
    return () => {};
  }, []);

  useEffect(() => {
    if (!shouldLoadAllOrders) return;

    let db: ReturnType<typeof getClientFirebase>['db'] | null = null;
    try {
      ({ db } = getClientFirebase());
    } catch {
      return;
    }
    if (!db) return;

    preferAllOrdersRef.current = true;
    (window as any).__fullOrdersLoaded__ = false;
    let cancelled = false;

    const normalizeOrderAuditFields = (raw: any): Order => {
      const order = raw as Order;

      const createdAt = toIsoDateString(order.createdAt) || toIsoDateString(order.date) || new Date().toISOString();
      const date = toIsoDateString(order.date) || toIsoDateString(order.createdAt) || createdAt;
      const createdByName =
        order.createdByName ||
        (order.source === 'catalogo' ? (order.customer?.name || 'Cliente') : undefined) ||
        undefined;
      const createdById = order.createdById;

      return { ...order, createdAt, date, createdByName, createdById };
    };

    const getSortTime = (order: Order) => {
      const raw = (order.date || order.createdAt || '') as string;
      const t = Date.parse(raw);
      return Number.isFinite(t) ? t : 0;
    };

    const loadAllOrders = async () => {
      const PAGE_SIZE = 500;
      let q: Query<DocumentData> = query(
        collection(db!, 'orders'),
        orderBy(documentId()),
        limit(PAGE_SIZE),
      );

      let allOrders: Order[] = [];
      let lastFlushAt = Date.now();

      while (!cancelled) {
        const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);
        if (cancelled) return;
        if (snapshot.empty) break;

        const pageOrders = snapshot.docs.map((d: QueryDocumentSnapshot<DocumentData>) =>
          normalizeOrderAuditFields({ ...d.data(), id: d.id }),
        );

        allOrders = allOrders.concat(pageOrders);

        const now = Date.now();
        if ((now - lastFlushAt) > 250) {
          lastFlushAt = now;
          setOrders(allOrders.slice().sort((a, b) => getSortTime(b) - getSortTime(a)));
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }

        if (snapshot.size < PAGE_SIZE) break;
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        q = query(
          collection(db!, 'orders'),
          orderBy(documentId()),
          startAfter(lastDoc.id),
          limit(PAGE_SIZE),
        );
      }

      if (cancelled) return;
      (window as any).__fullOrdersLoaded__ = true;
      setOrders(allOrders.slice().sort((a, b) => getSortTime(b) - getSortTime(a)));
    };

    loadAllOrders().catch(() => {
      if (cancelled) return;
      preferAllOrdersRef.current = false;
      (window as any).__fullOrdersLoaded__ = false;
      toast({
        title: 'Não foi possível carregar pedidos',
        description: 'Verifique sua conexão com o Firestore.',
        variant: 'destructive',
      });
    });

    return () => {
      preferAllOrdersRef.current = false;
      cancelled = true;
    };
  }, [shouldLoadAllOrders]);

  useEffect(() => {
    if (didMigrateCustomerCodesRef.current) return;
    if (!user) return;
    if (user.role !== 'admin' && user.role !== 'gerente') return;
    if (orders.length === 0) return;

    const migrationStateKey = 'admin.migrations.customerCodes.v1.state';
    const migrationOffsetKey = 'admin.migrations.customerCodes.v1.offset';
    const migrationLockKey = 'admin.migrations.customerCodes.v1.lock';
    const migrationResumeAtKey = 'admin.migrations.customerCodes.v1.resumeAt';
    const lockToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const lockTtlMs = 5 * 60 * 1000;
    try {
      if (window.localStorage.getItem(migrationStateKey) === 'done') return;
    } catch {
      return;
    }
    try {
      const resumeAtRaw = window.localStorage.getItem(migrationResumeAtKey);
      const resumeAt = resumeAtRaw ? Number(resumeAtRaw) : 0;
      if (Number.isFinite(resumeAt) && resumeAt > Date.now()) return;
    } catch {
      return;
    }

    const groups = new Map<string, { missingOrderIds: string[]; existingCode?: string }>();
    orders.forEach(o => {
      const key = o.customer?.cpf ? o.customer.cpf.replace(/\D/g, '') : `${o.customer.name}-${o.customer.phone}`;
      if (!key) return;
      const current = groups.get(key) || { missingOrderIds: [] };
      if (!current.existingCode && o.customer?.code) {
        current.existingCode = o.customer.code;
      }
      if (!o.customer?.code) {
        current.missingOrderIds.push(o.id);
      }
      groups.set(key, current);
    });

    const groupsNeedingCode = Array.from(groups.values()).some(g => g.missingOrderIds.length > 0);
    if (!groupsNeedingCode) return;

    const { db } = getClientFirebase();
    let nextNumber = getMaxCustomerCodeNumber(orders) + 1;

    const updates: Array<{ orderId: string; code: string }> = [];
    groups.forEach((group) => {
      if (group.missingOrderIds.length === 0) return;
      const code = group.existingCode || formatCustomerCode(nextNumber++);
      group.missingOrderIds.forEach(orderId => updates.push({ orderId, code }));
    });

    updates.sort((a, b) => a.orderId.localeCompare(b.orderId));

    const getOffset = () => {
      try {
        const raw = window.localStorage.getItem(migrationOffsetKey);
        const n = raw ? Number(raw) : 0;
        return Number.isFinite(n) && n > 0 ? n : 0;
      } catch {
        return 0;
      }
    };

    const setOffset = (value: number) => {
      try {
        window.localStorage.setItem(migrationOffsetKey, String(value));
      } catch {
      }
    };

    const setState = (value: string) => {
      try {
        window.localStorage.setItem(migrationStateKey, value);
      } catch {
      }
    };

    const setResumeAt = (value: number) => {
      try {
        window.localStorage.setItem(migrationResumeAtKey, String(value));
      } catch {
      }
    };

    const acquireLock = () => {
      try {
        const raw = window.localStorage.getItem(migrationLockKey);
        if (raw) {
          const [tsRaw] = raw.split('|');
          const ts = tsRaw ? Number(tsRaw) : 0;
          if (Number.isFinite(ts) && (Date.now() - ts) < lockTtlMs) return false;
        }
        window.localStorage.setItem(migrationLockKey, `${Date.now()}|${lockToken}`);
        return window.localStorage.getItem(migrationLockKey)?.includes(lockToken) ?? false;
      } catch {
        return false;
      }
    };

    if (!acquireLock()) return;
    didMigrateCustomerCodesRef.current = true;
    let cancelled = false;

    const clearLock = () => {
      try {
        const raw = window.localStorage.getItem(migrationLockKey);
        if (raw && raw.includes(lockToken)) window.localStorage.removeItem(migrationLockKey);
      } catch {
      }
    };

    const commitChunks = async () => {
      setState('running');
      const offset = getOffset();
      const maxPerRun = 50;
      const slice = updates.slice(offset, offset + maxPerRun);
      if (slice.length === 0) {
        setState('done');
        setResumeAt(0);
        clearLock();
        return;
      }

      const chunkSize = 50;
      for (let i = 0; i < slice.length; i += chunkSize) {
        if (cancelled) {
          setState('paused');
          setResumeAt(Date.now() + 15_000);
          clearLock();
          return;
        }
        const chunk = slice.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach(({ orderId, code }) => {
          batch.update(doc(db, 'orders', orderId), { 'customer.code': code });
        });
        try {
          await batch.commit();
          await sleep(600);
        } catch (error) {
          setState('paused');
          try {
            const code = (error as { code?: unknown } | null)?.code;
            if (code === 'resource-exhausted') {
              setResumeAt(Date.now() + 2 * 60 * 1000);
            } else {
              setResumeAt(Date.now() + 30_000);
            }
          } catch {
          }
          clearLock();
          return;
        }
      }
      const nextOffset = offset + slice.length;
      setOffset(nextOffset);
      if (nextOffset >= updates.length) {
        setState('done');
        setResumeAt(0);
      } else {
        setState('paused');
        setResumeAt(Date.now() + 15_000);
      }
      clearLock();
    };

    commitChunks();
    return () => {
      cancelled = true;
    };
  }, [orders, user]);

  useEffect(() => {
    if (didMigrateProductCodesRef.current) return;
    if (!user) return;
    if (user.role !== 'admin' && user.role !== 'gerente') return;
    if (products.length === 0) return;

    const updates: Array<{ productId: string; code: string }> = [];
    products.forEach((p) => {
      const normalized = normalizeProductCode(p.code);
      if (!normalized) return;
      if (p.code !== normalized) updates.push({ productId: p.id, code: normalized });
    });

    if (updates.length === 0) return;

    let db: ReturnType<typeof getClientFirebase>['db'] | null = null;
    try {
      ({ db } = getClientFirebase());
    } catch {
      return;
    }
    if (!db) return;

    const migrationStateKey = 'admin.migrations.productCodes.v1.state';
    const migrationOffsetKey = 'admin.migrations.productCodes.v1.offset';
    const migrationLockKey = 'admin.migrations.productCodes.v1.lock';
    const migrationResumeAtKey = 'admin.migrations.productCodes.v1.resumeAt';
    const lockToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const lockTtlMs = 5 * 60 * 1000;
    try {
      if (window.localStorage.getItem(migrationStateKey) === 'done') return;
    } catch {
      return;
    }
    try {
      const resumeAtRaw = window.localStorage.getItem(migrationResumeAtKey);
      const resumeAt = resumeAtRaw ? Number(resumeAtRaw) : 0;
      if (Number.isFinite(resumeAt) && resumeAt > Date.now()) return;
    } catch {
      return;
    }

    updates.sort((a, b) => a.productId.localeCompare(b.productId));

    const getOffset = () => {
      try {
        const raw = window.localStorage.getItem(migrationOffsetKey);
        const n = raw ? Number(raw) : 0;
        return Number.isFinite(n) && n > 0 ? n : 0;
      } catch {
        return 0;
      }
    };

    const setOffset = (value: number) => {
      try {
        window.localStorage.setItem(migrationOffsetKey, String(value));
      } catch {
      }
    };

    const setState = (value: string) => {
      try {
        window.localStorage.setItem(migrationStateKey, value);
      } catch {
      }
    };

    const setResumeAt = (value: number) => {
      try {
        window.localStorage.setItem(migrationResumeAtKey, String(value));
      } catch {
      }
    };

    const acquireLock = () => {
      try {
        const raw = window.localStorage.getItem(migrationLockKey);
        if (raw) {
          const [tsRaw] = raw.split('|');
          const ts = tsRaw ? Number(tsRaw) : 0;
          if (Number.isFinite(ts) && (Date.now() - ts) < lockTtlMs) return false;
        }
        window.localStorage.setItem(migrationLockKey, `${Date.now()}|${lockToken}`);
        return window.localStorage.getItem(migrationLockKey)?.includes(lockToken) ?? false;
      } catch {
        return false;
      }
    };

    if (!acquireLock()) return;
    didMigrateProductCodesRef.current = true;
    let cancelled = false;

    const clearLock = () => {
      try {
        const raw = window.localStorage.getItem(migrationLockKey);
        if (raw && raw.includes(lockToken)) window.localStorage.removeItem(migrationLockKey);
      } catch {
      }
    };

    const commitChunks = async () => {
      setState('running');
      const offset = getOffset();
      const maxPerRun = 50;
      const slice = updates.slice(offset, offset + maxPerRun);
      if (slice.length === 0) {
        setState('done');
        setResumeAt(0);
        clearLock();
        return;
      }

      const chunkSize = 50;
      for (let i = 0; i < slice.length; i += chunkSize) {
        if (cancelled) {
          setState('paused');
          setResumeAt(Date.now() + 15_000);
          clearLock();
          return;
        }
        const chunk = slice.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach(({ productId, code }) => {
          batch.update(doc(db, 'products', productId), { code });
        });
        try {
          await batch.commit();
          await sleep(600);
        } catch (error) {
          setState('paused');
          try {
            const code = (error as { code?: unknown } | null)?.code;
            if (code === 'resource-exhausted') {
              setResumeAt(Date.now() + 2 * 60 * 1000);
            } else {
              setResumeAt(Date.now() + 30_000);
            }
          } catch {
          }
          clearLock();
          return;
        }
      }
      const nextOffset = offset + slice.length;
      setOffset(nextOffset);
      if (nextOffset >= updates.length) {
        setState('done');
        setResumeAt(0);
      } else {
        setState('paused');
        setResumeAt(Date.now() + 15_000);
      }
      clearLock();
    };

    commitChunks();
    return () => {
      cancelled = true;
    };
  }, [products, user]);

  // Memos for derived data, now living in AdminContext
  const customers = useMemo(() => {
    if (!shouldComputeCustomers) return [];
    const customerMap = new Map<string, CustomerInfo>();
    const sortedOrders = [...orders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    sortedOrders.forEach(order => {
        const customerKey = getCustomerKey(order.customer);
        if (customerKey && !customerMap.has(customerKey)) {
            customerMap.set(customerKey, order.customer);
        }
    });

    return Array.from(customerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, shouldComputeCustomers]);
  
  const customerOrders = useMemo(() => {
    if (!shouldComputeCustomers) return {};
    const ordersByCustomer: { [key: string]: Order[] } = {};
    orders.forEach(order => {
      if (order.status !== 'Cancelado' && order.status !== 'Excluído') {
        const customerKey = getCustomerKey(order.customer);
        if (!ordersByCustomer[customerKey]) {
          ordersByCustomer[customerKey] = [];
        }
        ordersByCustomer[customerKey].push(order);
      }
    });
    for(const key in ordersByCustomer) {
        ordersByCustomer[key].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return ordersByCustomer;
  }, [orders, shouldComputeCustomers]);

  const customerFinancials = useMemo(() => {
      if (!shouldComputeCustomers) return {};
      const financialsByCustomer: { [key: string]: { totalComprado: number, totalPago: number, saldoDevedor: number } } = {};
      customers.forEach(customer => {
        const customerKey = getCustomerKey(customer);
        const ordersForCustomer = customerOrders[customerKey] || [];
        const allInstallments = ordersForCustomer.flatMap(order => order.installmentDetails || []);
        const totalComprado = ordersForCustomer.reduce((acc, order) => acc + order.total, 0);
        const totalPago = allInstallments.reduce((sum, inst) => sum + (inst.paidAmount || 0), 0);
        const saldoDevedor = totalComprado - totalPago;
        financialsByCustomer[customerKey] = { totalComprado, totalPago, saldoDevedor };
      });
      return financialsByCustomer;
  }, [customers, customerOrders, shouldComputeCustomers]);

  const financialSummary = useMemo(() => {
    if (!shouldComputeFinancialSummary) {
      return {
        totalVendido: 0,
        totalRecebido: 0,
        totalPendente: 0,
        lucroBruto: 0,
        monthlyData: [],
      };
    }

    let totalVendido = 0;
    let totalRecebido = 0;
    let totalPendente = 0;
    let lucroBruto = 0;
    const monthlySales: { [key: string]: number } = {};
    const productById = new Map(products.map(p => [p.id, p] as const));

    orders.forEach(order => {
      if (order.status !== 'Cancelado' && order.status !== 'Excluído') {
        totalVendido += order.total;

        order.items.forEach(item => {
            const product = productById.get(item.id);
            const cost = product?.cost || 0;
            const itemRevenue = item.price * item.quantity;
            const itemCost = cost * item.quantity;
            lucroBruto += (itemRevenue - itemCost);
        });

        const monthKey = format(parseISO(order.date), 'MMM/yy', { locale: ptBR });
        if (!monthlySales[monthKey]) {
          monthlySales[monthKey] = 0;
        }
        monthlySales[monthKey] += order.total;

        if (order.paymentMethod === 'Crediário') {
            (order.installmentDetails || []).forEach(inst => {
            if (inst.status === 'Pago') {
                totalRecebido += inst.paidAmount || inst.amount;
            } else {
                totalRecebido += inst.paidAmount || 0;
                totalPendente += inst.amount - (inst.paidAmount || 0);
            }
            });
        } else {
            totalRecebido += order.total;
        }
      }
    });
    
    const monthlyData = Object.entries(monthlySales).map(([name, total]) => ({ name, total })).reverse();

    return { totalVendido, totalRecebido, totalPendente, lucroBruto, monthlyData };
  }, [orders, products, shouldComputeFinancialSummary]);
  
  const commissionSummary = useMemo(() => {
    if (!shouldComputeCommissionSummary) {
      return { totalPendingCommission: 0, commissionsBySeller: [] };
    }

    const sellerCommissions = new Map<string, { name: string; total: number; count: number; orderIds: string[] }>();

    orders.forEach(order => {
        if (order.status === 'Entregue' && order.sellerId && typeof order.commission === 'number' && order.commission > 0 && !order.commissionPaid) {
            const sellerId = order.sellerId;
            const sellerName = order.sellerName || users.find(u => u.id === sellerId)?.name || 'Vendedor Desconhecido';
            
            const current = sellerCommissions.get(sellerId) || { name: sellerName, total: 0, count: 0, orderIds: [] };
            current.total += order.commission;
            current.count += 1;
            current.orderIds.push(order.id);
            sellerCommissions.set(sellerId, current);
        }
    });

    const commissionsBySeller = Array.from(sellerCommissions.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a,b) => b.total - a.total);

    const totalPendingCommission = commissionsBySeller.reduce((acc, seller) => acc + seller.total, 0);

    return { totalPendingCommission, commissionsBySeller };
  }, [orders, users, shouldComputeCommissionSummary]);
  
  const restoreAdminData = useCallback(async (data: { products: Product[], orders: Order[], categories: Category[] }, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
      toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem restaurar backup.', variant: 'destructive' });
      throw new Error('Permission denied');
    }

    const sanitizeDocId = (value: unknown, fallback: string) => {
      if (typeof value !== 'string') return fallback;
      const trimmed = value.trim();
      if (!trimmed) return fallback;
      const safe = trimmed.replace(/[\/\\?#\[\]]/g, '-');
      return safe || fallback;
    };

    const normalizeString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
    const normalizeOrderAuditFields = (raw: any): Order => {
      const order = raw as Order;

      const createdAt = toIsoDateString(order.createdAt) || toIsoDateString(order.date) || new Date().toISOString();
      const date = toIsoDateString(order.date) || toIsoDateString(order.createdAt) || createdAt;
      const createdByName =
        order.createdByName ||
        (order.source === 'catalogo' ? (order.customer?.name || 'Cliente') : undefined) ||
        undefined;
      const createdById = order.createdById;

      return { ...order, createdAt, date, createdByName, createdById };
    };

    const normalizeProductIds = (productsToNormalize: Product[]) => {
      const idMap = new Map<string, string>();
      const normalized = productsToNormalize.map((p, index) => {
        const rawId = normalizeString((p as any)?.id, `prod-backup-${Date.now()}-${index}`);
        const safeId = sanitizeDocId(rawId, `prod-backup-${Date.now()}-${index}`);
        if (rawId !== safeId) idMap.set(rawId, safeId);
        return { ...p, id: safeId } as Product;
      });
      return { normalized, idMap };
    };

    const normalizeCategoryIds = (categoriesToNormalize: Category[]) => {
      const idMap = new Map<string, string>();
      const normalized = categoriesToNormalize.map((c, index) => {
        const rawId = normalizeString((c as any)?.id, `cat-backup-${Date.now()}-${index}`);
        const safeId = sanitizeDocId(rawId, `cat-backup-${Date.now()}-${index}`);
        if (rawId !== safeId) idMap.set(rawId, safeId);
        return { ...c, id: safeId } as Category;
      });
      return { normalized, idMap };
    };

    const normalizeOrderIdsAndItems = (ordersToNormalize: Order[], productIdMap: Map<string, string>) => {
      const idMap = new Map<string, string>();
      const normalized = ordersToNormalize.map((o, index) => {
        const rawId = normalizeString((o as any)?.id, `order-backup-${Date.now()}-${index}`);
        const safeId = sanitizeDocId(rawId, `order-backup-${Date.now()}-${index}`);
        if (rawId !== safeId) idMap.set(rawId, safeId);

        const rawItems = Array.isArray((o as any)?.items) ? (o as any).items : [];
        const items = rawItems.map((item: any) => {
          const rawProductId = normalizeString(item?.id, '');
          const nextProductId = productIdMap.get(rawProductId) ?? rawProductId;
          return { ...item, id: nextProductId };
        });

        return { ...o, id: safeId, items } as Order;
      });
      return { normalized, idMap };
    };

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
        last = snap.docs[snap.docs.length - 1];
      }
    };

    try {
      const incomingProducts = Array.isArray(data.products) ? data.products : [];
      const incomingOrders = Array.isArray(data.orders) ? data.orders : [];
      const incomingCategories = Array.isArray(data.categories) ? data.categories : [];

      const { normalized: categoriesNormalized } = normalizeCategoryIds(incomingCategories);
      const { normalized: productsNormalized, idMap: productIdMap } = normalizeProductIds(incomingProducts);
      const { normalized: ordersNormalizedRaw } = normalizeOrderIdsAndItems(incomingOrders, productIdMap);
      const ordersNormalized = ordersNormalizedRaw.map((o) => normalizeOrderAuditFields(o));

      await deleteAllDocs('products');
      await deleteAllDocs('orders');
      await deleteAllDocs('categories');

      let batch = writeBatch(db);
      let ops = 0;

      const commitIfNeeded = async (force = false) => {
        if (!force && ops < 450) return;
        if (ops === 0) return;
        await commitWithRetry(batch, 'write');
        batch = writeBatch(db);
        ops = 0;
      };

      for (const p of productsNormalized) {
        batch.set(doc(db, 'products', p.id), removeUndefinedDeep(p));
        ops++;
        await commitIfNeeded(false);
      }
      for (const o of ordersNormalized) {
        batch.set(doc(db, 'orders', o.id), removeUndefinedDeep(o));
        ops++;
        await commitIfNeeded(false);
      }
      for (const c of categoriesNormalized) {
        batch.set(doc(db, 'categories', c.id), removeUndefinedDeep(c));
        ops++;
        await commitIfNeeded(false);
      }

      await commitIfNeeded(true);

      const getSortTime = (order: Order) => {
        const raw = (order.date || order.createdAt || '') as string;
        const t = Date.parse(raw);
        return Number.isFinite(t) ? t : 0;
      };
      const nextOrders = ordersNormalized.slice().sort((a, b) => getSortTime(b) - getSortTime(a));
      setOrders(nextOrders);
      (window as any).__fullOrdersLoaded__ = true;
      try {
        const ORDERS_CACHE_KEY = 'admin.orders.cache.v1';
        const RECENT_ORDERS_LIMIT = 1000;
        window.localStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(nextOrders.slice(0, RECENT_ORDERS_LIMIT)));
      } catch {
      }

      logAction(
        'Restauração de Backup',
        `Backup restaurado: ${productsNormalized.length} produtos, ${ordersNormalized.length} pedidos, ${categoriesNormalized.length} categorias.`,
        user,
      );
      const warnings = productIdMap.size > 0 ? ` (${productIdMap.size} IDs de produtos ajustados)` : '';
      toast({ title: 'Dados restaurados com sucesso!', description: `Produtos: ${productsNormalized.length}, Pedidos: ${ordersNormalized.length}, Categorias: ${categoriesNormalized.length}${warnings}` });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const message = error instanceof Error ? error.message : 'Falha ao restaurar backup';
      if (code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'multiple', operation: 'write' }));
      }
      toast({ title: 'Erro ao restaurar backup', description: message, variant: 'destructive' });
      throw error instanceof Error ? error : new Error(message);
    }
  }, [toast, setOrders]);

  const seedSampleCatalog = useCallback(async (logAction: LogAction, user: User | null) => {
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
      toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem criar o catálogo.', variant: 'destructive' });
      return;
    }

    const { db } = getClientFirebase();
    const [existingProductsSnap, existingCategoriesSnap] = await Promise.all([
      getDocs(query(collection(db, 'products'), limit(1))),
      getDocs(query(collection(db, 'categories'), limit(1))),
    ]);

    if (!existingProductsSnap.empty || !existingCategoriesSnap.empty) {
      toast({
        title: 'Catálogo já existe',
        description: 'Para usar o catálogo de exemplo, o Firestore precisa estar vazio.',
        variant: 'destructive',
      });
      return;
    }

    const toIdPart = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

    const categoriesByName = new Map<string, Set<string>>();
    sampleCatalogProducts.forEach((product) => {
      const categoryName = product.category?.trim() || 'Sem categoria';
      const sub = product.subcategory?.trim();
      if (!categoriesByName.has(categoryName)) categoriesByName.set(categoryName, new Set());
      if (sub) categoriesByName.get(categoryName)!.add(sub);
    });

    const sortedCategoryNames = Array.from(categoriesByName.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const categoriesToWrite: Category[] = sortedCategoryNames.map((name, index) => {
      const id = `cat-sample-${toIdPart(name) || String(index)}`;
      const subs = Array.from(categoriesByName.get(name) || []).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      return { id, name, order: index, subcategories: subs } satisfies Category;
    });

    const productsToWrite: Product[] = sampleCatalogProducts.map((p) => {
      const id = `prod-sample-${String(p.id).replace(/[^a-zA-Z0-9_-]/g, '') || String(Date.now())}`;
      const createdAt = typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : new Date().toISOString();
      return {
        ...p,
        id,
        category: p.category?.trim() || 'Sem categoria',
        subcategory: p.subcategory?.trim() || undefined,
        imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
        createdAt,
      } satisfies Product;
    });

    let batch = writeBatch(db);
    let ops = 0;

    const commitIfNeeded = async (force = false) => {
      if (!force && ops < 450) return;
      if (ops === 0) return;
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    };

    for (const c of categoriesToWrite) {
      batch.set(doc(db, 'categories', c.id), c);
      ops++;
      await commitIfNeeded(false);
    }

    for (const p of productsToWrite) {
      batch.set(doc(db, 'products', p.id), p);
      ops++;
      await commitIfNeeded(false);
    }

    await commitIfNeeded(true);

    logAction(
      'Seed do Catálogo',
      `Catálogo de exemplo criado com ${productsToWrite.length} produtos e ${categoriesToWrite.length} categorias.`,
      user,
    );
    toast({ title: 'Catálogo criado!', description: 'Produtos e categorias foram inseridos no Firestore.' });
  }, [toast]);

  const importCatalogData = useCallback(async (data: { products?: Product[]; categories?: Category[] }, logAction: LogAction, user: User | null) => {
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
      toast({ title: 'Acesso negado', description: 'Apenas admin e gerente podem importar o catálogo.', variant: 'destructive' });
      return;
    }

    const incomingProducts = Array.isArray(data.products) ? data.products : [];
    const incomingCategories = Array.isArray(data.categories) ? data.categories : [];

    if (incomingProducts.length === 0 && incomingCategories.length === 0) {
      toast({ title: 'Arquivo inválido', description: 'Nenhum produto ou categoria encontrado.', variant: 'destructive' });
      return;
    }

    const { db } = getClientFirebase();

    const normalizeId = (value: unknown, fallback: string) => {
      if (typeof value !== 'string') return fallback;
      const trimmed = value.trim();
      if (!trimmed) return fallback;
      const safe = trimmed.replace(/[\/\\?#\[\]]/g, '-');
      return safe || fallback;
    };

    const normalizeNumber = (value: unknown, fallback: number) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value.replace(',', '.'));
        if (Number.isFinite(parsed)) return parsed;
      }
      return fallback;
    };

    const normalizeString = (value: unknown, fallback = '') => {
      if (typeof value !== 'string') return fallback;
      return value;
    };

    const normalizeStringArray = (value: unknown) => {
      if (!Array.isArray(value)) return [];
      return value.filter((v) => typeof v === 'string').map((v) => v);
    };

    const normalizedCategories: Category[] = incomingCategories.map((raw, index) => {
      const base = raw as Partial<Category>;
      const name = normalizeString(base.name, '').trim();
      const subcategories = normalizeStringArray(base.subcategories).map((s) => s.trim()).filter(Boolean);
      const id = normalizeId(base.id, `cat-import-${Date.now()}-${index}`);
      const order = typeof base.order === 'number' && Number.isFinite(base.order) ? base.order : index;
      return {
        id,
        name: name || `Categoria ${index + 1}`,
        order,
        subcategories,
      } satisfies Category;
    });

    const normalizedProducts: Product[] = incomingProducts.map((raw, index) => {
      const base = raw as Partial<Product>;
      const id = normalizeId(base.id, `prod-import-${Date.now()}-${index}`);
      const category = normalizeString(base.category, '').trim() || 'Sem categoria';
      const subcategory = normalizeString(base.subcategory, '').trim() || undefined;

      return {
        id,
        code: typeof base.code === 'string' ? base.code : undefined,
        name: normalizeString(base.name, '').trim() || `Produto ${index + 1}`,
        description: normalizeString(base.description, ''),
        longDescription: normalizeString(base.longDescription, ''),
        price: normalizeNumber(base.price, 0),
        cost: typeof base.cost === 'number' && Number.isFinite(base.cost) ? base.cost : undefined,
        onSale: typeof base.onSale === 'boolean' ? base.onSale : undefined,
        promotionEndDate: typeof base.promotionEndDate === 'string' ? base.promotionEndDate : undefined,
        isHidden: typeof base.isHidden === 'boolean' ? base.isHidden : undefined,
        category,
        subcategory,
        stock: Math.max(0, Math.floor(normalizeNumber(base.stock, 0))),
        imageUrls: normalizeStringArray(base.imageUrls),
        maxInstallments: typeof base.maxInstallments === 'number' && Number.isFinite(base.maxInstallments) ? base.maxInstallments : undefined,
        paymentCondition: typeof base.paymentCondition === 'string' ? base.paymentCondition : undefined,
        commissionType: base.commissionType === 'fixed' || base.commissionType === 'percentage' ? base.commissionType : undefined,
        commissionValue: typeof base.commissionValue === 'number' && Number.isFinite(base.commissionValue) ? base.commissionValue : undefined,
        "data-ai-hint": typeof (base as any)["data-ai-hint"] === 'string' ? (base as any)["data-ai-hint"] : undefined,
        createdAt: typeof base.createdAt === 'string' && base.createdAt ? base.createdAt : new Date().toISOString(),
      } satisfies Product;
    });

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
        await batch.commit();
        last = snap.docs[snap.docs.length - 1];
      }
    };

    if (incomingProducts.length > 0) {
      await deleteAllDocs('products');
    }
    if (incomingCategories.length > 0) {
      await deleteAllDocs('categories');
    }

    let batch = writeBatch(db);
    let ops = 0;

    const commitIfNeeded = async (force = false) => {
      if (!force && ops < 450) return;
      if (ops === 0) return;
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    };

    for (const c of normalizedCategories) {
      batch.set(doc(db, 'categories', c.id), c);
      ops++;
      await commitIfNeeded(false);
    }

    for (const p of normalizedProducts) {
      batch.set(doc(db, 'products', p.id), p);
      ops++;
      await commitIfNeeded(false);
    }

    await commitIfNeeded(true);

    logAction(
      'Importação de Catálogo',
      `Catálogo importado: ${normalizedProducts.length} produtos, ${normalizedCategories.length} categorias.`,
      user,
    );
    toast({ title: 'Importação concluída!', description: 'Produtos e categorias foram importados.' });
  }, [toast]);

  const resetOrders = useCallback(async (logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const batch = writeBatch(db);
    // Only delete orders that are NOT registration-only orders
    orders.forEach(o => {
        if (o.items.length > 0) {
            batch.delete(doc(db, 'orders', o.id));
        }
    });
    
    batch.commit().then(() => {
        logAction('Reset de Pedidos', 'Todos os pedidos de compra foram zerados.', user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'orders', operation: 'delete' }));
    });
  }, [orders]);

  const resetProducts = useCallback(async (logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const batch = writeBatch(db);
    products.forEach(p => batch.delete(doc(db, 'products', p.id)));
    
    batch.commit().then(() => {
        logAction('Reset de Produtos', 'Todos os produtos foram zerados.', user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'products', operation: 'delete' }));
    });
  }, [products]);

  const resetFinancials = useCallback(async (logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const batch = writeBatch(db);
    commissionPayments.forEach(p => batch.delete(doc(db, 'commissionPayments', p.id)));
    
    batch.commit().then(() => {
        logAction('Reset Financeiro', 'Todos os pagamentos de comissão foram zerados.', user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: 'commissionPayments', operation: 'delete' }));
    });
  }, [commissionPayments]);
  
  const resetAllAdminData = useCallback(async (logAction: LogAction, user: User | null) => {
    await restoreAdminData({ products: [], orders: [], categories: [] }, logAction, user);
    await resetFinancials(logAction, user);
    logAction('Reset da Loja', 'Todos os dados da loja foram resetados para o padrão.', user);
  }, [restoreAdminData, resetFinancials]);

  const addProduct = useCallback(async (productData: Omit<Product, 'id' | 'data-ai-hint' | 'createdAt'>, logAction: LogAction, user: User | null) => {
      const { db } = getClientFirebase();
      const newProductId = `prod-${Date.now()}`;
      
      const existingCodes = products
        .map(p => normalizeProductCode(p.code))
        .map(code => (code ? Number(code) : NaN))
        .filter(num => Number.isFinite(num));
        
      const lastCodeNumber = existingCodes.length > 0 ? Math.max(...existingCodes) : 99;
      const newProductCode = String(lastCodeNumber + 1);
      
      const newProduct: Partial<Product> = {
        ...productData,
        id: newProductId,
        code: newProductCode,
        createdAt: new Date().toISOString(),
        'data-ai-hint': productData.name.toLowerCase().split(' ').slice(0, 2).join(' '),
      };

      if (!newProduct.promotionEndDate) {
        delete newProduct.promotionEndDate;
      }
      
      const productRef = doc(db, 'products', newProductId);
      setDoc(productRef, newProduct).then(() => {
        logAction('Criação de Produto', `Produto "${newProduct.name}" (ID: ${newProductId}) foi criado.`, user);
        toast({
            title: "Produto Cadastrado!",
            description: `O produto "${newProduct.name}" foi adicionado ao catálogo.`,
        });
      }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: productRef.path,
            operation: 'create',
            requestResourceData: newProduct,
        }));
      });
  }, [toast, products]);

  const updateProduct = useCallback(async (updatedProduct: Product, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const productRef = doc(db, 'products', updatedProduct.id);
    const productToUpdate: Partial<Product> = { ...updatedProduct };
    
    if (!productToUpdate.promotionEndDate) {
        delete productToUpdate.promotionEndDate;
    }

    const normalizedCode = normalizeProductCode(productToUpdate.code);
    if (normalizedCode) {
      productToUpdate.code = normalizedCode;
    } else if (productToUpdate.code != null) {
      productToUpdate.code = deleteField() as unknown as string;
    }
    
    setDoc(productRef, productToUpdate, { merge: true }).then(() => {
        logAction('Atualização de Produto', `Produto "${updatedProduct.name}" (ID: ${updatedProduct.id}) foi atualizado.`, user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: productRef.path,
            operation: 'update',
            requestResourceData: productToUpdate,
        }));
    });
  }, []);

  const deleteProduct = useCallback(async (productId: string, logAction: LogAction, user: User | null) => {
      const { db } = getClientFirebase();
      const productRef = doc(db, 'products', productId);
      const productToDelete = products.find(p => p.id === productId);

      deleteDoc(productRef).then(() => {
        if (productToDelete) {
          logAction('Exclusão de Produto', `Produto "${productToDelete.name}" (ID: ${productId}) foi excluído.`, user);
        }
        toast({
            title: 'Produto Excluído!',
            description: 'O produto foi removido do catálogo.',
            variant: 'destructive',
            duration: 5000,
        });
      }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: productRef.path,
            operation: 'delete',
        }));
      });
  }, [products, toast]);

  const addCategory = useCallback(async (categoryName: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    if (categories.some(c => c.name.toLowerCase() === categoryName.toLowerCase())) {
      toast({ title: "Erro", description: "Essa categoria já existe.", variant: "destructive" });
      return;
    }
    const newCategoryId = `cat-${Date.now()}`;
    const newOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order)) + 1 : 0;
    const newCategory: Category = {
      id: newCategoryId,
      name: categoryName,
      order: newOrder,
      subcategories: []
    };
    
    const categoryRef = doc(db, 'categories', newCategoryId);
    setDoc(categoryRef, newCategory).then(() => {
        logAction('Criação de Categoria', `Categoria "${categoryName}" foi criada.`, user);
        toast({ title: "Categoria Adicionada!" });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: categoryRef.path,
            operation: 'create',
            requestResourceData: newCategory,
        }));
    });
  }, [categories, toast]);

  const updateCategoryName = useCallback(async (categoryId: string, newName: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    if (categories.some(c => c.name.toLowerCase() === newName.toLowerCase() && c.id !== categoryId)) {
        toast({ title: "Erro", description: "Uma categoria com esse novo nome já existe.", variant: "destructive" });
        return;
    }
    const oldCategory = categories.find(c => c.id === categoryId);
    if (!oldCategory) return;
    const oldName = oldCategory.name;

    const batch = writeBatch(db);
    const categoryRef = doc(db, 'categories', categoryId);
    batch.update(categoryRef, { name: newName });
    
    products.forEach(p => {
        if (p.category.toLowerCase() === oldName.toLowerCase()) {
            const productRef = doc(db, 'products', p.id);
            batch.update(productRef, { category: newName });
        }
    });

    batch.commit().then(() => {
        logAction('Atualização de Categoria', `Categoria "${oldName}" foi renomeada para "${newName}".`, user);
        toast({ title: "Categoria Renomeada!" });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `categories/${categoryId}`,
            operation: 'update',
            requestResourceData: { name: newName },
        }));
    });
  }, [categories, products, toast]);

  const deleteCategory = useCallback(async (categoryId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const categoryToDelete = categories.find(c => c.id === categoryId);
    if (!categoryToDelete) return;

    const productsInCategory = products.some(p => p.category === categoryToDelete.name);

    if (productsInCategory) {
        toast({ title: "Erro", description: "Não é possível excluir categorias que contêm produtos.", variant: "destructive" });
        return;
    }
    const categoryRef = doc(db, 'categories', categoryId);
    deleteDoc(categoryRef).then(() => {
        logAction('Exclusão de Categoria', `Categoria "${categoryToDelete.name}" foi excluída.`, user);
        toast({ title: "Categoria Excluída!", variant: "destructive", duration: 5000 });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: categoryRef.path,
            operation: 'delete',
        }));
    });
  }, [categories, products, toast]);

  const addSubcategory = useCallback(async (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    if (category.subcategories.some(s => s.toLowerCase() === subcategoryName.toLowerCase())) {
      toast({ title: "Erro", description: "Essa subcategoria já existe.", variant: "destructive" });
      return;
    }
    const newSubcategories = [...category.subcategories, subcategoryName].sort();
    const categoryRef = doc(db, 'categories', categoryId);
    updateDoc(categoryRef, { subcategories: newSubcategories }).then(() => {
        logAction('Criação de Subcategoria', `Subcategoria "${subcategoryName}" foi adicionada à categoria "${category.name}".`, user);
        toast({ title: "Subcategoria Adicionada!" });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: categoryRef.path,
            operation: 'update',
            requestResourceData: { subcategories: newSubcategories },
        }));
    });
  }, [categories, toast]);

  const updateSubcategory = useCallback(async (categoryId: string, oldSub: string, newSub: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    if (category.subcategories.some(s => s.toLowerCase() === newSub.toLowerCase() && s.toLowerCase() !== oldSub.toLowerCase())) {
        toast({ title: "Erro", description: "Essa subcategoria já existe.", variant: "destructive" });
        return;
    }
    
    const batch = writeBatch(db);
    const newSubs = category.subcategories.map(s => s.toLowerCase() === oldSub.toLowerCase() ? newSub : s).sort();
    batch.update(doc(db, 'categories', categoryId), { subcategories: newSubs });
    
    products.forEach(p => {
        if (p.category === category.name && p.subcategory?.toLowerCase() === oldSub.toLowerCase()) {
            batch.update(doc(db, 'products', p.id), { subcategory: newSub });
        }
    });
    batch.commit().then(() => {
        logAction('Atualização de Subcategoria', `Subcategoria "${oldSub}" foi renomeada para "${newSub}" na categoria "${category.name}".`, user);
        toast({ title: "Subcategoria Renomeada!" });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `categories/${categoryId}`,
            operation: 'update',
        }));
    });
  }, [categories, products, toast]);

  const deleteSubcategory = useCallback(async (categoryId: string, subcategoryName: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    
    const productsInSubcategory = products.some(p => {
        return p.category === category.name && p.subcategory?.toLowerCase() === subcategoryName.toLowerCase();
    });

    if (productsInSubcategory) {
        toast({ title: "Erro", description: "Não é possível excluir subcategorias que contêm produtos.", variant: "destructive" });
        return;
    }
    const newSubcategories = category.subcategories.filter(s => s.toLowerCase() !== subcategoryName.toLowerCase());
    const categoryRef = doc(db, 'categories', categoryId);
    updateDoc(categoryRef, { subcategories: newSubcategories }).then(() => {
        logAction('Exclusão de Subcategoria', `Subcategoria "${subcategoryName}" foi excluída da categoria "${category.name}".`, user);
        toast({ title: "Subcategoria Excluída!", variant: "destructive", duration: 5000 });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: categoryRef.path,
            operation: 'update',
            requestResourceData: { subcategories: newSubcategories },
        }));
    });
  }, [categories, products, toast]);
    
  const moveCategory = useCallback(async (categoryId: string, direction: 'up' | 'down', logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
    const index = sortedCategories.findIndex(c => c.id === categoryId);

    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sortedCategories.length - 1) return;

    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    
    const category1 = sortedCategories[index];
    const category2 = sortedCategories[otherIndex];

    const order1 = category1.order;
    const order2 = category2.order;
    
    const batch = writeBatch(db);
    batch.update(doc(db, 'categories', category1.id), { order: order2 });
    batch.update(doc(db, 'categories', category2.id), { order: order1 });
    await batch.commit().then(() => {
        logAction('Reordenação de Categoria', `Categoria "${category1.name}" foi movida ${direction === 'up' ? 'para cima' : 'para baixo'}.`, user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'categories',
            operation: 'update',
        }));
    });
  }, [categories]);

  const reorderSubcategories = useCallback(async (categoryId: string, draggedSub: string, targetSub: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;

    const subs = Array.from(category.subcategories);
    const draggedIndex = subs.indexOf(draggedSub);
    const targetIndex = subs.indexOf(targetSub);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [removed] = subs.splice(draggedIndex, 1);
    subs.splice(targetIndex, 0, removed);
    
    const categoryRef = doc(db, 'categories', categoryId);
    updateDoc(categoryRef, { subcategories: subs }).then(() => {
        logAction('Reordenação de Subcategoria', `Subcategorias da categoria "${category.name}" foram reordenadas.`, user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: categoryRef.path,
            operation: 'update',
            requestResourceData: { subcategories: subs },
        }));
    });
  }, [categories]);

  const moveSubcategory = useCallback(async (sourceCategoryId: string, subName: string, targetCategoryId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const sourceCategory = categories.find(c => c.id === sourceCategoryId);
    const targetCategory = categories.find(c => c.id === targetCategoryId);

    if (!sourceCategory || !targetCategory) return;
    if (targetCategory.subcategories.some(s => s.toLowerCase() === subName.toLowerCase())) {
        toast({ title: 'Subcategoria já existe', description: `A categoria "${targetCategory.name}" já possui uma subcategoria chamada "${subName}".`, variant: "destructive" });
        return;
    }

    const newSourceSubs = sourceCategory.subcategories.filter(s => s.toLowerCase() !== subName.toLowerCase());
    const newTargetSubs = [...targetCategory.subcategories, subName].sort();
    
    const batch = writeBatch(db);
    products.forEach(p => {
        if (p.category === sourceCategory.name && p.subcategory?.toLowerCase() === subName.toLowerCase()) {
            batch.update(doc(db, 'products', p.id), { category: targetCategory.name });
        }
    });
    batch.update(doc(db, 'categories', sourceCategoryId), { subcategories: newSourceSubs });
    batch.update(doc(db, 'categories', targetCategoryId), { subcategories: newTargetSubs });
    
    batch.commit().then(() => {
        logAction('Movimentação de Subcategoria', `Subcategoria "${subName}" foi movida de "${sourceCategory.name}" para "${targetCategory.name}".`, user);
        toast({ title: 'Subcategoria Movida!', description: `"${subName}" agora faz parte de "${targetCategory.name}".`});
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'categories',
            operation: 'update',
        }));
    });
  }, [categories, products, toast]);

  const manageStockForOrder = useCallback(async (order: Order | undefined, operation: 'add' | 'subtract'): Promise<boolean> => {
    const { db } = getClientFirebase();
    if (!order) return false;
    const batch = writeBatch(db);
    
    for (const orderItem of order.items) {
        const product = products.find(p => p.id === orderItem.id);
        if (product) {
            const stockChange = orderItem.quantity;
            const newStock = operation === 'add' ? product.stock + stockChange : product.stock - stockChange;
            
            if (newStock < 0) {
              toast({
                  title: 'Estoque Insuficiente',
                  description: `Não há estoque suficiente para ${product.name}. Disponível: ${product.stock}, Pedido: ${stockChange}.`,
                  variant: 'destructive'
              });
              return false; // Indicate failure
            }
            
            batch.update(doc(db, 'products', product.id), { stock: newStock });
        }
    }
    
    try {
        await batch.commit();
        return true; // Indicate success
    } catch(e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'products',
            operation: 'update',
        }));
        throw e; // Re-throw to indicate failure
    }
  }, [products, toast]);

  const addOrder = useCallback(async (order: Partial<Order> & { firstDueDate: Date }, logAction: LogAction, user: User | null): Promise<Order | null> => {
    const { db } = getClientFirebase();
    if (!user && order.source !== 'catalogo') {
      throw new Error('Usuário não logado.');
    }

    const ordersCollection = collection(db, 'orders');
    const ordersSnapshot = await getDocs(query(ordersCollection));
    const allOrders = ordersSnapshot.docs.map(d => d.data() as Order);

    if (order.customer?.isDeleted) {
      throw new Error('Cliente está na lixeira e não pode comprar. Entre em contato com o suporte.');
    }

    const normalizedCpf = order.customer?.cpf?.replace(/\D/g, '');
    if (normalizedCpf) {
      const isCustomerBlocked = allOrders.some(o => o.customer?.cpf?.replace(/\D/g, '') === normalizedCpf && !!o.customer?.isDeleted);
      if (isCustomerBlocked) {
        throw new Error('Cliente está na lixeira e não pode comprar. Entre em contato com o suporte.');
      }
    }

    const hasItems = !!(order.items && order.items.length > 0);

    const reservedNumericCodes = new Set<string>();
    allOrders.forEach((o) => {
      const id = typeof o?.id === 'string' ? o.id.trim() : '';
      if (!id) return;

      if (/^\d+$/.test(id)) {
        reservedNumericCodes.add(id);
        return;
      }

      const pedMatch = id.match(/^PED-(\d+)$/);
      if (pedMatch?.[1]) {
        reservedNumericCodes.add(pedMatch[1]);
      }
    });

    const maxNumericCode = Array.from(reservedNumericCodes)
      .filter((id) => /^\d+$/.test(id) && id.length <= 6)
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0] || 0;

    let orderId = '';
    if (hasItems) {
      let next = maxNumericCode + 1;
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = String(next).padStart(4, '0');
        if (!reservedNumericCodes.has(candidate) && !allOrders.some((o) => o.id === candidate || o.id === `PED-${candidate}`)) {
          orderId = candidate;
          break;
        }
        next++;
      }
      if (!orderId) {
        const fallback = String(Date.now() % 10000).padStart(4, '0');
        orderId = reservedNumericCodes.has(fallback) ? String(Date.now() % 100000).padStart(5, '0') : fallback;
      }
    } else {
      const lastReg = allOrders
        .map((o) => (typeof o?.id === 'string' ? o.id.trim() : ''))
        .map((id) => id.match(/^REG-(\d+)$/)?.[1])
        .filter((n): n is string => !!n)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a)[0] || 0;
      orderId = `REG-${String(lastReg + 1).padStart(4, '0')}`;
    }

    const customerToSave = order.customer ? { ...order.customer } : undefined;
    const customerKey = customerToSave
      ? customerToSave.cpf
        ? customerToSave.cpf.replace(/\D/g, '')
        : `${customerToSave.name}-${customerToSave.phone}`
      : '';

    const existingCustomer = customerKey
      ? allOrders
          .filter((o) => {
            const oKey = o.customer?.cpf ? o.customer.cpf.replace(/\D/g, '') : `${o.customer?.name}-${o.customer?.phone}`;
            return oKey === customerKey && !o.customer?.isDeleted;
          })
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.customer
      : undefined;

    if (customerToSave) {
      const wantsClearSeller = customerToSave.sellerId === '';
      const hasSellerId = typeof customerToSave.sellerId === 'string' && customerToSave.sellerId.trim() !== '';

      if (!wantsClearSeller && !hasSellerId && existingCustomer?.sellerId) {
        customerToSave.sellerId = existingCustomer.sellerId;
        customerToSave.sellerName = existingCustomer.sellerName;
      }

      if (wantsClearSeller) {
        delete customerToSave.sellerId;
        delete customerToSave.sellerName;
      } else if (customerToSave.sellerId && !customerToSave.sellerName) {
        customerToSave.sellerName = users.find((u) => u.id === customerToSave.sellerId)?.name || undefined;
      }
    }
    if (customerToSave && !customerToSave.code) {
      const key = customerToSave.cpf ? customerToSave.cpf.replace(/\D/g, '') : `${customerToSave.name}-${customerToSave.phone}`;

      const existingOrderWithCode = allOrders.find(o => {
        const oKey = o.customer?.cpf ? o.customer.cpf.replace(/\D/g, '') : `${o.customer.name}-${o.customer.phone}`;
        return oKey === key && !!o.customer?.code;
      });
      customerToSave.code = existingOrderWithCode?.customer?.code;

      if (!customerToSave.code) {
        customerToSave.code = formatCustomerCode(getMaxCustomerCodeNumber(allOrders) + 1);
      }

      const orderIdsToBackfill = allOrders
        .filter(o => {
          const oKey = o.customer?.cpf ? o.customer.cpf.replace(/\D/g, '') : `${o.customer.name}-${o.customer.phone}`;
          return oKey === key && !o.customer?.code;
        })
        .map(o => o.id);

      if (orderIdsToBackfill.length > 0) {
        const batch = writeBatch(db);
        orderIdsToBackfill.forEach(orderId => {
          batch.update(doc(db, 'orders', orderId), { 'customer.code': customerToSave.code });
        });
        try {
          await batch.commit();
        } catch {
        }
      }
    }

    let createdFromIp = order.createdFromIp;
    if (!createdFromIp) {
      try {
        const response = await fetch('/api/ip', { cache: 'no-store' });
        if (response.ok) {
          const data = (await response.json()) as { ip?: unknown };
          if (typeof data.ip === 'string' && data.ip.trim()) {
            createdFromIp = data.ip.trim();
          }
        }
      } catch {
      }
    }

    const createdAt = order.createdAt || order.date || new Date().toISOString();
    const createdByName =
      order.createdByName ||
      user?.name ||
      (order.source === 'catalogo' ? order.customer?.name : undefined) ||
      'Sistema';
    const createdById = order.createdById || user?.id || (order.source === 'catalogo' ? 'catalogo' : undefined);

    const sellerIdFromOrder = typeof order.sellerId === 'string' && order.sellerId.trim() ? order.sellerId.trim() : '';
    const sellerIdFromUser = user?.id || '';
    const sellerIdFromCustomer =
      typeof customerToSave?.sellerId === 'string' && customerToSave.sellerId.trim() ? customerToSave.sellerId.trim() : '';
    const sellerIdToSave =
      sellerIdFromOrder ||
      (order.source === 'catalogo'
        ? sellerIdFromCustomer || sellerIdFromUser
        : sellerIdFromUser || sellerIdFromCustomer) ||
      '';

    const sellerNameFromOrder = typeof order.sellerName === 'string' && order.sellerName.trim() ? order.sellerName.trim() : '';
    const sellerNameFromUser = user?.name || '';
    const sellerNameFromCustomer =
      typeof customerToSave?.sellerName === 'string' && customerToSave.sellerName.trim() ? customerToSave.sellerName.trim() : '';
    const sellerNameToSave =
      sellerNameFromOrder ||
      (order.source === 'catalogo'
        ? sellerNameFromCustomer || sellerNameFromUser
        : sellerNameFromUser || sellerNameFromCustomer) ||
      (sellerIdToSave ? users.find((u) => u.id === sellerIdToSave)?.name || 'Não atribuído' : 'Não atribuído');

    const itemsToSave = (order.items || []).map((item) => {
      const product = products.find((p) => p.id === item.id);
      const productCode = product?.code || (typeof (item as any)?.code === 'string' ? (item as any).code : '');
      if (!productCode) return item;
      return { ...item, code: productCode };
    });

    const orderToSave = {
        ...order,
        id: orderId,
        customer: customerToSave || order.customer,
        items: itemsToSave,
        sellerId: sellerIdToSave,
        sellerName: sellerNameToSave,
        createdAt,
        createdByName,
        createdById,
        createdFromIp,
        commissionPaid: false,
    } as Order;

    orderToSave.commission = calculateCommission(orderToSave, products);
    
    const subtotal = order.items?.reduce((acc, item) => acc + item.price * item.quantity, 0) || 0;
    const total = subtotal - (order.discount || 0);
    const totalFinanced = total - (order.downPayment || 0);
    orderToSave.total = totalFinanced;
    
    if (orderToSave.installments > 0 && order.firstDueDate) {
      orderToSave.installmentDetails = recalculateInstallments(totalFinanced, orderToSave.installments, orderId, order.firstDueDate.toISOString())
      orderToSave.installmentValue = orderToSave.installmentDetails[0]?.amount || 0;
    }
    
    try {
      if (!await manageStockForOrder(orderToSave, 'subtract')) {
        throw new Error(`Estoque insuficiente para um ou mais produtos.`);
      }

      const safeOrderToSave = removeUndefinedDeep(orderToSave);
      await setDoc(doc(db, 'orders', safeOrderToSave.id), safeOrderToSave);
      
      const creator = user ? `por ${user.name}`: 'pelo cliente';
      logAction('Criação de Pedido', `Novo pedido #${safeOrderToSave.id} para ${safeOrderToSave.customer.name} no valor de R$${safeOrderToSave.total?.toFixed(2)} foi criado ${creator}.`, user);
      return safeOrderToSave;
    } catch(e) {
        console.error("Failed to add order", e);
        if (e instanceof Error && e.message.startsWith('Estoque insuficiente')) {
        } else {
            throw e;
        }
        await manageStockForOrder(order as Order, 'add');
        throw e;
    }
  }, [manageStockForOrder, products, users]);

  const updateOrderStatus = useCallback(async (orderId: string, newStatus: Order['status'], logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate) return;

    const oldStatus = orderToUpdate.status;
    const wasCanceledOrDeleted = oldStatus === 'Cancelado' || oldStatus === 'Excluído';
    const isNowCanceledOrDeleted = newStatus === 'Cancelado' || newStatus === 'Excluído';

    if (wasCanceledOrDeleted && !isNowCanceledOrDeleted) {
        if (!await manageStockForOrder(orderToUpdate, 'subtract')) {
            return;
        }
    }
    
    const detailsToUpdate: Partial<Order> = { status: newStatus };

    if (newStatus === 'Entregue' && orderToUpdate.sellerId) {
      detailsToUpdate.commission = calculateCommission(orderToUpdate, products);
    } else {
        if (!orderToUpdate.isCommissionManual) {
          detailsToUpdate.commission = 0;
        }
        detailsToUpdate.commissionPaid = false;
    }
    
    const orderRef = doc(db, 'orders', orderId);
    updateDoc(orderRef, detailsToUpdate).then(async () => {
        if (!wasCanceledOrDeleted && isNowCanceledOrDeleted) {
            await manageStockForOrder(orderToUpdate, 'add');
        }
        
        logAction('Atualização de Status de Pedido', `Status do pedido #${orderId} alterado de "${oldStatus}" para "${newStatus}".`, user);
        
        if (newStatus !== 'Excluído') {
          toast({ title: "Status do Pedido Atualizado!", description: `O pedido #${orderId} agora está como "${newStatus}".` });
        } else {
          logAction('Exclusão de Pedido', `Pedido #${orderId} movido para a lixeira.`, user);
          toast({ title: "Pedido movido para a Lixeira", description: `O pedido #${orderId} foi movido para a lixeira.` });
        }
    }).catch(async () => {
        if (wasCanceledOrDeleted && !isNowCanceledOrDeleted) {
            await manageStockForOrder(orderToUpdate, 'add');
        }
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: orderRef.path,
            operation: 'update',
        }));
    });
  }, [orders, products, manageStockForOrder, toast]);

  const deleteOrder = useCallback(async (orderId: string, logAction: LogAction, user: User | null) => {
    await updateOrderStatus(orderId, 'Excluído', logAction, user);
  }, [updateOrderStatus]);

  const permanentlyDeleteOrder = useCallback(async (orderId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const orderToDelete = orders.find(o => o.id === orderId);
    if (!orderToDelete || orderToDelete.status !== 'Excluído') {
      toast({ title: "Erro", description: "Só é possível excluir permanentemente pedidos que estão na lixeira.", variant: "destructive" });
      return;
    }
    
    const orderRef = doc(db, 'orders', orderId);
    deleteDoc(orderRef).then(() => {
        logAction('Exclusão Permanente de Pedido', `Pedido #${orderId} foi excluído permanentemente.`, user);
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: orderRef.path,
            operation: 'delete',
        }));
    });
  }, [orders, toast]);

  const recordInstallmentPayment = useCallback(async (orderId: string, installmentNumber: number, paymentData: Omit<Payment, 'receivedBy'>, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    const paymentWithUser = {
      ...paymentData,
      receivedBy: user?.name || 'Sistema'
    };
    
    const updatedInstallments = (order.installmentDetails || []).map((inst) => {
      if (inst.installmentNumber === installmentNumber) {
        const currentPaidAmount = Number(inst.paidAmount) || 0;
        const paymentAmount = Number(paymentWithUser.amount) || 0;
        const newPaidAmount = currentPaidAmount + paymentAmount;
        const isPaid = Math.abs(newPaidAmount - inst.amount) < 0.01;
        const newStatus = isPaid ? 'Pago' : 'Pendente';
        const existingPayments = Array.isArray(inst.payments) ? inst.payments : [];

        return { 
          ...inst, 
          status: newStatus, 
          paidAmount: newPaidAmount, 
          payments: [...existingPayments, paymentWithUser]
        };
      }
      return inst;
    });

    const orderRef = doc(db, 'orders', orderId);
    updateDoc(orderRef, { installmentDetails: updatedInstallments }).then(() => {
        logAction('Registro de Pagamento de Parcela', `Registrado pagamento de ${paymentWithUser.amount} (${paymentWithUser.method}) na parcela ${installmentNumber} do pedido #${orderId}.`, user);
        toast({ title: 'Pagamento Registrado!' });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: orderRef.path,
            operation: 'update',
            requestResourceData: { installmentDetails: updatedInstallments },
        }));
    });
  }, [orders, toast]);

  const reversePayment = useCallback(async (orderId: string, installmentNumber: number, paymentId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    let reversedPaymentAmount = 0;
    const updatedInstallments = (order.installmentDetails || []).map(inst => {
      if (inst.installmentNumber === installmentNumber) {
        const paymentToReverse = inst.payments.find(p => p.id === paymentId);
        if (!paymentToReverse) return inst;

        reversedPaymentAmount = paymentToReverse.amount;
        const newPayments = inst.payments.filter(p => p.id !== paymentId);
        const newPaidAmount = (inst.paidAmount || 0) - reversedPaymentAmount;
        const newStatus = newPaidAmount >= inst.amount ? 'Pago' : 'Pendente';
        
        return { ...inst, payments: newPayments, paidAmount: newPaidAmount, status: newStatus };
      }
      return inst;
    });

    const orderRef = doc(db, 'orders', orderId);
    updateDoc(orderRef, { installmentDetails: updatedInstallments }).then(() => {
        logAction('Estorno de Pagamento', `Estornado pagamento de ${reversedPaymentAmount} da parcela ${installmentNumber} do pedido #${orderId}.`, user);
        toast({ title: 'Pagamento Estornado!', description: 'O valor foi retornado ao saldo devedor da parcela.' });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: orderRef.path,
            operation: 'update',
            requestResourceData: { installmentDetails: updatedInstallments },
        }));
    });
  }, [orders, toast]);


  const updateInstallmentDueDate = useCallback(async (orderId: string, installmentNumber: number, newDueDate: Date, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const oldDueDate = order.installmentDetails?.find(i => i.installmentNumber === installmentNumber)?.dueDate;

    const updatedInstallments = (order.installmentDetails || []).map((inst) =>
      inst.installmentNumber === installmentNumber ? { ...inst, dueDate: newDueDate.toISOString() } : inst
    );
    const orderRef = doc(db, 'orders', orderId);
    updateDoc(orderRef, { installmentDetails: updatedInstallments }).then(() => {
        logAction('Atualização de Vencimento', `Vencimento da parcela ${installmentNumber} do pedido #${orderId} alterado de ${oldDueDate ? new Date(oldDueDate).toLocaleDateString() : 'N/A'} para ${newDueDate.toLocaleDateString()}.`, user);
        toast({ title: "Vencimento Atualizado!" });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: orderRef.path,
            operation: 'update',
            requestResourceData: { installmentDetails: updatedInstallments },
        }));
    });
  }, [orders, toast]);

    const updateInstallmentAmount = useCallback(async (orderId: string, installmentNumber: number, newAmount: number, logAction: LogAction, user: User | null) => {
        const { db } = getClientFirebase();
        const order = orders.find(o => o.id === orderId);
        if (!order || !order.installmentDetails) return;

        const updatedInstallments = order.installmentDetails.map(inst => 
            inst.installmentNumber === installmentNumber ? { ...inst, amount: newAmount } : inst
        );
        
        const newTotalFinanced = updatedInstallments.reduce((sum, inst) => sum + inst.amount, 0);
        
        const subtotal = order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const newDiscount = subtotal - (newTotalFinanced + (order.downPayment || 0));

        const dataToUpdate: Partial<Order> = {
            installmentDetails: updatedInstallments,
            total: newTotalFinanced,
            discount: newDiscount,
        };

        const orderRef = doc(db, 'orders', orderId);
        updateDoc(orderRef, dataToUpdate).then(() => {
            logAction('Atualização de Valor de Parcela', `Valor da parcela ${installmentNumber} do pedido #${orderId} alterado para ${newAmount.toFixed(2)}. Total do pedido e desconto recalculados.`, user);
            toast({ title: 'Valor da Parcela Atualizado!' });
        }).catch(async () => {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: orderRef.path,
                operation: 'update',
                requestResourceData: dataToUpdate,
            }));
        });
    }, [orders, toast]);

  const updateCustomer = useCallback(async (oldCustomer: CustomerInfo, updatedCustomerData: CustomerInfo, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const batch = writeBatch(db);
    const oldCustomerKey = getCustomerKey(oldCustomer);

    orders.forEach(order => {
        const orderCustomerKey = getCustomerKey(order.customer);
        if (orderCustomerKey === oldCustomerKey) {
            const customerData = { ...order.customer, ...updatedCustomerData };
            if (updatedCustomerData.password === undefined || updatedCustomerData.password === '') {
                delete customerData.password;
            }
            if (updatedCustomerData.sellerId === '') {
                delete customerData.sellerId;
                delete customerData.sellerName;
            } else if (updatedCustomerData.sellerId && !customerData.sellerName) {
                customerData.sellerName = users.find((u) => u.id === updatedCustomerData.sellerId)?.name || '';
            }

            const updateData: Record<string, unknown> = { customer: customerData };
            if (order.source === 'catalogo') {
                if (updatedCustomerData.sellerId === '') {
                    updateData.sellerId = deleteField();
                    updateData.sellerName = deleteField();
                } else if (updatedCustomerData.sellerId) {
                    updateData.sellerId = updatedCustomerData.sellerId;
                    updateData.sellerName =
                        updatedCustomerData.sellerName ||
                        users.find((u) => u.id === updatedCustomerData.sellerId)?.name ||
                        'Não atribuído';
                }
            }

            batch.update(doc(db, 'orders', order.id), updateData);
        }
    });

    batch.commit().then(() => {
        logAction('Atualização de Cliente', `Dados do cliente ${updatedCustomerData.name} (CPF: ${updatedCustomerData.cpf}) foram atualizados.`, user);
        toast({ title: "Cliente Atualizado!", description: `Os dados de ${updatedCustomerData.name} foram salvos.` });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `orders`,
            operation: 'update',
        }));
    });
  }, [orders, toast, users]);
  
  const deleteCustomer = useCallback(async (customer: CustomerInfo, logAction: LogAction, user: User | null) => {
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
        toast({ title: "Acesso negado", description: "Apenas admin e gerente podem excluir clientes.", variant: "destructive" });
        return;
    }
    const { db } = getClientFirebase();
    const customerKey = getCustomerKey(customer);

    const ordersToTrash = orders.filter(order => {
        const orderCustomerKey = getCustomerKey(order.customer);
        return orderCustomerKey === customerKey;
    });

    if (ordersToTrash.length === 0) {
        toast({ title: "Nenhum pedido encontrado", description: "Não há registros para este cliente.", variant: "destructive" });
        return;
    }
    
    const batch = writeBatch(db);
    const deletedAt = new Date().toISOString();
    ordersToTrash.forEach(order => {
        batch.update(doc(db, 'orders', order.id), {
            status: 'Excluído',
            previousStatus: order.status,
            customer: {
                ...order.customer,
                isDeleted: true,
                deletedAt,
                deletedBy: user.name,
                deletedById: user.id,
            },
        });
    });

    batch.commit().then(() => {
        logAction('Cliente movido para lixeira', `Cliente ${customer.name} (CPF: ${customer.cpf}) e todos os seus ${ordersToTrash.length} pedidos foram movidos para a lixeira.`, user);
        toast({ title: "Cliente movido para a lixeira!", description: `O cliente ${customer.name} foi movido para a lixeira.`, variant: "destructive" });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'orders',
            operation: 'update',
        }));
    });
}, [orders, toast]);

  const restoreCustomer = useCallback(async (customer: CustomerInfo, logAction: LogAction, user: User | null) => {
    if (!user || (user.role !== 'admin' && user.role !== 'gerente')) {
        toast({ title: "Acesso negado", description: "Apenas admin e gerente podem restaurar clientes.", variant: "destructive" });
        return;
    }
    const { db } = getClientFirebase();
    const customerKey = getCustomerKey(customer);

    const ordersToRestore = orders.filter(order => {
        const orderCustomerKey = getCustomerKey(order.customer);
        return orderCustomerKey === customerKey;
    });

    if (ordersToRestore.length === 0) {
        toast({ title: "Nenhum pedido encontrado", description: "Não há registros para este cliente.", variant: "destructive" });
        return;
    }

    const chunkSize = 450;
    for (let start = 0; start < ordersToRestore.length; start += chunkSize) {
        const slice = ordersToRestore.slice(start, start + chunkSize);
        const batch = writeBatch(db);

        slice.forEach(order => {
            const nextStatus =
                order.previousStatus && order.previousStatus !== 'Excluído'
                    ? order.previousStatus
                    : order.items.length > 0
                        ? 'Processando'
                        : 'Excluído';

            batch.update(doc(db, 'orders', order.id), {
                status: nextStatus,
                previousStatus: deleteField(),
                customer: {
                    ...order.customer,
                    isDeleted: false,
                    deletedAt: deleteField(),
                    deletedBy: deleteField(),
                    deletedById: deleteField(),
                },
            });
        });

        await batch.commit().catch(async () => {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: 'orders',
                operation: 'update',
            }));
        });
    }

    logAction('Cliente restaurado', `Cliente ${customer.name} (CPF: ${customer.cpf}) foi restaurado da lixeira.`, user);
    toast({ title: "Cliente restaurado!", description: `O cliente ${customer.name} foi restaurado.`, duration: 5000 });
  }, [orders, toast]);

  const importCustomers = useCallback(async (csvData: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const sanitizedCsv = csvData.trim().replace(/^\uFEFF/, ''); 
    if (!sanitizedCsv) {
        toast({ title: 'Arquivo Vazio', description: 'O arquivo CSV está vazio.', variant: 'destructive' });
        return;
    }
    const lines = sanitizedCsv.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) {
        toast({ title: 'Arquivo Inválido', description: 'O arquivo CSV precisa ter um cabeçalho e pelo menos uma linha de dados.', variant: 'destructive' });
        return;
    }
    
    const headerLine = lines[0];
    const dataLines = lines.slice(1);
    const delimiter = headerLine.includes(';') ? ';' : ',';
    
    const fileHeaders = headerLine.split(delimiter).map(h => h.trim().replace(/["']/g, '').toLowerCase());

    const possibleMappings: { [key in keyof Omit<CustomerInfo, 'password'>]?: string[] } = {
        cpf: ['cpf'],
        name: ['nome', 'nome completo', 'cliente', 'razao social'],
        phone: ['telefone', 'fone', 'celular', 'whatsapp'],
        email: ['email', 'e-mail'],
        zip: ['cep'],
        address: ['endereco', 'rua', 'logradouro', 'end'],
        number: ['numero', 'num'],
        complement: ['complemento', 'compl'],
        neighborhood: ['bairro'],
        city: ['cidade', 'municipio'],
        state: ['estado', 'uf'],
    };

    const headerMap: { [key: string]: number } = {};

    for (const key in possibleMappings) {
        const typedKey = key as keyof Omit<CustomerInfo, 'password'>;
        const potentialNames = possibleMappings[typedKey]!;
        
        const foundIndex = fileHeaders.findIndex(header => 
            potentialNames.some(pName => header.includes(pName))
        );

        if (foundIndex !== -1) {
            headerMap[typedKey] = foundIndex;
        }
    }
    
    if (headerMap.cpf === undefined) {
        toast({ title: 'Arquivo Inválido', description: "A coluna 'cpf' é obrigatória e não foi encontrada no arquivo.", variant: 'destructive' });
        return;
    }
    
    const customersToImport = dataLines.map(line => {
        if (!line.trim()) return null;
        const data = line.split(delimiter);
        const customer: Partial<CustomerInfo> = {};
        for (const key in headerMap) {
            const typedKey = key as keyof Omit<CustomerInfo, 'password' | 'isDeleted' | 'deletedAt' | 'deletedBy' | 'deletedById'>;
            const colIndex = headerMap[key];
            if (colIndex !== undefined && colIndex < data.length) {
                customer[typedKey] = data[colIndex]?.trim().replace(/["']/g, '') || '';
            }
        }
        return customer;
    }).filter((c): c is Partial<CustomerInfo> & { cpf: string } => !!c && !!c.cpf && c.cpf.replace(/\D/g, '').length === 11);

    if (customersToImport.length === 0) {
        toast({ title: 'Nenhum Cliente Válido', description: 'Nenhum cliente com CPF válido foi encontrado no arquivo para importar.', variant: 'destructive' });
        return;
    }
    
    const batch = writeBatch(db);
    let updatedCount = 0;
    let createdCount = 0;
    
    const existingCpfSet = new Set(
        orders
            .map(o => o.customer.cpf)
            .filter((cpf): cpf is string => !!cpf)
            .map(cpf => cpf.replace(/\D/g, ''))
    );


    for (const importedCustomer of customersToImport) {
        const cpf = importedCustomer.cpf!.replace(/\D/g, '');
        const existingOrders = orders.filter(o => o.customer.cpf && o.customer.cpf.replace(/\D/g, '') === cpf);

        if (existingOrders.length > 0) {
            let customerAlreadyUpdated = false;
            existingOrders.forEach(order => {
                const updatedCustomerData = { ...order.customer, ...importedCustomer, cpf };
                batch.update(doc(db, 'orders', order.id), { customer: updatedCustomerData });
                if (!customerAlreadyUpdated) {
                    updatedCount++;
                    customerAlreadyUpdated = true;
                }
            });
        } else {
            if (!existingCpfSet.has(cpf)) {
                const orderId = `REG-${cpf}`;
                const completeCustomerData: CustomerInfo = {
                    cpf,
                    name: importedCustomer.name || 'Nome não informado',
                    phone: importedCustomer.phone || '',
                    phone2: importedCustomer.phone2,
                    phone3: importedCustomer.phone3,
                    email: importedCustomer.email || '',
                    zip: importedCustomer.zip || '',
                    address: importedCustomer.address || '',
                    number: importedCustomer.number || '',
                    complement: importedCustomer.complement || '',
                    neighborhood: importedCustomer.neighborhood || '',
                    city: importedCustomer.city || '',
                    state: importedCustomer.state || '',
                    password: cpf.substring(0, 6)
                };
                const dummyOrder: Order = {
                    id: orderId,
                    customer: completeCustomerData,
                    items: [], total: 0, installments: 0, installmentValue: 0,
                    date: new Date().toISOString(), status: 'Excluído',
                    paymentMethod: 'Dinheiro', installmentDetails: [],
                };
                batch.set(doc(db, 'orders', orderId), dummyOrder);
                createdCount++;
                existingCpfSet.add(cpf);
            }
        }
    }

    try {
        await batch.commit();
        logAction('Importação de Clientes', `${createdCount} clientes criados e ${updatedCount} atualizados via CSV.`, user);
        toast({
            title: 'Importação Concluída!',
            description: `${createdCount} novos clientes foram criados e ${updatedCount} clientes existentes foram atualizados.`
        });
    } catch (e) {
        console.error("Error during batch commit for customer import", e);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'orders',
            operation: 'write',
        }));
    }
  }, [orders, toast]);


  const updateOrderDetails = useCallback(async (orderId: string, details: Partial<Order> & { resetDownPayment?: boolean }, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    let detailsToUpdate: Partial<Order> = { ...details };
    const { downPayment, resetDownPayment, ...otherDetails } = details;
    detailsToUpdate = otherDetails;
    
    const subtotal = order.items.reduce((acc, item) => acc + item.price * item.quantity, 0);

    const hasInstallmentsChanged = details.installments && details.installments !== order.installments;
    const hasDiscountChanged = details.discount !== undefined && details.discount !== order.discount;
    const hasDownPayment = downPayment !== undefined && downPayment > 0;

    let currentDownPayment = order.downPayment || 0;
    if (resetDownPayment) {
        currentDownPayment = 0;
        logAction('Redefinição de Entrada', `A entrada do pedido #${orderId} foi zerada.`, user);
    } else if (hasDownPayment) {
        currentDownPayment += downPayment;
    }

    if (hasInstallmentsChanged || hasDiscountChanged || hasDownPayment || resetDownPayment) {
        const currentDiscount = hasDiscountChanged ? details.discount! : (order.discount || 0);
        const totalAfterDiscountAndEntry = subtotal - currentDiscount - currentDownPayment;
        
        detailsToUpdate.total = totalAfterDiscountAndEntry;
        
        const currentInstallments = hasInstallmentsChanged ? details.installments! : order.installments;
        
        let newInstallmentDetails = recalculateInstallments(totalAfterDiscountAndEntry, currentInstallments, orderId, order.date);

        if (hasDownPayment) {
            logAction('Registro de Entrada', `Registrada entrada de R$${downPayment?.toFixed(2)} no pedido #${orderId}.`, user);
        }
        
        detailsToUpdate = {
            ...detailsToUpdate,
            discount: currentDiscount,
            installments: currentInstallments,
            installmentValue: newInstallmentDetails[0]?.amount || 0,
            installmentDetails: newInstallmentDetails,
            downPayment: currentDownPayment,
        };
    }
    
    const orderRef = doc(db, 'orders', orderId);
    updateDoc(orderRef, detailsToUpdate).then(() => {
      logAction('Atualização de Detalhes do Pedido', `Detalhes do pedido #${orderId} foram atualizados.`, user);
      toast({ title: "Pedido Atualizado!", description: `Os detalhes do pedido #${orderId} foram atualizados.` });
    }).catch(async () => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: orderRef.path,
          operation: 'update',
          requestResourceData: detailsToUpdate,
      }));
    });
  }, [orders, toast]);

  const payCommissions = useCallback(async (sellerId: string, sellerName: string, amount: number, orderIds: string[], period: string, logAction: LogAction, user: User | null): Promise<string | null> => {
    const { db } = getClientFirebase();
    const paymentId = `comp-${sellerId}-${Date.now()}`;
    const payment: CommissionPayment = {
        id: paymentId,
        sellerId,
        sellerName,
        amount,
        paymentDate: new Date().toISOString(),
        period,
        orderIds
    };
    const batch = writeBatch(db);
    const paymentRef = doc(db, 'commissionPayments', paymentId);
    batch.set(paymentRef, payment);

    orderIds.forEach(orderId => {
        const orderRef = doc(db, 'orders', orderId);
        batch.update(orderRef, { commissionPaid: true });
    });

    try {
        await batch.commit();
        logAction('Pagamento de Comissão', `Comissão de ${sellerName} no valor de R$${amount.toFixed(2)} referente a ${period} foi paga.`, user);
        toast({ title: "Comissão Paga!", description: `O pagamento para ${sellerName} foi registrado.` });
        return paymentId;
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'commissionPayments',
            operation: 'create',
            requestResourceData: payment,
        }));
        return null;
    }
  }, [toast]);

  const reverseCommissionPayment = useCallback(async (paymentId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const paymentToReverse = commissionPayments.find(p => p.id === paymentId);
    if (!paymentToReverse) {
      toast({ title: "Erro", description: "Pagamento não encontrado.", variant: "destructive" });
      return;
    }
    
    const batch = writeBatch(db);
    batch.delete(doc(db, 'commissionPayments', paymentId));

    paymentToReverse.orderIds.forEach(orderId => {
      batch.update(doc(db, 'orders', orderId), { commissionPaid: false });
    });

    batch.commit().then(() => {
        logAction('Estorno de Comissão', `O pagamento de comissão ID ${paymentId} foi estornado.`, user);
        toast({ title: "Pagamento Estornado!", description: "As comissões dos pedidos voltaram a ficar pendentes." });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `commissionPayments/${paymentId}`,
            operation: 'delete',
        }));
    });
  }, [commissionPayments, toast]);

  const saveStockAudit = useCallback(async (audit: StockAudit, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const auditRef = doc(db, 'stockAudits', audit.id);
    setDoc(auditRef, audit).then(() => {
        logAction('Auditoria de Estoque', `Auditoria de estoque para ${audit.month}/${audit.year} foi salva.`, user);
        toast({ title: "Auditoria Salva!", description: "O relatório de auditoria foi salvo com sucesso." });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: auditRef.path,
            operation: 'create',
            requestResourceData: audit,
        }));
    });
  }, [toast]);

  const addAvaria = useCallback(async (avariaData: Omit<Avaria, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    if (!user) return;
    const newAvariaId = `avaria-${Date.now()}`;
    const newAvaria: Avaria = {
      ...avariaData,
      id: newAvariaId,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      createdByName: user.name,
    };
    
    const avariaRef = doc(db, 'avarias', newAvariaId);
    setDoc(avariaRef, newAvaria).then(() => {
        logAction('Registro de Avaria', `Nova avaria registrada para o cliente ${avariaData.customerName} (Produto: ${avariaData.productName}).`, user);
        toast({
            title: "Avaria Registrada!",
            description: "O registro de avaria foi salvo com sucesso.",
        });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: avariaRef.path,
            operation: 'create',
            requestResourceData: newAvaria,
        }));
    });
  }, [toast]);

  const updateAvaria = useCallback(async (avariaId: string, avariaData: Partial<Omit<Avaria, 'id'>>, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const avariaRef = doc(db, 'avarias', avariaId);
    const dataToUpdate = {
        ...avariaData,
        // Update who last modified it, if needed for tracking
        lastModifiedBy: user?.name,
        lastModifiedAt: new Date().toISOString(),
    };
    updateDoc(avariaRef, dataToUpdate).then(() => {
        logAction('Atualização de Avaria', `Avaria ID ${avariaId} foi atualizada.`, user);
        toast({ title: "Avaria Atualizada!", description: "O registro de avaria foi atualizado." });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: avariaRef.path,
            operation: 'update',
            requestResourceData: dataToUpdate,
        }));
    });
  }, [toast]);

  const deleteAvaria = useCallback(async (avariaId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const avariaRef = doc(db, 'avarias', avariaId);
    deleteDoc(avariaRef).then(() => {
        logAction('Exclusão de Avaria', `Avaria ID ${avariaId} foi excluída.`, user);
        toast({ title: "Avaria Excluída!", variant: "destructive", duration: 5000 });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: avariaRef.path,
            operation: 'delete',
        }));
    });
  }, [toast]);

  const emptyTrash = useCallback(async (logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const batch = writeBatch(db);
    const deletedOrders = orders.filter(o => o.status === 'Excluído' && o.items.length > 0);
    
    if (deletedOrders.length === 0) {
      toast({ title: 'Lixeira Vazia', description: 'Não há pedidos de compra para remover da lixeira.' });
      return;
    }

    deletedOrders.forEach(order => {
      const orderRef = doc(db, 'orders', order.id);
      batch.delete(orderRef);
    });

    try {
      await batch.commit();
      logAction('Esvaziar Lixeira', `Todos os ${deletedOrders.length} pedidos da lixeira foram permanentemente excluídos.`, user);
      toast({ title: 'Lixeira Esvaziada!', description: `${deletedOrders.length} pedidos foram excluídos permanentemente.` });
    } catch (e) {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: 'orders',
        operation: 'delete',
      }));
    }
  }, [orders, toast]);
  
  const deleteChatSession = useCallback(async (sessionId: string, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const sessionRef = doc(db, 'chatSessions', sessionId);
    const messagesRef = collection(db, 'chatSessions', sessionId, 'messages');

    try {
      // Delete all messages in the subcollection first
      const messagesSnapshot = await getDocs(messagesRef);
      const batch = writeBatch(db);
      messagesSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Now delete the session document
      await deleteDoc(sessionRef);

      logAction('Exclusão de Chat', `Conversa de chat ID ${sessionId} foi excluída permanentemente.`, user);
      toast({ title: "Conversa Excluída!", description: "A conversa e todas as suas mensagens foram removidas.", variant: "destructive" });
    } catch (e) {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `chatSessions/${sessionId}`,
            operation: 'delete',
        }));
    }
  }, [toast]);

  const updateChatSession = useCallback(async (sessionId: string, data: Partial<ChatSession>, logAction: LogAction, user: User | null) => {
    const { db } = getClientFirebase();
    const sessionRef = doc(db, 'chatSessions', sessionId);
    
    updateDoc(sessionRef, data).then(() => {
        logAction('Atualização de Chat', `Sessão de chat ${sessionId} foi atualizada.`, user);
        toast({ title: 'Nome do visitante atualizado!' });
    }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: sessionRef.path,
            operation: 'update',
            requestResourceData: data,
        }));
    });
  }, [toast]);
  
  const value = useMemo(() => ({
    addOrder, deleteOrder, permanentlyDeleteOrder, updateOrderStatus, recordInstallmentPayment, reversePayment, updateInstallmentDueDate, updateInstallmentAmount, updateCustomer, deleteCustomer, importCustomers, updateOrderDetails,
    restoreCustomer,
    addProduct, updateProduct, deleteProduct,
    addCategory, deleteCategory, updateCategoryName, addSubcategory, updateSubcategory, deleteSubcategory, moveCategory, reorderSubcategories, moveSubcategory,
    payCommissions, reverseCommissionPayment,
    restoreAdminData, seedSampleCatalog, importCatalogData, resetOrders, resetProducts, resetFinancials, resetAllAdminData,
    saveStockAudit, addAvaria, updateAvaria, deleteAvaria,
    emptyTrash, deleteChatSession, updateChatSession,
    // Admin Data states
    orders,
    commissionPayments,
    stockAudits,
    avarias,
    chatSessions,
    customers,
    customerOrders,
    customerFinancials,
    financialSummary,
    commissionSummary,
  }), [
    addOrder, deleteOrder, permanentlyDeleteOrder, updateOrderStatus, recordInstallmentPayment, reversePayment, updateInstallmentDueDate, updateInstallmentAmount, updateCustomer, deleteCustomer, importCustomers, updateOrderDetails,
    restoreCustomer,
    addProduct, updateProduct, deleteProduct,
    addCategory, deleteCategory, updateCategoryName, addSubcategory, updateSubcategory, deleteSubcategory, moveCategory, reorderSubcategories, moveSubcategory,
    payCommissions, reverseCommissionPayment,
    restoreAdminData, seedSampleCatalog, importCatalogData, resetOrders, resetProducts, resetFinancials, resetAllAdminData,
    saveStockAudit, addAvaria, updateAvaria, deleteAvaria,
    emptyTrash, deleteChatSession, updateChatSession,
    orders, commissionPayments, stockAudits, avarias, chatSessions, customers, customerOrders, customerFinancials, financialSummary, commissionSummary
  ]);

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = (): AdminContextType => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};

export const useAdminData = (): AdminContextType => {
    const context = useContext(AdminContext);
    if (context === undefined) {
        throw new Error('useAdminData must be used within an AdminProvider');
    }
    return context;
};
