
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { CustomerInfo, Order } from '@/lib/types';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, query, where, getDocs } from 'firebase/firestore';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CUSTOMER_SESSION_STORAGE_KEY = 'customerSession';
const LEGACY_CUSTOMER_STORAGE_KEY = 'customer';

type StoredCustomerSession = {
  customer: CustomerInfo;
  expiresAt: number;
};

interface CustomerAuthContextType {
  customer: CustomerInfo | null;
  customerOrders: Order[];
  login: (cpf: string, pass: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

export const CustomerAuthProvider = ({ children }: { children: ReactNode }) => {
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();
  const logoutTimeoutRef = useRef<number | null>(null);

  const clearLogoutTimeout = () => {
    if (logoutTimeoutRef.current) {
      window.clearTimeout(logoutTimeoutRef.current);
      logoutTimeoutRef.current = null;
    }
  };

  const clearStoredSession = () => {
    localStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_CUSTOMER_STORAGE_KEY);
  };

  const scheduleLogoutAt = (expiresAt: number) => {
    clearLogoutTimeout();
    const delay = Math.max(0, expiresAt - Date.now());
    logoutTimeoutRef.current = window.setTimeout(() => {
      setCustomer(null);
      clearStoredSession();
      toast({ title: 'Sessão expirada', description: 'Faça login novamente.' });
      router.replace('/area-cliente/login');
    }, delay);
  };

  const readStoredSession = (): StoredCustomerSession | null => {
    try {
      const raw = localStorage.getItem(CUSTOMER_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredCustomerSession;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.customer || typeof parsed.expiresAt !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeStoredSession = (customerToStore: CustomerInfo, expiresAt?: number) => {
    const session: StoredCustomerSession = {
      customer: customerToStore,
      expiresAt: expiresAt ?? Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(CUSTOMER_SESSION_STORAGE_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_CUSTOMER_STORAGE_KEY);
    scheduleLogoutAt(session.expiresAt);
    return session;
  };
  
  useEffect(() => {
    setIsLoading(true);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== CUSTOMER_SESSION_STORAGE_KEY && e.key !== LEGACY_CUSTOMER_STORAGE_KEY) return;
      const session = readStoredSession();
      if (!session) {
        clearLogoutTimeout();
        setCustomer(null);
        return;
      }
      if (Date.now() >= session.expiresAt) {
        clearLogoutTimeout();
        setCustomer(null);
        clearStoredSession();
        return;
      }
      setCustomer(session.customer);
      scheduleLogoutAt(session.expiresAt);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    try {
      const session = readStoredSession();
      if (session) {
        if (Date.now() >= session.expiresAt) {
          setCustomer(null);
          clearStoredSession();
          clearLogoutTimeout();
          return;
        }
        setCustomer(session.customer);
        scheduleLogoutAt(session.expiresAt);
        return;
      }

      const legacy = localStorage.getItem(LEGACY_CUSTOMER_STORAGE_KEY);
      if (!legacy) return;
      const legacyCustomer = JSON.parse(legacy) as CustomerInfo;
      setCustomer(legacyCustomer);
      writeStoredSession(legacyCustomer);
    } catch {
      setCustomer(null);
      clearStoredSession();
      clearLogoutTimeout();
    }
  }, []);

  useEffect(() => {
    if (!customer?.cpf) {
        setCustomerOrders([]);
        return;
    }

    try {
      const { db } = getClientFirebase();
      const ordersRef = collection(db, 'orders');
      const q = query(ordersRef, where('customer.cpf', '==', customer.cpf));
      let cancelled = false;

      const timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setCustomerOrders([]);
      }, 8000);

      Promise.race([
        getDocs(q),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 8000)),
      ])
        .then((querySnapshot) => {
          if (cancelled) return;
          window.clearTimeout(timeoutId);
          const ordersData = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order));
          setCustomerOrders(ordersData);
        })
        .catch(() => {
          if (cancelled) return;
          window.clearTimeout(timeoutId);
        });

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    } catch (error) {
      setCustomerOrders([]);
      return;
    }
  }, [customer]);

  const login = async (cpf: string, pass: string): Promise<boolean> => {
    let db: ReturnType<typeof getClientFirebase>['db'] | null = null;
    try {
      ({ db } = getClientFirebase());
    } catch (error) {
      toast({ title: 'Erro de Autenticação', description: 'Firebase não está configurado.', variant: 'destructive' });
      return false;
    }
    if (!db) {
      toast({ title: 'Erro de Autenticação', description: 'Firebase não está configurado.', variant: 'destructive' });
      return false;
    }

    const normalizedCpf = cpf.replace(/\D/g, '');
    
    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, where('customer.cpf', '==', normalizedCpf));

    try {
        const querySnapshot = await Promise.race([
          getDocs(q),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 8000)),
        ]);
        
        const customerOrders = querySnapshot.docs.map(doc => doc.data() as Order);

        if (customerOrders.length === 0) {
             toast({ title: 'Falha no Login', description: 'CPF não encontrado.', variant: 'destructive' });
             return false;
        }
        
        const latestCustomerData = customerOrders
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .find(o => o.customer.password)?.customer;

        if (!latestCustomerData || !latestCustomerData.password) {
            toast({ title: 'Falha no Login', description: 'Esta conta ainda não possui uma senha cadastrada. Por favor, complete uma nova compra para criar uma.', variant: 'destructive' });
            return false;
        }

        if (latestCustomerData.password === pass) {
            const customerToStore = { ...latestCustomerData };
            delete customerToStore.password;
            
            setCustomer(customerToStore); 
            writeStoredSession(customerToStore);
            router.push('/area-cliente/minha-conta');
            toast({
                title: 'Login bem-sucedido!',
                description: `Bem-vindo(a) de volta, ${customerToStore.name.split(' ')[0]}.`,
            });
            return true;
        } else {
            toast({
                title: 'Falha no Login',
                description: 'Senha inválida.',
                variant: 'destructive',
            });
            return false;
        }

    } catch (error) {
        toast({ title: 'Erro de Autenticação', description: 'Não foi possível verificar suas credenciais. Tente novamente.', variant: 'destructive' });
        return false;
    }
  };

  const logout = () => {
    clearLogoutTimeout();
    setCustomer(null);
    clearStoredSession();
    router.push('/area-cliente/login');
  };

  const value = useMemo(() => ({
    customer,
    customerOrders,
    login,
    logout,
    isLoading,
    isAuthenticated: !!customer,
  }), [customer, customerOrders, isLoading]);


  return (
    <CustomerAuthContext.Provider value={value}>
      {children}
    </CustomerAuthContext.Provider>
  );
};

export const useCustomerAuth = () => {
  const context = useContext(CustomerAuthContext);
  if (context === undefined) {
    throw new Error('useCustomerAuth must be used within a CustomerAuthProvider');
  }
  return context;
};
