
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, getDocs } from 'firebase/firestore';
import { getClientFirebase } from '@/lib/firebase-client';
import type { Product, Category, Order, CommissionPayment, StockAudit, Avaria, CustomerInfo } from '@/lib/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from './AuthContext';
import { products as initialProducts } from '@/lib/products';


interface DataContextType {
  products: Product[];
  categories: Category[];
  orders: Order[];
  commissionPayments: CommissionPayment[];
  stockAudits: StockAudit[];
  avarias: Avaria[];
  customers: CustomerInfo[];
  customerOrders: { [key: string]: Order[] };
  customerFinancials: { [key: string]: { totalComprado: number, totalPago: number, saldoDevedor: number } };
  financialSummary: { totalVendido: number, totalRecebido: number, totalPendente: number, lucroBruto: number, monthlyData: { name: string, total: number }[] };
  commissionSummary: { totalPendingCommission: number, commissionsBySeller: { id: string; name: string; total: number; count: number; orderIds: string[] }[] };
  isLoading: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<CommissionPayment[]>([]);
  const [stockAudits, setStockAudits] = useState<StockAudit[]>([]);
  const [avarias, setAvarias] = useState<Avaria[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { users } = useAuth();

  useEffect(() => {
    const { db } = getClientFirebase();
    const disableRealtime = process.env.NEXT_PUBLIC_DISABLE_FIRESTORE_LISTEN === 'true';
    let timers: ReturnType<typeof setInterval>[] = [];
    let unsubs: (() => void)[] = [];

    const poll = (fn: () => Promise<void>) => {
      fn();
      const t = setInterval(fn, 30000);
      timers.push(t);
    };

    if (disableRealtime) {
      poll(async () => {
        try {
          const snap = await getDocs(query(collection(db, 'products'), orderBy('createdAt', 'desc')));
          const fetchedProducts = snap.docs.map(d => ({ ...d.data(), id: d.id } as Product));
          setProducts(fetchedProducts.length > 0 ? fetchedProducts : initialProducts);
          setIsLoading(false);
        } catch {
          setProducts(initialProducts);
          setIsLoading(false);
        }
      });
    } else {
      const productsUnsubscribe = onSnapshot(query(collection(db, 'products'), orderBy('createdAt', 'desc')), (snapshot) => {
        const fetchedProducts = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Product));
        setProducts(fetchedProducts.length > 0 ? fetchedProducts : initialProducts);
        setIsLoading(false);
      }, (error) => {
          console.error("Error fetching products:", error);
          setProducts(initialProducts);
          setIsLoading(false);
      });
      unsubs.push(productsUnsubscribe);
    }

    if (disableRealtime) {
      poll(async () => {
        try {
          const snap = await getDocs(query(collection(db, 'categories'), orderBy('order')));
          setCategories(snap.docs.map(d => ({ ...d.data(), id: d.id } as Category)));
        } catch {}
      });
    } else {
      const categoriesUnsubscribe = onSnapshot(query(collection(db, 'categories'), orderBy('order')), (snapshot) => {
        setCategories(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Category)));
      }, (error) => {
          console.error("Error fetching categories:", error);
          getDocs(query(collection(db, 'categories'), orderBy('order'))).then((snapshot) => {
            setCategories(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Category)));
          }).catch(() => {});
      });
      unsubs.push(categoriesUnsubscribe);
    }

    if (disableRealtime) {
      poll(async () => {
        try {
          const snap = await getDocs(query(collection(db, 'orders'), orderBy('date', 'desc')));
          setOrders(snap.docs.map(d => ({ ...d.data(), id: d.id } as Order)));
        } catch {}
      });
    } else {
      const ordersUnsubscribe = onSnapshot(query(collection(db, 'orders'), orderBy('date', 'desc')), (snapshot) => {
        setOrders(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order)));
      }, (error) => {
          console.error("Error fetching orders:", error);
          getDocs(query(collection(db, 'orders'), orderBy('date', 'desc'))).then((snapshot) => {
            setOrders(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Order)));
          }).catch(() => {});
      });
      unsubs.push(ordersUnsubscribe);
    }

    if (disableRealtime) {
      poll(async () => {
        try {
          const snap = await getDocs(query(collection(db, 'commissionPayments'), orderBy('paymentDate', 'desc')));
          setCommissionPayments(snap.docs.map(d => d.data() as CommissionPayment));
        } catch {}
      });
    } else {
      const commissionPaymentsUnsubscribe = onSnapshot(query(collection(db, 'commissionPayments'), orderBy('paymentDate', 'desc')), (snapshot) => {
        setCommissionPayments(snapshot.docs.map(d => d.data() as CommissionPayment));
      }, (error) => {
        console.error("Error fetching commission payments:", error);
        getDocs(query(collection(db, 'commissionPayments'), orderBy('paymentDate', 'desc'))).then((snapshot) => {
          setCommissionPayments(snapshot.docs.map(d => d.data() as CommissionPayment));
        }).catch(() => {});
      });
      unsubs.push(commissionPaymentsUnsubscribe);
    }

    if (disableRealtime) {
      poll(async () => {
        try {
          const snap = await getDocs(query(collection(db, 'stockAudits'), orderBy('createdAt', 'desc')));
          setStockAudits(snap.docs.map(d => d.data() as StockAudit));
        } catch {}
      });
    } else {
      const stockAuditsUnsubscribe = onSnapshot(query(collection(db, 'stockAudits'), orderBy('createdAt', 'desc')), (snapshot) => {
        setStockAudits(snapshot.docs.map(d => d.data() as StockAudit));
      }, (error) => {
        console.error("Error fetching stock audits:", error);
        getDocs(query(collection(db, 'stockAudits'), orderBy('createdAt', 'desc'))).then((snapshot) => {
          setStockAudits(snapshot.docs.map(d => d.data() as StockAudit));
        }).catch(() => {});
      });
      unsubs.push(stockAuditsUnsubscribe);
    }

    if (disableRealtime) {
      poll(async () => {
        try {
          const snap = await getDocs(query(collection(db, 'avarias'), orderBy('createdAt', 'desc')));
          setAvarias(snap.docs.map(d => d.data() as Avaria));
        } catch {}
      });
    } else {
      const avariasUnsubscribe = onSnapshot(query(collection(db, 'avarias'), orderBy('createdAt', 'desc')), (snapshot) => {
        setAvarias(snapshot.docs.map(d => d.data() as Avaria));
      }, (error) => {
        console.error("Error fetching avarias:", error);
        getDocs(query(collection(db, 'avarias'), orderBy('createdAt', 'desc'))).then((snapshot) => {
          setAvarias(snapshot.docs.map(d => d.data() as Avaria));
        }).catch(() => {});
      });
      unsubs.push(avariasUnsubscribe);
    }

    return () => {
      unsubs.forEach(u => u());
      timers.forEach(t => clearInterval(t));
    };
  }, []);

  const customers = useMemo(() => {
    const customerMap = new Map<string, CustomerInfo>();
    const sortedOrders = [...orders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    sortedOrders.forEach(order => {
        const customerKey = order.customer.cpf ? order.customer.cpf.replace(/\D/g, '') : `${order.customer.name}-${order.customer.phone}`;
        if (customerKey && !customerMap.has(customerKey)) {
            customerMap.set(customerKey, order.customer);
        }
    });

    return Array.from(customerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);
  
  const customerOrders = useMemo(() => {
    const ordersByCustomer: { [key: string]: Order[] } = {};
    orders.forEach(order => {
      if (order.status !== 'Cancelado' && order.status !== 'Excluído') {
        const customerKey = order.customer.cpf || `${order.customer.name}-${order.customer.phone}`;
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
  }, [orders]);

  const customerFinancials = useMemo(() => {
      const financialsByCustomer: { [key: string]: { totalComprado: number, totalPago: number, saldoDevedor: number } } = {};
      customers.forEach(customer => {
        const customerKey = customer.cpf || `${customer.name}-${customer.phone}`;
        const orders = customerOrders[customerKey] || [];
        const allInstallments = orders.flatMap(order => order.installmentDetails || []);
        const totalComprado = orders.reduce((acc, order) => acc + order.total, 0);
        const totalPago = allInstallments.reduce((sum, inst) => sum + (inst.paidAmount || 0), 0);
        const saldoDevedor = totalComprado - totalPago;
        financialsByCustomer[customerKey] = { totalComprado, totalPago, saldoDevedor };
      });
      return financialsByCustomer;
  }, [customers, customerOrders]);


  const financialSummary = useMemo(() => {
    let totalVendido = 0;
    let totalRecebido = 0;
    let totalPendente = 0;
    let lucroBruto = 0;
    const monthlySales: { [key: string]: number } = {};

    orders.forEach(order => {
      if (order.status !== 'Cancelado' && order.status !== 'Excluído') {
        totalVendido += order.total;

        order.items.forEach(item => {
            const product = products.find(p => p.id === item.id);
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
  }, [orders, products]);
  
  const commissionSummary = useMemo(() => {
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
  }, [orders, users]);

  const value = useMemo(() => ({
    products, 
    categories, 
    orders, 
    commissionPayments, 
    stockAudits, 
    avarias, 
    customers,
    customerOrders,
    customerFinancials,
    financialSummary,
    commissionSummary,
    isLoading,
  }), [
    products, 
    categories, 
    orders, 
    commissionPayments, 
    stockAudits, 
    avarias, 
    customers,
    customerOrders,
    customerFinancials,
    financialSummary,
    commissionSummary,
    isLoading
  ]);


  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
