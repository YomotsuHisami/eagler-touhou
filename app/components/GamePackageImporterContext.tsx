import {createContext, useContext, type ReactNode} from 'react';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
import type {GamePackageImportOptions} from './GamePackageImport';

export type GamePackageImporter = (productId: ProductId, options?: GamePackageImportOptions) => boolean;
const Context = createContext<GamePackageImporter | null>(null);

export function useGamePackageImporter() {return useContext(Context);}

export function GamePackageImporterProvider({children, open}: {children: ReactNode; open: GamePackageImporter}) {
  return <Context.Provider value={open}>{children}</Context.Provider>;
}
