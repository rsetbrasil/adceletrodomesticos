
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import type { User, UserRole } from '@/lib/types';
import { initialUsers } from '@/lib/users';
import { getClientFirebase } from '@/lib/firebase-client';
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch, query, where, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { useAudit } from './AuditContext';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const AUTH_SESSION_STORAGE_KEY = 'authSession';
const LEGACY_USER_STORAGE_KEY = 'user';

type StoredAuthSession = {
  user: User;
  expiresAt: number;
};

interface AuthContextType {
  user: User | null;
  users: User[];
  initialUsers: User[];
  login: (user: string, pass: string) => void;
  logout: () => void;
  addUser: (data: Omit<User, 'id'>) => Promise<boolean>;
  updateUser: (userId: string, data: Partial<Omit<User, 'id'>>) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  changeMyPassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  isLoading: boolean;
  isAuthenticated: boolean;
  restoreUsers: (users: User[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();
  const { logAction } = useAudit();
  const logoutTimeoutRef = useRef<number | null>(null);
  const userRef = useRef<User | null>(null);

  const clearLogoutTimeout = () => {
    if (logoutTimeoutRef.current) {
      window.clearTimeout(logoutTimeoutRef.current);
      logoutTimeoutRef.current = null;
    }
  };

  const clearStoredSession = () => {
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_USER_STORAGE_KEY);
  };

  const scheduleLogoutAt = (expiresAt: number) => {
    clearLogoutTimeout();
    const delay = Math.max(0, expiresAt - Date.now());
    logoutTimeoutRef.current = window.setTimeout(() => {
      const currentUser = userRef.current;
      if (currentUser) {
        logAction('Logout', `Sessão expirada para "${currentUser.name}".`, currentUser);
      }
      setUser(null);
      clearStoredSession();
      toast({ title: 'Sessão expirada', description: 'Faça login novamente.' });
      router.replace('/login');
    }, delay);
  };

  const readStoredSession = (): StoredAuthSession | null => {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredAuthSession;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.user || typeof parsed.expiresAt !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeStoredSession = (userToStore: User, expiresAt?: number) => {
    const session: StoredAuthSession = {
      user: userToStore,
      expiresAt: expiresAt ?? Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_USER_STORAGE_KEY);
    scheduleLogoutAt(session.expiresAt);
    return session;
  };
  
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    setIsLoading(true);
    let usersUnsubscribe: (() => void) | null = null;
    const usersTimeoutId = window.setTimeout(() => {
      setUsers(initialUsers);
    }, 8000);
    try {
      const { db } = getClientFirebase();
      usersUnsubscribe = onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
          window.clearTimeout(usersTimeoutId);
          setUsers(snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as User)));
        },
        (error) => {
          window.clearTimeout(usersTimeoutId);
          console.error("Error fetching users:", error);
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'users',
            operation: 'list',
          }));
          setUsers(initialUsers);
        }
      );
    } catch (error) {
      window.clearTimeout(usersTimeoutId);
      setUsers(initialUsers);
    }
    setIsLoading(false);
    
    return () => {
      window.clearTimeout(usersTimeoutId);
      usersUnsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_SESSION_STORAGE_KEY && e.key !== LEGACY_USER_STORAGE_KEY) return;
      const session = readStoredSession();
      if (!session) {
        clearLogoutTimeout();
        setUser(null);
        return;
      }
      if (Date.now() >= session.expiresAt) {
        clearLogoutTimeout();
        setUser(null);
        clearStoredSession();
        return;
      }
      setUser(session.user);
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
          setUser(null);
          clearStoredSession();
          clearLogoutTimeout();
          return;
        }
        setUser(session.user);
        scheduleLogoutAt(session.expiresAt);
        return;
      }

      const legacy = localStorage.getItem(LEGACY_USER_STORAGE_KEY);
      if (!legacy) return;
      const legacyUser = JSON.parse(legacy) as User;
      setUser(legacyUser);
      writeStoredSession(legacyUser);
    } catch {
      setUser(null);
      clearStoredSession();
      clearLogoutTimeout();
    }
  }, []);

  const login = (username: string, pass: string) => {
    const foundUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!foundUser) {
        toast({ title: 'Falha no Login', description: 'Usuário não encontrado.', variant: 'destructive' });
        return;
    }
    
    // In a real app, this would be a hashed password comparison
    if (foundUser.password === pass) {
        const userToStore = { ...foundUser };
        // Ensure password is not stored in state or localStorage for security
        delete userToStore.password;
        
        setUser(userToStore); 
        writeStoredSession(userToStore);
        logAction('Login', `Usuário "${foundUser.name}" realizou login.`, userToStore);
        router.push('/admin');
        toast({
            title: 'Login bem-sucedido!',
            description: `Bem-vindo(a), ${foundUser.name}.`,
        });
    } else {
        toast({
            title: 'Falha no Login',
            description: 'Senha inválida.',
            variant: 'destructive',
        });
    }
  };

  const logout = () => {
    if (user) {
        logAction('Logout', `Usuário "${user.name}" realizou logout.`, user);
    }
    clearLogoutTimeout();
    setUser(null);
    clearStoredSession();
    router.push('/login');
  };

  const addUser = async (data: Omit<User, 'id'>): Promise<boolean> => {
    const { db } = getClientFirebase();
    if (!db) {
        toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
        return false;
    }
    const isUsernameTaken = users.some(u => u.username.toLowerCase() === data.username.toLowerCase());
    if (isUsernameTaken) {
        toast({
            title: 'Erro ao Criar Usuário',
            description: 'Este nome de usuário já está em uso.',
            variant: 'destructive',
        });
        return false;
    }

    const newUserId = `user-${Date.now()}`;
    const newUser: User = { ...data, id: newUserId };
    
    const userRef = doc(db, 'users', newUserId);
    setDoc(userRef, newUser).then(() => {
        logAction('Criação de Usuário', `Novo usuário "${data.name}" (Perfil: ${data.role}) foi criado.`, user);
        toast({
            title: 'Usuário Criado!',
            description: `O usuário ${data.name} foi criado com sucesso.`,
        });
    }).catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: userRef.path,
            operation: 'create',
            requestResourceData: newUser
        }));
    });
    return true; // Assume success for optimistic UI
  };

  const updateUser = async (userId: string, data: Partial<Omit<User, 'id'>>) => {
    const { db } = getClientFirebase();
    if (!db) {
        toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
        return;
    }
    if (data.username) {
        const isUsernameTaken = users.some(u => u.id !== userId && u.username.toLowerCase() === data.username?.toLowerCase());
        if (isUsernameTaken) {
            toast({
                title: 'Erro ao Atualizar',
                description: 'Este nome de usuário já está em uso por outra conta.',
                variant: 'destructive',
            });
            return;
        }
    }
    
    const userRef = doc(db, 'users', userId);
    
    const updatedUser = users.find(u => u.id === userId);
    if (updatedUser) {
        let details = `Dados do usuário "${updatedUser.name}" foram alterados.`;
        if (data.name && data.name !== updatedUser.name) {
            details += ` Nome: de "${updatedUser.name}" para "${data.name}".`
        }
        if (data.username && data.username !== updatedUser.username) {
            details += ` Username: de "${updatedUser.username}" para "${data.username}".`
        }
         if (data.role && data.role !== updatedUser.role) {
            details += ` Perfil: de "${updatedUser.role}" para "${data.role}".`
        }
        if (data.password) {
            details += ' Senha foi alterada.';
        }
        logAction('Atualização de Usuário', details, user);
    }
    
    updateDoc(userRef, data).then(() => {
        if (user?.id === userId) {
            const updatedCurrentUser = { ...user, ...data };
            delete updatedCurrentUser.password;
            setUser(updatedCurrentUser);
            const currentSession = readStoredSession();
            if (currentSession) {
              writeStoredSession(updatedCurrentUser, currentSession.expiresAt);
            } else {
              writeStoredSession(updatedCurrentUser);
            }
        }

        toast({
            title: 'Usuário Atualizado!',
            description: 'As informações do usuário foram salvas com sucesso.',
        });
    }).catch(async (error) => {
         errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: userRef.path,
            operation: 'update',
            requestResourceData: data
        }));
    });
  };

  const deleteUser = async (userId: string) => {
    if (user?.id === userId) {
      toast({
        title: 'Ação não permitida',
        description: 'Você não pode excluir seu próprio usuário.',
        variant: 'destructive',
      });
      return;
    }
    const { db } = getClientFirebase();
    if (!db) {
      toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
      return;
    }
    const userRef = doc(db, 'users', userId);
    const userToDelete = users.find(u => u.id === userId);

    deleteDoc(userRef).then(() => {
      if (userToDelete) {
        logAction('Exclusão de Usuário', `Usuário "${userToDelete.name}" foi excluído.`, user);
      }
      toast({
        title: 'Usuário Excluído!',
        description: 'O usuário foi removido do sistema.',
        variant: 'destructive',
        duration: 5000,
      });
    }).catch(async (error) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: userRef.path,
        operation: 'delete',
      }));
    });
  };

  const changeMyPassword = async (currentPassword: string, newPassword: string): Promise<boolean> => {
      const { db } = getClientFirebase();
      if (!db) {
          toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
          return false;
      }
      if (!user) {
          toast({ title: "Erro", description: "Você não está logado.", variant: "destructive" });
          return false;
      }
      
      const currentUserInDB = users.find(u => u.id === user.id);
      
      if (!currentUserInDB || currentUserInDB.password !== currentPassword) {
          toast({ title: "Erro", description: "A senha atual está incorreta.", variant: "destructive" });
          return false;
      }

      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, { password: newPassword });
      logAction('Alteração de Senha', `O usuário "${user.name}" alterou a própria senha.`, user);
      toast({ title: "Senha Alterada!", description: "Sua senha foi atualizada com sucesso." });
      return true;
  };
  
  const restoreUsers = async (usersToRestore: User[]) => {
    const { db } = getClientFirebase();
    if (!db) {
        toast({ title: "Erro", description: "Firebase não está configurado.", variant: "destructive" });
        return;
    }
    const batch = writeBatch(db);
    
    users.forEach(existingUser => {
        batch.delete(doc(db, 'users', existingUser.id));
    });

    usersToRestore.forEach(u => {
        const docRef = doc(db, 'users', u.id);
        batch.set(docRef, u);
    });

    batch.commit().then(() => {
        logAction('Restauração de Usuários', 'Todos os usuários foram restaurados a partir de um backup.', user);
        toast({ title: "Usuários Restaurados!", description: "A lista de usuários foi substituída com sucesso." });
    }).catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: 'users',
            operation: 'write'
        }));
    });
  };

  return (
    <AuthContext.Provider value={{ user, users, initialUsers, login, logout, addUser, updateUser, deleteUser, changeMyPassword, isLoading, isAuthenticated: !!user, restoreUsers }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
