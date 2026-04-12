import { ReactNode } from 'react';

type ClientBindAtomsProps = {
  children: ReactNode;
};

/**
 * Atom bindings are now per-account in AccountBootstrapper.
 * This component is kept as a structural pass-through for Router compatibility.
 */
export function ClientBindAtoms({ children }: ClientBindAtomsProps) {
  return children;
}
