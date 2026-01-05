

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, getDocs } from 'firebase/firestore';
import { usePathname } from 'next/navigation';
import { getClientFirebase } from '@/lib/firebase-client';
import type { Product, Category } from '@/lib/types';

type CatalogCache<T> = {
  updatedAt: number;
  data: T;
};

const MAX_LOCAL_STORAGE_CHARS = 4_000_000;

const saveToLocalStorage = (key: string, data: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_LOCAL_STORAGE_CHARS) {
      try {
        localStorage.removeItem(key);
      } catch {
      }
      return;
    }
    localStorage.setItem(key, serialized);
  } catch {
  }
};

const loadFromLocalStorage = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.error(`Failed to load ${key} from localStorage`, error);
    return null;
  }
};

const PRODUCTS_CACHE_KEY = 'catalogProducts';
const CATEGORIES_CACHE_KEY = 'catalogCategories';

interface DataContextType {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith('/admin');

  useEffect(() => {
    const cachedProducts = loadFromLocalStorage<CatalogCache<Product[]>>(PRODUCTS_CACHE_KEY);
    const cachedCategories = loadFromLocalStorage<CatalogCache<Category[]>>(CATEGORIES_CACHE_KEY);
    const hasCachedProducts = !!cachedProducts?.data?.length;

    if (hasCachedProducts) {
      setProducts(cachedProducts.data);
      setIsLoading(false);
    }
    if (cachedCategories?.data?.length) {
      setCategories(cachedCategories.data);
    }

    const timeoutId = hasCachedProducts
      ? null
      : window.setTimeout(() => {
          setProducts([]);
          setCategories([]);
          setIsLoading(false);
        }, 8000);
    try {
      const { db } = getClientFirebase();

      if (isAdminRoute) {
        const productsUnsubscribe = onSnapshot(query(collection(db, 'products'), orderBy('createdAt', 'asc')), (snapshot) => {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          const fetchedProducts = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Product));
          setProducts(fetchedProducts);
          setIsLoading(false);
          saveToLocalStorage(PRODUCTS_CACHE_KEY, { updatedAt: Date.now(), data: fetchedProducts } satisfies CatalogCache<Product[]>);
        }, (error) => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            console.error("Error fetching products:", error);
            setIsLoading(false);
        });

        const categoriesUnsubscribe = onSnapshot(query(collection(db, 'categories'), orderBy('order')), (snapshot) => {
          const fetchedCategories = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Category));
          setCategories(fetchedCategories);
          saveToLocalStorage(CATEGORIES_CACHE_KEY, { updatedAt: Date.now(), data: fetchedCategories } satisfies CatalogCache<Category[]>);
        }, (error) => {
            console.error("Error fetching categories:", error);
        });
        
        return () => {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          productsUnsubscribe();
          categoriesUnsubscribe();
        };
      }

      let cancelled = false;

      Promise.all([
        getDocs(query(collection(db, 'products'), orderBy('createdAt', 'asc'))),
        getDocs(query(collection(db, 'categories'), orderBy('order'))),
      ]).then(([productsSnapshot, categoriesSnapshot]) => {
        if (cancelled) return;
        if (timeoutId !== null) window.clearTimeout(timeoutId);

        const fetchedProducts = productsSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Product));
        const fetchedCategories = categoriesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Category));

        setProducts(fetchedProducts);
        setCategories(fetchedCategories);
        setIsLoading(false);

        saveToLocalStorage(PRODUCTS_CACHE_KEY, { updatedAt: Date.now(), data: fetchedProducts } satisfies CatalogCache<Product[]>);
        saveToLocalStorage(CATEGORIES_CACHE_KEY, { updatedAt: Date.now(), data: fetchedCategories } satisfies CatalogCache<Category[]>);
      }).catch((error) => {
        if (cancelled) return;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        console.error("Error fetching catalog:", error);
        setIsLoading(false);
      });

      return () => {
        cancelled = true;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      };
    } catch (error) {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setProducts([]);
      setCategories([]);
      setIsLoading(false);
      return;
    }
  }, [isAdminRoute]);

  const value = useMemo(() => ({
    products, 
    categories, 
    isLoading,
  }), [
    products, 
    categories, 
    isLoading,
  ]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = (): DataContextType => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
