import {createContext, useContext, useMemo, type ReactNode} from 'react';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
import type {GamePackageImportOptions} from './GamePackageImport';

export type GamePackageImporter = ((productId: ProductId, options?: GamePackageImportOptions) => boolean) & {dismiss?(): void};
const Context = createContext<GamePackageImporter | null>(null);

export function useGamePackageImporter() {return useContext(Context);}

export function GamePackageImporterProvider({children, open, dismiss}: {children: ReactNode; open: GamePackageImporter; dismiss?: () => void}) {
  const importer=useMemo(()=>Object.assign((productId: ProductId, options?: GamePackageImportOptions)=>open(productId,options),{dismiss}),[open,dismiss]);
  return <Context.Provider value={importer}>{children}</Context.Provider>;
}
