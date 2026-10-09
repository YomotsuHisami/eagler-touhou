import {createContext, useContext, type ReactNode} from 'react';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
const Context = createContext<{productId: ProductId | null; movementRestricted: boolean}>({productId: null, movementRestricted: false});
export function RoomSettingsPolicyProvider({children, productId, movementRestricted}: {children: ReactNode; productId: ProductId | null; movementRestricted: boolean}) {
  return <Context.Provider value={{productId, movementRestricted}}>{children}</Context.Provider>;
}
export function useRoomSettingsPolicy() {return useContext(Context);}
