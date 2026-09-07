import { createContext, useContext } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

export const MatrixClientContext = createContext<MatrixClient | undefined>(undefined);

export function useMatrixClient(): MatrixClient {
  const mx = useContext(MatrixClientContext);
  if (!mx) {
    throw new Error('useMatrixClient() called outside <MatrixClientContext.Provider>');
  }
  return mx;
}
