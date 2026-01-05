

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

type CachedLiteProduct = Omit<Partial<Product>, 'id' | 'longDescription' | 'imageUrls'> & {
  id: string;
  coverImageUrl?: string;
  imageUrls?: string[];
};

const MAX_LOCAL_STORAGE_CHARS = 4_000_000;
const PUBLIC_BACKGROUND_REFRESH_MS = 5 * 60 * 1000;

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

const PRODUCTS_CACHE_KEY = 'catalogProductsLiteV2';
const LEGACY_PRODUCTS_CACHE_KEY = 'catalogProducts';
const CATEGORIES_CACHE_KEY = 'catalogCategories';

interface DataContextType {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

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

const normalizeCachedProducts = (cachedProducts: CachedLiteProduct[]): Product[] => {
  return cachedProducts.map((p) => {
    const coverImageUrl =
      p.coverImageUrl ?? (Array.isArray(p.imageUrls) && p.imageUrls.length > 0 ? p.imageUrls[0] : undefined);

    return {
      id: p.id,
      code: p.code,
      name: p.name ?? '',
      description: p.description ?? '',
      longDescription: '',
      price: p.price ?? 0,
      cost: p.cost,
      onSale: p.onSale,
      promotionEndDate: toIsoDateString(p.promotionEndDate),
      isHidden: p.isHidden,
      category: p.category ?? '',
      subcategory: p.subcategory,
      stock: p.stock ?? 0,
      imageUrls: coverImageUrl ? [coverImageUrl] : [],
      maxInstallments: p.maxInstallments,
      paymentCondition: p.paymentCondition,
      commissionType: p.commissionType,
      commissionValue: p.commissionValue,
      "data-ai-hint": p["data-ai-hint"],
      createdAt: toIsoDateString(p.createdAt),
    } satisfies Product;
  });
};

const toLiteCacheProducts = (products: Product[]): CachedLiteProduct[] => {
  return products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    price: p.price,
    cost: p.cost,
    onSale: p.onSale,
    promotionEndDate: p.promotionEndDate,
    isHidden: p.isHidden,
    category: p.category,
    subcategory: p.subcategory,
    stock: p.stock,
    coverImageUrl: p.imageUrls?.[0],
    maxInstallments: p.maxInstallments,
    paymentCondition: p.paymentCondition,
    commissionType: p.commissionType,
    commissionValue: p.commissionValue,
    "data-ai-hint": p["data-ai-hint"],
    createdAt: p.createdAt,
  }));
};

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith('/admin');

  useEffect(() => {
    const cachedProducts = loadFromLocalStorage<CatalogCache<CachedLiteProduct[]>>(PRODUCTS_CACHE_KEY);
    const legacyCachedProducts = cachedProducts ? null : loadFromLocalStorage<CatalogCache<Product[]>>(LEGACY_PRODUCTS_CACHE_KEY);
    const cachedCategories = loadFromLocalStorage<CatalogCache<Category[]>>(CATEGORIES_CACHE_KEY);
    const cachedProductsData = cachedProducts?.data?.length
      ? normalizeCachedProducts(cachedProducts.data)
      : (legacyCachedProducts?.data?.length ? normalizeCachedProducts(legacyCachedProducts.data as unknown as CachedLiteProduct[]) : null);
    const hasCachedProducts = !!cachedProductsData?.length;

    if (hasCachedProducts) {
      setProducts(cachedProductsData!);
      setIsLoading(false);
      if (!cachedProducts?.data?.length) {
        saveToLocalStorage(PRODUCTS_CACHE_KEY, { updatedAt: legacyCachedProducts!.updatedAt, data: toLiteCacheProducts(cachedProductsData!) } satisfies CatalogCache<CachedLiteProduct[]>);
      }
    }
    if (cachedCategories?.data?.length) {
      setCategories(cachedCategories.data);
    }

    const now = Date.now();
    const productsUpdatedAt = cachedProducts?.updatedAt ?? legacyCachedProducts?.updatedAt;
    const shouldFetchProducts = isAdminRoute || !hasCachedProducts || !productsUpdatedAt || (now - productsUpdatedAt) > PUBLIC_BACKGROUND_REFRESH_MS;
    const categoriesUpdatedAt = cachedCategories?.updatedAt;
    const shouldFetchCategories = isAdminRoute || !cachedCategories?.data?.length || !categoriesUpdatedAt || (now - categoriesUpdatedAt) > PUBLIC_BACKGROUND_REFRESH_MS;

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
          saveToLocalStorage(PRODUCTS_CACHE_KEY, { updatedAt: Date.now(), data: toLiteCacheProducts(fetchedProducts) } satisfies CatalogCache<CachedLiteProduct[]>);
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
        shouldFetchProducts
          ? getDocs(query(
              collection(db, 'products'),
              orderBy('createdAt', 'asc'),
            ))
          : Promise.resolve(null),
        shouldFetchCategories ? getDocs(query(collection(db, 'categories'), orderBy('order'))) : Promise.resolve(null),
      ]).then(([productsSnapshot, categoriesSnapshot]) => {
        if (cancelled) return;
        if (timeoutId !== null) window.clearTimeout(timeoutId);

        if (productsSnapshot) {
          const fetchedProducts = productsSnapshot.docs.map(d => {
            const data = d.data() as Partial<Product>;
            const coverImageUrl = Array.isArray(data.imageUrls) && data.imageUrls.length > 0 ? data.imageUrls[0] : undefined;

            return {
              id: d.id,
              name: data.name ?? '',
              description: data.description ?? '',
              longDescription: '',
              price: data.price ?? 0,
              onSale: data.onSale,
              promotionEndDate: toIsoDateString(data.promotionEndDate),
              isHidden: data.isHidden,
              category: data.category ?? '',
              subcategory: data.subcategory,
              stock: data.stock ?? 0,
              imageUrls: coverImageUrl ? [coverImageUrl] : [],
              maxInstallments: data.maxInstallments,
              "data-ai-hint": data["data-ai-hint"],
              createdAt: toIsoDateString(data.createdAt),
            } satisfies Product;
          });

          setProducts(fetchedProducts);
          setIsLoading(false);
          saveToLocalStorage(PRODUCTS_CACHE_KEY, { updatedAt: Date.now(), data: toLiteCacheProducts(fetchedProducts) } satisfies CatalogCache<CachedLiteProduct[]>);
        } else if (!hasCachedProducts) {
          setIsLoading(false);
        }

        if (categoriesSnapshot) {
          const fetchedCategories = categoriesSnapshot.docs.map(d => ({ ...d.data(), id: d.id } as Category));
          setCategories(fetchedCategories);
          saveToLocalStorage(CATEGORIES_CACHE_KEY, { updatedAt: Date.now(), data: fetchedCategories } satisfies CatalogCache<Category[]>);
        }
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
