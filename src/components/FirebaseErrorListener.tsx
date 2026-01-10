

'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import type { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';

export default function FirebaseErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      toast({
        title: 'Permissão insuficiente',
        description: error?.message || 'Falha ao acessar dados no Firestore.',
        variant: 'destructive',
      });
    };

    errorEmitter.on(handleError);

    return () => {
      errorEmitter.off(handleError);
    };
  }, [toast]);

  return null; // This component doesn't render anything
}
